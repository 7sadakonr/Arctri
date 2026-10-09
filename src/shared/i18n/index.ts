import { en, type MessageKey } from './en';
import { th } from './th';

export type { MessageKey };
export type Lang = 'en' | 'th';

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, th };

export function resolveLang(pref: 'auto' | 'en' | 'th', systemLocale: string): Lang {
  if (pref !== 'auto') return pref;
  return systemLocale.toLowerCase().startsWith('th') ? 'th' : 'en';
}

export function translate(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  let text = dictionaries[lang][key] ?? en[key];
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return `${m}m ${rest}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
