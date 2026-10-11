/** `local` is the machine the app runs on when it is not Windows (macOS): plain POSIX paths and shells. */
export type EnvironmentRef = { kind: 'windows' } | { kind: 'wsl'; distro: string } | { kind: 'local' };
export type WinPath = string & { readonly __brand: 'WinPath' };
export type PosixPath = string & { readonly __brand: 'PosixPath' };
export type EnvPath =
  | { env: 'windows'; path: WinPath }
  | { env: 'wsl'; distro: string; path: PosixPath }
  | { env: 'local'; path: PosixPath };
export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'other';

export interface ShellProfile {
  id: string;
  label: string;
  env: EnvironmentRef;
  shell: ShellKind;
  /** Windows executable that is spawned (pwsh.exe, cmd.exe, wsl.exe). */
  executable: string;
  /** Arguments for shells that are started as a plain program (Git Bash and other Windows Terminal profiles). */
  args?: string[];
  /** WSL only: the distribution's own login shell is used (zsh when it is the login shell and installed, else bash). */
  autoShell?: boolean;
  integration: 'blocks' | 'cwd-only' | 'none';
}

export const envKeyOf = (env: EnvironmentRef, shell: ShellKind): string =>
  env.kind === 'windows' ? `windows:${shell}` : env.kind === 'local' ? `local:${shell}` : `wsl:${env.distro}:${shell}`;

export const sameEnv = (a: EnvironmentRef, b: EnvironmentRef): boolean =>
  a.kind === b.kind && (a.kind !== 'wsl' || (b.kind === 'wsl' && a.distro === b.distro));

/** The name of an environment as a person reads it. */
export const envLabel = (env: EnvironmentRef): string => (env.kind === 'windows' ? 'Windows' : env.kind === 'local' ? 'macOS' : env.distro);

/** The part of a setting key that identifies the environment (`windows`, `local`, `wsl:<distro>`). */
export const envSettingKey = (env: EnvironmentRef): string => (env.kind === 'wsl' ? `wsl:${env.distro}` : env.kind);
