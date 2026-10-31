/** `mod` is Cmd on a Mac and Ctrl elsewhere; `ctrl` is always the Control key. */
export interface KeySpec {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Shift is not part of the chord (`+` needs it on most keyboards). */
  anyShift?: boolean;
}
export type PlatformKeys = KeySpec | { mac: KeySpec; other: KeySpec };

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/**
 * The key of a chord as a lower-case name that does not depend on the keyboard layout: with a modifier held, a letter key is named
 * by its physical position (Ctrl+V on a Thai layout reports `อ` as the key, but `KeyV` as the code).
 */
export function chordLetter(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): string {
  const m = /^Key([A-Z])$/.exec(e.code ?? '');
  return m && (e.ctrlKey || e.metaKey || e.altKey) ? m[1]!.toLowerCase() : e.key.toLowerCase();
}

const pick = (k: PlatformKeys, mac: boolean): KeySpec => ('mac' in k ? (mac ? k.mac : k.other) : k);

export function matchKey(e: KeyEventLike, keys: PlatformKeys | PlatformKeys[], mac: boolean): boolean {
  return (Array.isArray(keys) ? keys : [keys]).some((k) => {
    const s = pick(k, mac);
    if (e.key.toLowerCase() !== s.key) return false;
    const wantCtrl = !!s.ctrl || (!!s.mod && !mac);
    const wantMeta = !!s.mod && mac;
    return e.ctrlKey === wantCtrl && e.metaKey === wantMeta && e.altKey === !!s.alt && (!!s.anyShift || e.shiftKey === !!s.shift);
  });
}

const ACCEL_KEYS: Record<string, string> = { tab: 'Tab', ',': ',', '=': 'Plus', '+': 'Plus', '-': '-' };

/** The Electron accelerator for the Mac menu bar, where the key is only displayed. */
export function toAccelerator(keys: PlatformKeys | PlatformKeys[] | undefined): string | undefined {
  if (!keys) return undefined;
  const s = pick(Array.isArray(keys) ? keys[0]! : keys, true);
  const key = s.key.length === 1 && /[a-z]/.test(s.key) ? s.key.toUpperCase() : s.key === 'f2' ? 'F2' : ACCEL_KEYS[s.key] ?? s.key;
  return [s.mod ? 'Cmd' : '', s.ctrl ? 'Ctrl' : '', s.alt ? 'Alt' : '', s.shift ? 'Shift' : '', key].filter(Boolean).join('+');
}
