import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import type { UpdateService } from './update-service';

/**
 * Used by scripts/smoke-update.mjs on an installed build: check, download, report in `outFile`, and (only when the script
 * asks for it) install. The report says which version is running, so the script can tell the old build from the new one.
 */
export async function runUpdateSmoke(update: UpdateService, outFile: string, install: boolean): Promise<void> {
  const report = (extra: Record<string, unknown>) =>
    writeFileSync(outFile, JSON.stringify({ current: app.getVersion(), packaged: app.isPackaged, ...extra }));
  let st = await update.check();
  if (st.phase.kind === 'available') st = await update.download();
  if (install && st.phase.kind === 'downloaded') {
    report({ phase: st.phase, installing: true });
    update.install(true);
    return;
  }
  report({ phase: st.phase, canAutoInstall: st.canAutoInstall });
  app.quit();
}
