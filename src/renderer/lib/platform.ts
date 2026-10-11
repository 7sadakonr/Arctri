/** The operating system the window runs on. Tests have no preload bridge and count as Windows, the first platform. */
const platform: string = (typeof window !== 'undefined' && window.arctri?.platform) || 'win32';

export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';

interface Mods {
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The modifier of app shortcuts: Cmd on a Mac, Ctrl elsewhere. */
export const modKey = (e: Mods): boolean => (isMac ? e.metaKey : e.ctrlKey);

const MAC_LABELS: Record<string, string> = {
  'Ctrl+Shift+T': '⌘T',
  'Ctrl+Shift+W': '⌘W',
  'Ctrl+Shift+E': '⌘⇧E',
  'Ctrl+Tab': '⌃Tab',
  'Ctrl+Shift+Tab': '⌃⇧Tab',
  'Ctrl+Tab / Ctrl+Shift+Tab': '⌃Tab / ⌃⇧Tab',
  'Ctrl+L': '⌃L',
  'Ctrl+G': '⌃G',
  'Ctrl+C': '⌃C'
};

/**
 * A shortcut as it is written on this platform. Shortcuts are given the Windows way; on a Mac the ones that use the app
 * modifier become Cmd, and the few that are the terminal's own (Ctrl+C, Ctrl+L, Ctrl+Tab...) stay Control.
 * `Mod+C` means "Ctrl+C or Cmd+C, whichever the platform copies with".
 */
export function kbd(shortcut: string): string {
  if (!isMac) return shortcut.replace(/Mod\+/g, 'Ctrl+');
  const exact = MAC_LABELS[shortcut];
  if (exact) return exact;
  return shortcut
    .replace(/(?:Ctrl|Mod)\+Shift\+/g, '⌘⇧')
    .replace(/(?:Ctrl|Mod)\+/g, '⌘')
    .replace(/Alt\+/g, '⌥')
    .replace(/Shift\+/g, '⇧');
}

/** Shortcuts written inside a sentence (`Hide the sidebar (Ctrl+Shift+E)`) follow the platform too. */
export function kbdInText(text: string): string {
  return isMac ? text.replace(/(?:Ctrl\+Shift\+[A-Za-z]|Ctrl\+(?:Enter|Tab|[A-Za-z,=0-]))/g, kbd) : text;
}
