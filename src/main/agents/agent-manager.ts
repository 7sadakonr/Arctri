import type { AgentCapabilities, AgentEntry, AgentInstallation } from '@shared/types/agent';
import type { EnvironmentRef } from '@shared/types/env';
import type { SessionSpec } from '@shared/types/session';
import { baseLaunchEnv, resolveLinuxCwd, windowsCwd, WSL_ENV_FORWARD, type LaunchPlan } from '../shell/launch';
import type { AgentLaunch } from '../pty/session-manager';
import type { ProfileRegistry } from '../shell/registry';
import { wslExePath, type WslManager } from '../wsl/wsl-manager';
import { ADAPTERS, adapterById, isSafeValue, isUnsafeArgs, type AgentAdapter } from './adapters';
import { findInWsl, findOnWindowsPath, isCmdShim, parseVersion, probeWindows, probeWsl } from './detect';

const envKey = (e: EnvironmentRef): string => (e.kind === 'windows' ? 'windows' : `wsl:${e.distro}`);

interface Detected {
  installation: AgentInstallation | null;
  capabilities?: AgentCapabilities;
  stopped?: boolean;
}

export class AgentManager {
  private cache = new Map<string, Detected>();
  private loadedAt = 0;

  constructor(
    private readonly wsl: WslManager,
    private readonly registry: ProfileRegistry,
    private readonly overrides: () => Record<string, string>
  ) {}

  /** Key used in Settings > agent paths: `<adapter>:windows` or `<adapter>:wsl:<distro>`. */
  static overrideKey(adapterId: string, env: EnvironmentRef): string {
    return `${adapterId}:${envKey(env)}`;
  }

  async detect(refresh = false): Promise<AgentEntry[]> {
    const distros = await this.wsl.listDistros(refresh);
    const envs: EnvironmentRef[] = [{ kind: 'windows' }, ...distros.map((d) => ({ kind: 'wsl', distro: d.name }) as const)];
    const stale = Date.now() - this.loadedAt > 60_000;
    const work: Promise<void>[] = [];
    for (const a of ADAPTERS) {
      for (const env of envs) {
        const key = AgentManager.overrideKey(a.id, env);
        if (refresh || stale || !this.cache.has(key)) {
          const running = env.kind === 'windows' || distros.find((d) => d.name === env.distro)?.state === 'Running';
          work.push(
            (running ? this.probe(a, env) : Promise.resolve<Detected>({ installation: null, stopped: true })).then((d) => {
              this.cache.set(key, d);
            })
          );
        }
      }
    }
    await Promise.all(work);
    this.loadedAt = Date.now();
    return ADAPTERS.map((a) => ({
      adapterId: a.id,
      displayName: a.displayName,
      environments: envs.map((env) => {
        const d = this.cache.get(AgentManager.overrideKey(a.id, env)) ?? { installation: null };
        return {
          env,
          installation: d.installation,
          ...(d.capabilities ? { capabilities: d.capabilities } : {}),
          ...(d.stopped ? { stopped: true } : {})
        };
      })
    }));
  }

  private async probe(a: AgentAdapter, env: EnvironmentRef): Promise<Detected> {
    const override = this.overrides()[AgentManager.overrideKey(a.id, env)]?.trim() || undefined;
    try {
      if (env.kind === 'windows') {
        const path = findOnWindowsPath(a.command, process.env['PATH'] ?? '', override);
        if (!path) return { installation: null };
        const [v, h] = await Promise.all([probeWindows(path, ['--version']), probeWindows(path, ['--help'], 15000)]);
        return this.found(a, env, path, override ? 'user-configured' : 'path', v.out, h.out);
      }
      const hit = await findInWsl(this.wsl, env.distro, a.command, override);
      if (!hit) return { installation: null };
      const [v, h] = await Promise.all([
        probeWsl(this.wsl, env.distro, hit.path, ['--version']),
        probeWsl(this.wsl, env.distro, hit.path, ['--help'], 20000)
      ]);
      return this.found(a, env, hit.path, override ? 'user-configured' : hit.source, v.out, h.out);
    } catch {
      return { installation: null };
    }
  }

  private found(
    a: AgentAdapter, env: EnvironmentRef, path: string, source: AgentInstallation['source'], versionOut: string, help: string
  ): Detected {
    const version = parseVersion(versionOut);
    const installation: AgentInstallation = {
      id: `${a.id}:${envKey(env)}`,
      adapterId: a.id,
      env,
      command: a.command,
      resolvedPath: path,
      ...(version ? { version } : {}),
      source
    };
    return { installation, capabilities: a.capabilities(help) };
  }

  /** Builds the PTY launch for an agent session. Arguments are always an argv array. */
  async launch(spec: SessionSpec): Promise<AgentLaunch> {
    if (!spec.agent) throw new Error('Missing agent options');
    const a = adapterById(spec.agent.adapterId);
    const profile = this.registry.get(spec.profileId);
    if (!profile) throw new Error(`Unknown profile: ${spec.profileId}`);
    const env = profile.env;
    const envName = env.kind === 'windows' ? 'Windows' : env.distro;
    const key = AgentManager.overrideKey(a.id, env);

    let d = this.cache.get(key);
    if (!d?.installation) d = await this.probe(a, env);
    this.cache.set(key, d);
    const inst = d.installation;
    if (!inst || !d.capabilities) throw new Error(`${a.displayName} is not installed in ${envName}.`);

    const o = spec.agent.options;
    for (const x of o.extraArgs ?? []) if (x.length > 500 || /[\0\r\n]/.test(x)) throw new Error('Invalid launch argument');
    const args = a.buildArgs(d.capabilities, o);
    const sessionId = 'pending';
    const baseEnv = baseLaunchEnv(sessionId, '', false, false);
    const summary = args.join(' ');
    const unsafe = isUnsafeArgs(o.extraArgs);

    let plan: LaunchPlan;
    if (env.kind === 'windows') {
      const { cwd } = windowsCwd(spec.cwd);
      const path = inst.resolvedPath ?? inst.command;
      if (isCmdShim(path)) {
        // Only values that cannot be interpreted by cmd.exe may reach a .cmd shim.
        if (args.some((x) => !/^[A-Za-z0-9._:/\\@+=,-]+$/.test(x))) {
          throw new Error(`${a.displayName} is installed as a .cmd shim, which cannot take these arguments safely.`);
        }
        plan = {
          file: process.env['ComSpec'] ?? 'C:\\Windows\\System32\\cmd.exe',
          args: `/d /s /c ""${path}" ${args.join(' ')}"`,
          cwd,
          env: baseEnv
        };
      } else {
        plan = { file: path, args, cwd, env: baseEnv };
      }
    } else {
      const { cwd, note } = await resolveLinuxCwd(env.distro, spec.cwd, (dn, p) => this.wsl.toPosix(dn, p));
      baseEnv['WSLENV'] = [baseEnv['WSLENV'], ...WSL_ENV_FORWARD].filter(Boolean).join(':');
      plan = {
        file: wslExePath(),
        args: ['-d', env.distro, '--cd', cwd, '--exec', 'bash', '-lic', 'exec "$0" "$@"', inst.resolvedPath ?? inst.command, ...args],
        cwd: process.env['USERPROFILE'] ?? process.cwd(),
        env: baseEnv,
        ...(note ? { note } : {})
      };
    }
    void isSafeValue;
    return {
      plan,
      agentId: a.id,
      title: `${a.displayName} · ${envName}`,
      env,
      summary,
      unsafe,
      capabilities: d.capabilities
    };
  }
}
