import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EnvironmentRef } from '@shared/types/env';
import { claudeSettings, hooksSupported, isSafeHookPath } from './launch';

export const SHELL_STATUS_VARS = ['ARCTRI_EVENTS_DIR', 'ARCTRI_EVENT_TOKEN', 'ARCTRI_HOOK_SCRIPT', 'ARCTRI_CLAUDE_SETTINGS'] as const;

export interface ShellStatusInput {
  env: EnvironmentRef;
  /** Shells whose integration script defines the `claude` / `codex` wrappers. */
  shell: string;
  nonce: string;
  eventsDir: string;
  settingsPath: string;
  script: string;
  toPosix: (distro: string, winPath: string) => Promise<string | null>;
}

/**
 * The environment that lets `claude` and `codex` typed into a bash or zsh tab report their status. Writes the settings file.
 * Returns null where hooks are not offered (Windows-native shells, other shells) or a path cannot be used safely.
 */
export async function buildShellStatusEnv(i: ShellStatusInput): Promise<Record<string, string> | null> {
  if (!hooksSupported(i.env.kind === 'windows' ? 'windows' : i.env.kind === 'wsl' ? 'wsl' : 'local')) return null;
  if (i.shell !== 'bash' && i.shell !== 'zsh') return null;
  const conv = async (p: string) => (i.env.kind === 'wsl' ? i.toPosix(i.env.distro, p) : p);
  const [dir, settings, script] = await Promise.all([conv(i.eventsDir), conv(i.settingsPath), conv(i.script)]);
  if (!dir || !settings || !script || !isSafeHookPath(script) || !isSafeHookPath(settings)) return null;
  mkdirSync(dirname(i.settingsPath), { recursive: true });
  writeFileSync(i.settingsPath, claudeSettings(script), { mode: 0o600 });
  return { ARCTRI_EVENTS_DIR: dir, ARCTRI_EVENT_TOKEN: i.nonce, ARCTRI_HOOK_SCRIPT: script, ARCTRI_CLAUDE_SETTINGS: settings };
}
