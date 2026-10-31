import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useEditors } from '@/stores/editors';
import { useLayout } from '@/stores/layout';

/** The main process refuses to update a branch under files with unsaved edits, so it is told which those are (per session). */
export function useReportUnsaved(): void {
  const dirty = useEditors((s) => s.dirty);
  const tabs = useLayout((s) => s.tabs);
  const reported = useRef(new Map<string, string>());
  useEffect(() => {
    const now = new Map<string, string[]>();
    for (const t of Object.values(tabs)) {
      if (t.kind !== 'file' || !dirty[t.key]) continue;
      now.set(t.sessionId, [...(now.get(t.sessionId) ?? []), t.path ?? t.rel]);
    }
    for (const [id, paths] of now) {
      const sig = JSON.stringify(paths);
      if (reported.current.get(id) !== sig) {
        reported.current.set(id, sig);
        api.gitSync.reportUnsaved(id, paths);
      }
    }
    for (const id of [...reported.current.keys()]) {
      if (now.has(id)) continue;
      reported.current.delete(id);
      api.gitSync.reportUnsaved(id, []);
    }
  }, [dirty, tabs]);
}
