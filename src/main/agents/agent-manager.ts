import type { AgentCapabilities, AgentEntry, AgentInstallation } from '@shared/types/agent';
import { envLabel, envSettingKey, type EnvironmentRef } from '@shared/types/env';
import type { SessionSpec } from '@shared/types/session';
import { baseLaunchEnv, resolveLinuxCwd, windowsCwd, WSL_ENV_FORWARD, type LaunchPlan } from '../shell/launch';
import type { AgentLaunch } from '../pty/session-manager';
import type { ProfileRegistry } from '../shell/registry';
import { wslExePath, type WslManager } from '../wsl/wsl-manager';
import { statusLaunch, hooksSupported } from './status/launch';
import { hookScript } from '../paths';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADAPTERS, adapterById, isSafeValue, isUnsafeArgs, type AgentAdapter } from './adapters';
import { userShell, localCwd } from '../shell/local';
import { findInWsl, findLocal, findOnWindowsPath, isCmdShim, parseVersion, probeLocal, probeWindows, probeWsl } from './detect';

const envKey = envSettingKey;

/** What the session manager knows about the tab before its process exists. */
export interface AgentLaunchContext {
  id: string;
  nonce: string;
  /** Spool directory the hook script writes status events to, and where the settings file for it goes. */
  eventsDir: string;
  settingsPath: string;
}

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
    const onWindows = process.platform === 'win32';
    const distros = onWindows ? await this.wsl.listDistros(refresh) : [];
    const envs: EnvironmentRef[] = onWindows
      ? [{ kind: 'windows' }, ...distros.map((d) => ({ kind: 'wsl', distro: d.name }) as const)]
      : [{ kind: 'local' }];
    const stale = Date.now() - this.loadedAt > 60_000;
    const work: Promise<void>[] = [];
    for (const a of ADAPTERS) {
      for (const env of envs) {
        const key = AgentManager.overrideKey(a.id, env);
        if (refresh || stale || !this.cache.has(key)) {
          const running = env.kind !== 'wsl' || distros.find((d) => d.name === env.distro)?.state === 'Running';
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
      if (env.kind === 'local') {
        const shell = userShell();
        const hit = await findLocal(a.command, shell, process.env['PATH'] ?? '', override);
        if (!hit) return { installation: null };
        const [v, h] = await Promise.all([probeLocal(shell, hit.path, ['--version']), probeLocal(shell, hit.path, ['--help'], 20000)]);
        return this.found(a, env, hit.path, override ? 'user-configured' : hit.source, v.out, h.out);
      }
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
  async launch(spec: SessionSpec, ctx: AgentLaunchContext): Promise<AgentLaunch> {
    if (!spec.agent) throw new Error('Missing agent options');
    const a = adapterById(spec.agent.adapterId);
    const profile = this.registry.get(spec.profileId);
    if (!profile) throw new Error(`Unknown profile: ${spec.profileId}`);
    const env = profile.env;
    const envName = envLabel(env);
    const key = AgentManager.overrideKey(a.id, env);

    let d = this.cache.get(key);
    if (!d?.installation) d = await this.probe(a, env);
    this.cache.set(key, d);
    const inst = d.installation;
    if (!inst || !d.capabilities) throw new Error(`${a.displayName} is not installed in ${envName}.`);

    const o = spec.agent.options;
    for (const x of o.extraArgs ?? []) if (x.length > 500 || /[\0\r\n]/.test(x)) throw new Error('Invalid launch argument');
    const baseEnv = baseLaunchEnv(ctx.id, '', false, false);
    const kind = env.kind === 'windows' ? 'windows' : env.kind === 'wsl' ? 'wsl' : 'local';

    // Structured status: hooks (Claude Code) or `notify` (Codex), added on the command line so the user's own settings stay untouched.
    // Only where a POSIX sh runs them, and only when `--help` shows the flag. Otherwise the tab's status stays "unknown".
    let statusArgs: string[] = [];
    if (hooksSupported(kind) && d.capabilities.structuredStatus === 'hooks') {
      try {
        const toAgent = async (p: string) => (env.kind === 'wsl' ? this.wsl.toPosix(env.distro, p) : p);
        const script = await toAgent(hookScript());
        const settings = await (async () => {
          mkdirSync(dirname(ctx.settingsPath), { recursive: true });
          return toAgent(ctx.settingsPath);
        })();
        const dir = await toAgent(ctx.eventsDir);
        if (script && settings && dir) {
          const sl = statusLaunch(a.id, true, script, settings);
          if (sl.args.length) {
            if (sl.settingsFile) writeFileSync(ctx.settingsPath, sl.settingsFile.contents, { mode: 0o600 });
            statusArgs = sl.args;
            baseEnv['ARCTRI_EVENTS_DIR'] = dir;
            baseEnv['ARCTRI_EVENT_TOKEN'] = ctx.nonce;
          }
        }
      } catch {
        statusArgs = []; // no hooks is never a reason to fail the launch
      }
    }
    const args = [...a.buildArgs(d.capabilities, o), ...statusArgs];
    const summary = a.buildArgs(d.capabilities, o).join(' ');
    const unsafe = isUnsafeArgs(o.extraArgs);

    let plan: LaunchPlan;
    if (env.kind === 'local') {
      // through a login shell, so `node` and the rest of the user's PATH are there (an app started from Finder has a minimal one)
      plan = {
        file: userShell(),
        args: ['-lic', 'exec "$0" "$@"', inst.resolvedPath ?? inst.command, ...args],
        cwd: localCwd(spec.cwd),
        env: baseEnv
      };
    } else if (env.kind === 'windows') {
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
      // the events directory was already translated to a path inside the distro, so it is forwarded as it is
      baseEnv['WSLENV'] = [baseEnv['WSLENV'], ...WSL_ENV_FORWARD, ...(statusArgs.length ? ['ARCTRI_EVENTS_DIR', 'ARCTRI_EVENT_TOKEN'] : [])].filter(Boolean).join(':');
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
      capabilities: d.capabilities,
      statusHooks: statusArgs.length > 0
    };
  }
}
