import type { AgentCapabilities, AgentId } from '@shared/types/agent';
import type { AgentLaunchOptions } from '@shared/types/session';

/**
 * Capability-based description of one agent CLI. Only facts that the installed CLI proves
 * (via `--help`) are turned into controls; nothing here parses an agent's screen output.
 */
export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  /** Executable name looked up on PATH. */
  command: string;
  capabilities(help: string): AgentCapabilities;
  buildArgs(caps: AgentCapabilities, o: AgentLaunchOptions): string[];
}

/** Flags that switch permission or approval checks off. AgentDock never sets them itself. */
export const UNSAFE_FLAGS = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo'
];

export const isUnsafeArgs = (args: string[] | undefined): boolean =>
  !!args?.some((a) => UNSAFE_FLAGS.includes(a.split('=')[0]!) || /bypassPermissions|danger-full-access/.test(a));

const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;
export const isSafeValue = (v: string): boolean => SAFE_VALUE.test(v);

const has = (help: string, flag: string): boolean => new RegExp(`(^|[\\s,\\[])${flag.replace(/-/g, '\\-')}(?![\\w-])`, 'm').test(help);

const NATIVE_HINT = 'It only works while the CLI is waiting for input.';

export const claudeCode: AgentAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  command: 'claude',
  capabilities: (help) => ({
    resumeLast: has(help, '--continue'),
    resumePicker: has(help, '--resume'),
    launchFlags: { model: has(help, '--model'), permissionMode: has(help, '--permission-mode'), extraArgs: true },
    permissionModes: has(help, '--permission-mode') ? ['manual', 'acceptEdits', 'plan'].filter((m) => help.includes(m)) : [],
    structuredStatus: 'none',
    nativeCommands: [
      { label: '/model', text: '/model', hint: NATIVE_HINT },
      { label: '/compact', text: '/compact', hint: NATIVE_HINT },
      { label: '/clear', text: '/clear', hint: NATIVE_HINT },
      { label: '/help', text: '/help', hint: NATIVE_HINT }
    ]
  }),
  buildArgs(caps, o) {
    const args: string[] = [];
    if (o.resume === 'last' && caps.resumeLast) args.push('--continue');
    else if (o.resume === 'picker' && caps.resumePicker) args.push('--resume');
    if (o.model && caps.launchFlags.model && isSafeValue(o.model)) args.push('--model', o.model);
    if (o.permissionMode && caps.permissionModes.includes(o.permissionMode)) args.push('--permission-mode', o.permissionMode);
    if (o.extraArgs) args.push(...o.extraArgs);
    return args;
  }
};

export const codex: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex',
  command: 'codex',
  capabilities: (help) => ({
    resumeLast: /^\s*resume\b/m.test(help),
    resumePicker: /^\s*resume\b/m.test(help),
    launchFlags: {
      model: has(help, '--model'),
      permissionMode: has(help, '--ask-for-approval'),
      extraArgs: true
    },
    permissionModes: has(help, '--ask-for-approval')
      ? ['untrusted', 'on-request', 'on-failure'].filter((m) => help.includes(m))
      : [],
    structuredStatus: 'none',
    nativeCommands: [
      { label: '/model', text: '/model', hint: NATIVE_HINT },
      { label: '/approvals', text: '/approvals', hint: NATIVE_HINT },
      { label: '/status', text: '/status', hint: NATIVE_HINT },
      { label: '/new', text: '/new', hint: NATIVE_HINT }
    ]
  }),
  buildArgs(caps, o) {
    const args: string[] = [];
    // Flags come before the `resume` subcommand: `codex [flags] resume --last`.
    if (o.model && caps.launchFlags.model && isSafeValue(o.model)) args.push('--model', o.model);
    if (o.permissionMode && caps.permissionModes.includes(o.permissionMode)) args.push('--ask-for-approval', o.permissionMode);
    if (o.extraArgs) args.push(...o.extraArgs);
    if (o.resume === 'last' && caps.resumeLast) args.push('resume', '--last');
    else if (o.resume === 'picker' && caps.resumePicker) args.push('resume');
    return args;
  }
};

export const ADAPTERS: AgentAdapter[] = [claudeCode, codex];
export const adapterById = (id: AgentId): AgentAdapter => ADAPTERS.find((a) => a.id === id)!;
