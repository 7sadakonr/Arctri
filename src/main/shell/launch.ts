import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EnvPath, ShellProfile } from '@shared/types/env';
import { integrationDir } from '../paths';
import { localCwd } from './local';

export interface LaunchContext {
  sessionId: string;
  nonce: string;
  /** true: the shell clears the screen after each command (block presentation). */
  blocks: boolean;
  cwd?: EnvPath;
  /** Converts a Windows path to a path inside the distro. */
  toPosix: (distro: string, winPath: string) => Promise<string | null>;
}

export interface LaunchPlan {
  file: string;
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
  /** Set when a requested cwd could not be used. */
  note?: string;
}

const WSL_FORWARD = ['ARCTRI_NONCE', 'ARCTRI_BLOCKS', 'ARCTRI_SESSION', 'TERM_PROGRAM', 'COLORTERM'];

function baseEnv(ctx: LaunchContext, withIntegration: boolean): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['TERM_PROGRAM'] = 'Arctri';
  env['COLORTERM'] = 'truecolor';
  env['ARCTRI_SESSION'] = ctx.sessionId;
  if (withIntegration) {
    env['ARCTRI_NONCE'] = ctx.nonce;
    env['ARCTRI_BLOCKS'] = ctx.blocks ? '1' : '0';
  }
  return env;
}

/** -EncodedCommand is not subject to execution policy and needs no quoting. */
function psEncoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export async function resolveLinuxCwd(
  distro: string,
  cwd: EnvPath | undefined,
  toPosix: LaunchContext['toPosix']
): Promise<{ cwd: string; note?: string }> {
  if (!cwd) return { cwd: '~' };
  if (cwd.env === 'wsl') return cwd.distro === distro ? { cwd: cwd.path } : { cwd: '~' };
  const mapped = await toPosix(distro, cwd.path);
  return mapped ? { cwd: mapped } : { cwd: '~', note: 'cwd-unmapped' };
}

export function baseLaunchEnv(sessionId: string, nonce: string, withIntegration: boolean, blocks: boolean): Record<string, string> {
  return baseEnv({ sessionId, nonce, blocks, toPosix: async () => null }, withIntegration);
}

export const WSL_ENV_FORWARD = WSL_FORWARD;

export function windowsCwd(cwd: EnvPath | undefined): { cwd: string; note?: string } {
  if (cwd && cwd.env === 'windows') return { cwd: cwd.path };
  return { cwd: homedir() };
}

export async function buildShellLaunch(profile: ShellProfile, ctx: LaunchContext): Promise<LaunchPlan> {
  const withIntegration = profile.integration !== 'none';
  const env = baseEnv(ctx, withIntegration);

  if (profile.env.kind === 'windows') {
    const { cwd } = windowsCwd(ctx.cwd);
    if (profile.shell === 'cmd') {
      // cmd cannot report command boundaries; PROMPT only reports the working directory.
      env['PROMPT'] = `$E]6973;${ctx.nonce};cwdp;$P$E\\$P$G`;
      return { file: profile.executable, args: [], cwd, env };
    }
    if (profile.shell === 'other') {
      return { file: profile.executable, args: profile.args ?? [], cwd, env };
    }
    const script = readFileSync(join(integrationDir(), 'arctri.ps1'), 'utf8');
    return {
      file: profile.executable,
      args: ['-NoLogo', '-NoExit', '-EncodedCommand', psEncoded(script)],
      cwd,
      env
    };
  }

  if (profile.env.kind === 'local') return buildLocalLaunch(profile, env, ctx);

  // WSL: spawn wsl.exe, which hands the PTY to a Linux shell in the chosen distro.
  const distro = profile.env.distro;
  env['WSLENV'] = [env['WSLENV'], ...WSL_FORWARD].filter(Boolean).join(':');
  const { cwd: linuxCwd, note } = await resolveLinuxCwd(distro, ctx.cwd, ctx.toPosix);
  const dir = integrationDir();
  const args = ['-d', distro, '--cd', linuxCwd, '--exec'];
  if (profile.autoShell) {
    const shim = await ctx.toPosix(distro, join(dir, 'zsh'));
    const rc = await ctx.toPosix(distro, join(dir, 'arctri.bash'));
    if (!shim || !rc) throw new Error(`Cannot map integration scripts into ${distro}`);
    // zsh when it is installed and the user uses it (it is the login shell, or there is a .zshrc), otherwise bash.
    const script =
      'if command -v zsh >/dev/null 2>&1; then use=; ' +
      'case "$(getent passwd "$(id -un)" | cut -d: -f7)" in */zsh) use=1;; esac; ' +
      '[ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && use=1; ' +
      'if [ -n "$use" ]; then USER_ZDOTDIR="${ZDOTDIR:-$HOME}" ZDOTDIR="$1" exec zsh -i; fi; fi; ' +
      'exec bash --rcfile "$2" -i';
    args.push('sh', '-c', script, 'sh', shim, rc);
  } else if (profile.shell === 'zsh') {
    const shim = await ctx.toPosix(distro, join(dir, 'zsh'));
    if (!shim) throw new Error(`Cannot map integration scripts into ${distro}`);
    // zsh reads $ZDOTDIR/.zshenv first; that shim hands ZDOTDIR back to the user straight away.
    args.push('sh', '-c', 'USER_ZDOTDIR="${ZDOTDIR:-$HOME}" ZDOTDIR="$1" exec zsh -i', 'sh', shim);
  } else {
    const rc = await ctx.toPosix(distro, join(dir, 'arctri.bash'));
    if (!rc) throw new Error(`Cannot map integration scripts into ${distro}`);
    args.push('bash', '--rcfile', rc, '-i');
  }
  const plan: LaunchPlan = { file: profile.executable, args, cwd: homedir(), env };
  if (note) plan.note = note;
  return plan;
}

/** A shell on this machine (macOS): started directly as a login shell, with the integration script handed over by environment. */
function buildLocalLaunch(profile: ShellProfile, env: Record<string, string>, ctx: LaunchContext): LaunchPlan {
  const dir = integrationDir();
  // Finder starts apps without a UTF-8 locale; the terminal needs one
  if (!env['LANG'] && !env['LC_ALL']) env['LANG'] = 'en_US.UTF-8';
  const cwd = localCwd(ctx.cwd);
  if (profile.shell === 'zsh') {
    // zsh reads $ZDOTDIR/.zshenv first; that shim hands ZDOTDIR back to the user straight away.
    env['USER_ZDOTDIR'] = process.env['ZDOTDIR'] ?? homedir();
    env['ZDOTDIR'] = join(dir, 'zsh');
    return { file: profile.executable, args: ['-l', '-i'], cwd, env };
  }
  if (profile.shell === 'bash') {
    return { file: profile.executable, args: ['--rcfile', join(dir, 'arctri.bash'), '-i'], cwd, env };
  }
  return { file: profile.executable, args: profile.args ?? ['-l'], cwd, env };
}
