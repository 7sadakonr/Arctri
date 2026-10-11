import { api } from '@/lib/api';
import { useUi } from '@/stores/ui';

/** Shows or hides the sidebar (one setting for the whole window, remembered between runs). */
export function toggleSidebar(): void {
  const open = !useUi.getState().prefs.sidebarOpen;
  void api.prefs.set({ sidebarOpen: open }).then((p) => useUi.getState().setPrefs(p), () => undefined);
}
