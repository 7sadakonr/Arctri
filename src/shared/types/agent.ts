import type { AgentId, AgentLaunchOptions } from './session';
import type { EnvironmentRef } from './env';

export type { AgentId, AgentLaunchOptions };

export interface AgentInstallation {
  id: string;
  adapterId: AgentId;
  env: EnvironmentRef;
  /** What is executed (a Windows path or a command name inside WSL). */
  command: string;
  resolvedPath?: string;
  version?: string;
  source: 'path' | 'login-shell' | 'user-configured';
}

export interface AgentCapabilities {
  resumeLast: boolean;
  resumePicker: boolean;
  launchFlags: { model: boolean; permissionMode: boolean; extraArgs: boolean };
  /** Permission/approval values the CLI accepts at launch and AgentDock offers (never the "skip checks" ones). */
  permissionModes: string[];
  structuredStatus: 'none' | 'hooks-opt-in';
  /** Slash commands that are sent to the CLI as typed text. */
  nativeCommands: Array<{ label: string; text: string; hint: string }>;
}

export interface AgentEntry {
  adapterId: AgentId;
  displayName: string;
  /** One entry per environment; installation is null when not found there. */
  environments: Array<{
    env: EnvironmentRef;
    installation: AgentInstallation | null;
    capabilities?: AgentCapabilities;
    /** WSL distribution that is not running; it is not started just to look for agents. */
    stopped?: boolean;
  }>;
}
