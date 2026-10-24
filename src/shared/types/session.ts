import type { EnvPath, EnvironmentRef, ShellKind } from './env';

export type SessionId = string;
export type Presentation = 'blocks' | 'classic';
export type ShellPhase = 'unknown' | 'prompt' | 'editing' | 'executing';
export type IntegrationStatus = 'pending' | 'active' | 'unavailable' | 'degraded';
export type AgentId = 'claude-code' | 'codex';

export interface SessionSpec {
  profileId: string;
  kind: 'shell' | 'agent';
  cwd?: EnvPath;
  agent?: { adapterId: AgentId; options: AgentLaunchOptions };
  presentation?: Presentation;
  title?: string;
  cols: number;
  rows: number;
}

export interface AgentLaunchOptions {
  resume?: 'last' | 'picker';
  model?: string;
  permissionMode?: string;
  extraArgs?: string[];
}

export interface SessionInfo {
  id: SessionId;
  title: string;
  titleSource: 'user' | 'auto';
  profileId: string;
  env: EnvironmentRef;
  shell: ShellKind;
  kind: 'shell' | 'agent';
  agentId?: AgentId;
  presentation: Presentation;
  integration: IntegrationStatus;
  phase: ShellPhase;
  cwd?: EnvPath;
  gitBranch?: string;
  pid: number;
  state: 'starting' | 'running' | 'exited' | 'failed';
  exit?: { code: number | null; reason?: string };
  /** Per-session secret that authenticates shell-integration sequences. */
  nonce: string;
  launchNote?: string;
  /** An agent CLI the user started inside this shell tab; set while that command runs. */
  runningAgent?: { agentId: AgentId; startedAt: number; command: string };
  /** What the agent says it is working on (its own window title), cleaned. Only a label, never a status. */
  agentTopic?: string;
  /** What the agent is doing right now (a tool's description, a file); not saved. The tab shows it while the agent works. */
  agentActivity?: string;
  /** Agent sessions: what the CLI was started with, e.g. "--model opus". */
  launchSummary?: string;
  /** Agent sessions: the user supplied flags that turn permission checks off. */
  unsafeLaunch?: boolean;
  /** Agent sessions: capabilities known at launch (for the toolbar). */
  agentCaps?: import('./agent').AgentCapabilities;
  createdAt: number;
}
