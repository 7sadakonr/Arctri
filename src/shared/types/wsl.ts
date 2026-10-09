export interface WslDistro {
  name: string;
  state: 'Running' | 'Stopped' | 'Installing' | 'Converting' | 'Uninstalling' | 'Unknown';
  version: 1 | 2;
  isDefault: boolean;
  /** Internal distros such as docker-desktop are not offered to the user. */
  hidden: boolean;
}

export type WslStatus =
  | { available: false; reason: 'not-installed' | 'disabled' | 'no-distros' | 'error' | 'loading'; detail?: string }
  | { available: true; defaultDistro?: string };
