import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface ChangesData {
  files: Array<{ path: string; status: string; added: number; deleted: number }>;
  added: number;
  deleted: number;
}

/** Changed files of the tab's repository, refreshed every few seconds while something is looking at them. */
export function useChanges(sessionId: string, enabled: boolean, refreshKey?: unknown): ChangesData | null {
  const [data, setData] = useState<ChangesData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      void api.files.changes(sessionId).then((d) => {
        if (alive) setData(d);
      }, () => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, enabled, refreshKey]);
  return data;
}
