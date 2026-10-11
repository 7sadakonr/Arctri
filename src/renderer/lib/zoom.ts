import { api } from './api';
import { useUi } from '@/stores/ui';

export const ZOOM_STEPS = [0.9, 1, 1.1, 1.25, 1.5];

/** -1 smaller, 1 larger, 0 back to 100%. */
export async function stepZoom(dir: -1 | 0 | 1): Promise<void> {
  const cur = useUi.getState().prefs.uiScale;
  let i = ZOOM_STEPS.reduce((best, v, k) => (Math.abs(v - cur) < Math.abs(ZOOM_STEPS[best]! - cur) ? k : best), 0);
  i = dir === 0 ? ZOOM_STEPS.indexOf(1) : Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir));
  try {
    useUi.getState().setPrefs(await api.prefs.set({ uiScale: ZOOM_STEPS[i]! }));
  } catch {
    /* rejected by the main process; keep the previous scale */
  }
}
