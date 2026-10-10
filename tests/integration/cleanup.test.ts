import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { Harness, allProfiles, sleep, waitFor, wsl } from './harness';
import type { ShellProfile } from '@shared/types/env';

let profiles: ShellProfile[] = [];
beforeAll(async () => {
  profiles = await allProfiles();
});

/** Windows processes with these pids that are still alive. */
function aliveNamed(pids: number[]): string[] {
  if (pids.length === 0) return [];
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id):$($_.ProcessName)" }; exit 0`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean);
}
const alive = (pids: number[]): number[] => aliveNamed(pids).map((x) => Number(x.split(':')[0]));

/** The whole tree below a pid (children, grandchildren...). */
function tree(rootPid: number): number[] {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `$all = Get-CimInstance Win32_Process; $ids = @(${rootPid}); $i = 0; while ($i -lt $ids.Count) { $p = $ids[$i]; $all | Where-Object { $_.ParentProcessId -eq $p } | ForEach-Object { $ids += $_.ProcessId }; $i++ }; $ids`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

describe('process cleanup', () => {
  it('closing tabs leaves no Windows process behind (5 shells, long-running commands, 20 tabs)', async () => {
    const harnesses: Harness[] = [];
    const ids = ['pwsh', 'powershell', 'cmd'];
    for (let i = 0; i < 20; i++) {
      const h = new Harness(profiles);
      const id = ids[i % ids.length]!;
      await h.manager.create({ profileId: id, kind: 'shell', cols: 100, rows: 30, presentation: id === 'cmd' ? 'classic' : 'blocks' });
      harnesses.push(h);
    }
    await sleep(6000);
    const pids = harnesses.flatMap((h) => tree(h.info.pid));
    expect(pids.length).toBeGreaterThanOrEqual(20);
    for (const h of harnesses.filter((x) => x.info.shell !== 'cmd').slice(0, 6)) h.manager.submitCommand(h.info.id, 'Start-Sleep 600');
    await sleep(1500);
    await Promise.all(harnesses.map((h) => h.stop()));
    await waitFor(() => alive(pids).length === 0, 15000, `no leftovers`).catch((e) => {
      throw new Error(`${e.message}; still alive: ${aliveNamed(pids).join(', ')}`);
    });
  }, 120000);

  it.skipIf(!!process.env['ARCTRI_SKIP_WSL'])('closing a WSL tab ends the shell and its foreground program inside the distro', async () => {
    const h = new Harness(profiles);
    await h.start('wsl:Ubuntu:bash');
    const tag = `ad-orphan-${Date.now()}`;
    h.manager.submitCommand(h.info.id, `sleep 3601 ; echo ${tag}`);
    await waitFor(() => h.info.phase === 'executing', 10000, 'executing');
    const count = async () => (await wsl.exec('Ubuntu', ['sh', '-c', 'pgrep -fc "^sleep 3601" || true'])).stdout.trim();
    expect(Number(await count())).toBeGreaterThanOrEqual(1);
    const pid = h.info.pid;
    await h.stop();
    const end = Date.now() + 15000;
    let left = await count();
    while (left !== '0' && Date.now() < end) {
      await sleep(500);
      left = await count();
    }
    expect(left).toBe('0');
    expect(alive([pid])).toEqual([]);
  }, 60000);

  it('closeAll finishes within its limit even with many busy sessions', async () => {
    const hs: Harness[] = [];
    for (let i = 0; i < 6; i++) {
      const h = new Harness(profiles);
      await h.manager.create({ profileId: 'pwsh', kind: 'shell', cols: 100, rows: 30 });
      hs.push(h);
    }
    await sleep(5000);
    const t0 = Date.now();
    await Promise.all(hs.map((h) => h.manager.closeAll(5000)));
    expect(Date.now() - t0).toBeLessThan(6000);
    for (const h of hs) h.term.dispose();
  }, 60000);
});
