import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface ChangesData {
  files: Array<{ path: string; status: string; added: number; deleted: number }>;
  added: number;
  deleted: number;
}

interface Poller {
  data: ChangesData | null;
  listeners: Set<(d: ChangesData | null) => void>;
  timer: ReturnType<typeof setInterval>;
  inflight: boolean;
  misses: number;
}

// One poller per session, shared by everything that shows changes, running only while something is looking and never
// overlapping itself: a slow git on a big repository must not pile up processes.
const pollers = new Map<string, Poller>();

async function load(sessionId: string): Promise<void> {
  const p = pollers.get(sessionId);
  if (!p || p.inflight) return;
  p.inflight = true;
  try {
    const d = await api.files.changes(sessionId);
    // a single empty answer (git timed out) must not make the chip vanish: wait for a second one
    if (d === null && p.data !== null && ++p.misses < 2) return;
    p.misses = 0;
    p.data = d;
    for (const l of p.listeners) l(d);
  } catch {
    /* keep what we have */
  } finally {
    p.inflight = false;
  }
}

function subscribe(sessionId: string, fn: (d: ChangesData | null) => void): () => void {
  let p = pollers.get(sessionId);
  if (!p) {
    p = { data: null, listeners: new Set(), timer: setInterval(() => void load(sessionId), 3000), inflight: false, misses: 0 };
    pollers.set(sessionId, p);
    void load(sessionId);
  } else fn(p.data);
  p.listeners.add(fn);
  return () => {
    const cur = pollers.get(sessionId);
    if (!cur) return;
    cur.listeners.delete(fn);
    if (cur.listeners.size === 0) {
      clearInterval(cur.timer);
      pollers.delete(sessionId);
    }
  };
}

/** Ask for a fresh answer now (a command or an agent turn just ended). */
export const refreshChanges = (sessionId: string): void => void load(sessionId);

/** Changed files of the tab's repository; polls only while `enabled` (the tab is on screen and shows them). */
export function useChanges(sessionId: string, enabled: boolean): ChangesData | null {
  const [data, setData] = useState<ChangesData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return subscribe(sessionId, setData);
  }, [sessionId, enabled]);
  return data;
}
