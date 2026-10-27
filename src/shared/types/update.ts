export type UpdateChannel = 'beta' | 'stable';

export type UpdateErrorCode = 'offline' | 'not-found' | 'checksum' | 'timeout' | 'unsupported' | 'unknown';

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; code: UpdateErrorCode; message: string };

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  channel: UpdateChannel;
  /** Epoch ms of the last finished check, or null when none has run yet. */
  lastCheckedAt: number | null;
  /** False where the app cannot replace itself (macOS without signing, development, unpackaged): the UI links to the release page instead. */
  canAutoInstall: boolean;
}

export type UpdateInstallResult = { started: true } | { started: false; blocked: 'busy'; busy: number } | { started: false; blocked: 'not-ready' };
