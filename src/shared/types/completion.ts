import type { EnvPath, EnvironmentRef, ShellKind } from './env';

export interface CompletionRequest {
  requestId: number;
  sessionId: string;
  line: string;
  /** UTF-16 index into `line`. */
  cursor: number;
}

export type CompletionKind =
  | 'command' | 'path' | 'dir' | 'history' | 'git-subcommand' | 'git-branch' | 'script' | 'flag';

export interface CompletionItem {
  label: string;
  insertText: string;
  /** Range of `line` that insertText replaces. */
  replace: [start: number, end: number];
  kind: CompletionKind;
  detail?: string;
  source: string;
  score: number;
}

export interface CompletionResponse {
  requestId: number;
  items: CompletionItem[];
  /** Full-line history match that can be shown as inline ghost text. */
  ghost?: string;
}

export interface CompletionContext {
  sessionId: string;
  env: EnvironmentRef;
  shell: ShellKind;
  cwd: EnvPath;
  line: string;
  cursor: number;
}
