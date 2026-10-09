export type EnvironmentRef = { kind: 'windows' } | { kind: 'wsl'; distro: string };
export type WinPath = string & { readonly __brand: 'WinPath' };
export type PosixPath = string & { readonly __brand: 'PosixPath' };
export type EnvPath =
  | { env: 'windows'; path: WinPath }
  | { env: 'wsl'; distro: string; path: PosixPath };
export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'other';

export interface ShellProfile {
  id: string;
  label: string;
  env: EnvironmentRef;
  shell: ShellKind;
  /** Windows executable that is spawned (pwsh.exe, cmd.exe, wsl.exe). */
  executable: string;
  integration: 'blocks' | 'cwd-only' | 'none';
}

export const envKeyOf = (env: EnvironmentRef, shell: ShellKind): string =>
  env.kind === 'windows' ? `windows:${shell}` : `wsl:${env.distro}:${shell}`;

export const sameEnv = (a: EnvironmentRef, b: EnvironmentRef): boolean =>
  a.kind === b.kind && (a.kind === 'windows' || (b.kind === 'wsl' && a.distro === b.distro));
