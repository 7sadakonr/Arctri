import { useCallback } from 'react';
import { resolveLang, translate, type Lang, type MessageKey } from '@shared/i18n';
import { useUi } from '@/stores/ui';

export function useLang(): Lang {
  const pref = useUi((s) => s.prefs.language);
  return resolveLang(pref, navigator.language);
}

export function useT() {
  const lang = useLang();
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang]
  );
}

/** For code outside React (toasts raised from event handlers). */
export function tNow(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(resolveLang(useUi.getState().prefs.language, navigator.language), key, params);
}
