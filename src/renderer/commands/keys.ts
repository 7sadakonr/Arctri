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
