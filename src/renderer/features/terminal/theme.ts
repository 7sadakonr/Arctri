import type { ITheme } from '@xterm/xterm';

/** Terminal-only face; the rest of the app keeps --font-mono (Roboto Mono) in styles/globals.css. */
export const TERMINAL_FONT = "'Cascadia Mono', 'Arctri Thai', 'Leelawadee UI', Thonburi, Consolas, 'SF Mono', Menlo, monospace";

/** Extra device pixels per cell. Kept at 0: tightening cells crowds the Thai fallback glyphs and stacked vowels/tone marks. */
export const TERMINAL_LETTER_SPACING = 0;

let fontsReady: Promise<void> | undefined;

/** Loads the faces canvas drawing needs; the Thai range is only fetched when text uses it, so ask for it by name. */
export function terminalFontsReady(): Promise<void> {
  fontsReady ??= Promise.all(
    ['400', '600'].flatMap((w) => [
      document.fonts.load(`${w} 13px 'Cascadia Mono'`, 'Aa'),
      document.fonts.load(`${w} 13px 'Arctri Thai'`, 'กิ่ง')
    ])
  ).then(
    () => undefined,
    () => undefined
  );
  return fontsReady;
}

const ANSI_DARK = [
  '#2b2e3b', '#f2777a', '#8fcf8f', '#e5c07b', '#6fa8f0', '#c792ea', '#5fc9d6', '#c9ccd6',
  '#5b6073', '#ff9296', '#a9e4a9', '#f0d28f', '#8dbcf7', '#d9aef4', '#85dbe6', '#eef0f6'
];
const ANSI_LIGHT = [
  '#2b2e3b', '#c7372f', '#2f8a3a', '#a06a00', '#2358c4', '#8a3fb5', '#13808f', '#a9adbb',
  '#5b6073', '#e0554c', '#3fa24c', '#b8800d', '#3a73e0', '#a259cc', '#2a98a8', '#f3f4f8'
];

export const ansiPalette = (dark: boolean): string[] => (dark ? ANSI_DARK : ANSI_LIGHT);

export function terminalTheme(dark: boolean): ITheme {
  const p = ansiPalette(dark);
  return {
    background: dark ? '#0a0a0a' : '#ededed',
    foreground: dark ? '#ededed' : '#111111',
    cursor: dark ? '#f2f2f2' : '#111111',
    cursorAccent: dark ? '#0a0a0a' : '#ededed',
    selectionBackground: dark ? '#383838' : '#cfcfcf',
    black: p[0]!, red: p[1]!, green: p[2]!, yellow: p[3]!, blue: p[4]!, magenta: p[5]!, cyan: p[6]!, white: p[7]!,
    brightBlack: p[8]!, brightRed: p[9]!, brightGreen: p[10]!, brightYellow: p[11]!,
    brightBlue: p[12]!, brightMagenta: p[13]!, brightCyan: p[14]!, brightWhite: p[15]!
  };
}

/** CSS colour for a snapshot colour token ('p<n>' or '#rrggbb'). */
export function resolveColor(token: string | null, dark: boolean): string | undefined {
  if (!token) return undefined;
  if (token.startsWith('#')) return token;
  const n = Number(token.slice(1));
  if (n < 16) return ansiPalette(dark)[n];
  if (n < 232) {
    const i = n - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}
