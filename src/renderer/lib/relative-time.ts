import { translate, type MessageKey } from '@shared/i18n';

/** "3 hours ago" in the interface language, in whole words. */
export function relativeTime(sec: number, lang: 'en' | 'th', now = Date.now()): string {
  const diff = Math.max(0, Math.round(now / 1000 - sec));
  const say = (one: MessageKey, many: MessageKey, n: number) => translate(lang, n === 1 ? one : many, { n });
  if (diff < 60) return translate(lang, 'time.now');
  if (diff < 3600) return say('time.minute', 'time.minutes', Math.floor(diff / 60));
  if (diff < 86400) return say('time.hour', 'time.hours', Math.floor(diff / 3600));
  if (diff < 86400 * 30) return say('time.day', 'time.days', Math.floor(diff / 86400));
  return new Date(sec * 1000).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB');
}
