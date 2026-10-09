import type { EnvPath, EnvironmentRef, ShellKind } from './env';

export interface CellStyle {
  /** 'p<index>' for the 256-colour palette, '#rrggbb' for truecolor, null for default. */
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
  invisible: boolean;
}

export interface StyledRun {
  text: string;
  /** Index into BlockSnapshot.styles. */
  style: number;
}

/** One logical line: terminal rows that were soft-wrapped are joined. */
export interface StyledLine {
  runs: StyledRun[];
}

export interface BlockSnapshot {
  lines: StyledLine[];
  styles: CellStyle[];
  /** Earlier output scrolled out of the terminal scrollback and is not included. */
  truncated: boolean;
  charCount: number;
}

export type BlockStatus = 'running' | 'success' | 'failed' | 'interrupted' | 'unknown';

export interface CommandBlock {
  id: string;
  sessionId: string;
  commandId?: number;
  command: string;
  cwd?: EnvPath;
  env: EnvironmentRef;
  shell: ShellKind;
  status: BlockStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  usedAltScreen: boolean;
  output?: BlockSnapshot;
  collapsed: boolean;
}

export const blockText = (s: BlockSnapshot | undefined): string =>
  s ? s.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n') : '';
