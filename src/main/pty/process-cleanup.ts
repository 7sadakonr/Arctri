import { execFile } from 'node:child_process';

/** A process as it was when its tree was recorded. Start time guards against a reused PID. */
export interface ProcRef {
  pid: number;
  startedAt: string;
}

function powershell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
      (_err, stdout) => resolve(String(stdout ?? ''))
    );
  });
}

/**
 * Records the processes below each root pid (children, grandchildren...). Once a root has exited its children
 * can no longer be found, so this has to happen before the session is closed.
 */
export async function snapshotTrees(roots: number[]): Promise<Map<number, ProcRef[]>> {
  const out = new Map<number, ProcRef[]>();
  if (process.platform !== 'win32' || roots.length === 0) return out;
  const text = await powershell(
    `$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue; ` +
      `foreach ($root in @(${roots.map((r) => Math.trunc(r)).join(',')})) { ` +
      `$ids = @($root); $i = 0; while ($i -lt $ids.Count) { $p = $ids[$i]; foreach ($c in $all) { if ($c.ParentProcessId -eq $p -and $c.ProcessId -ne $p) { $ids += $c.ProcessId } }; $i++ }; ` +
      `foreach ($c in $all) { if ($ids -contains $c.ProcessId) { "$root $($c.ProcessId) $($c.CreationDate.ToFileTimeUtc())" } } }`,
    8000
  );
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    const list = out.get(Number(m[1])) ?? [];
    list.push({ pid: Number(m[2]), startedAt: m[3]! });
    out.set(Number(m[1]), list);
  }
  return out;
}

/** Ends the recorded processes that are still the same processes. Safe to call on ones that already exited. */
export async function killRecorded(procs: ProcRef[]): Promise<void> {
  if (process.platform !== 'win32' || procs.length === 0) return;
  const items = procs.map((p) => `@(${Math.trunc(p.pid)},${p.startedAt})`).join(',');
  await powershell(
    `foreach ($x in @(${items})) { $p = Get-Process -Id $x[0] -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.StartTime.ToFileTimeUtc() -eq $x[1]) { Stop-Process -Id $x[0] -Force -ErrorAction SilentlyContinue } }`,
    8000
  );
}

/** Kills a process and everything it spawned (Windows). Safe to call on a dead pid. */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !pid) return resolve();
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}
