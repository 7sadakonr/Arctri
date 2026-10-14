import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('focus', cb);
  window.addEventListener('blur', cb);
  return () => {
    window.removeEventListener('focus', cb);
    window.removeEventListener('blur', cb);
  };
};

/** Whether this window is the one the user is working in. */
export const useWindowFocused = (): boolean => useSyncExternalStore(subscribe, () => document.hasFocus(), () => true);
