import type { AgentId } from '@shared/types/agent';

/** Hooks are injected only where a POSIX `sh` runs them: macOS, Linux and WSL. Windows-native stays `unknown` (no shell is promised). */
export const hooksSupported = (envKind: 'windows' | 'wsl' | 'local'): boolean => envKind !== 'windows';

const SAFE_PATH = /^[A-Za-z0-9._:/@+=,~ -]+$/;
export const isSafeHookPath = (p: string): boolean => SAFE_PATH.test(p) && !p.includes('..');

const CLAUDE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Elicitation', 'ElicitationResult', 'Notification', 'Stop', 'SessionEnd'
] as const;

/** A settings file for `claude --settings`: it adds to the user's own settings and never replaces them. */
export function claudeSettings(script: string): string {
  const command = `sh '${script}' claude`;
  const hooks: Record<string, unknown> = {};
  for (const e of CLAUDE_EVENTS) hooks[e] = [{ hooks: [{ type: 'command', command }] }];
  return JSON.stringify({ hooks });
}

export interface StatusLaunch {
  args: string[];
  /** Absolute path (as the agent sees it) of the settings file to create, when the agent needs one. */
  settingsFile?: { agentPath: string; contents: string };
}

/**
 * Extra launch arguments that make the CLI report its status; `enabled` is true only when `--help` shows the flag it needs.
 * `script` and `settingsPath` are the paths as seen from where the agent runs.
 */
export function statusLaunch(adapter: AgentId, enabled: boolean, script: string, settingsPath: string): StatusLaunch {
  if (!enabled || !isSafeHookPath(script) || !isSafeHookPath(settingsPath)) return { args: [] };
  if (adapter === 'claude-code') {
    return { args: ['--settings', settingsPath], settingsFile: { agentPath: settingsPath, contents: claudeSettings(script) } };
  }
  if (adapter === 'codex') {
    return { args: ['-c', `notify=["sh","${script}","codex"]`] };
  }
  return { args: [] };
}
