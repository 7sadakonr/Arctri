import { execFile, execFileSync } from 'node:child_process';

/** A process as it was when its tree was recorded. Start time guards against a reused PID. */
export interface ProcRef {
  pid: number;
  startedAt: string;
}

interface PsRow {
  pid: number;
  ppid: number;
  started: string;
}

/** `ps -A -o pid=,ppid=,lstart=` lines, e.g. `  412     1 Mon Jan  1 12:00:00 2024`. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), started: m[3]!.replace(/\s+/g, ' ') });
  }
  return rows;
}

/** The root and everything below it, as recorded in the process table. */
export function descendants(root: number, rows: PsRow[]): PsRow[] {
  const byParent = new Map<number, PsRow[]>();
  for (const r of rows) byParent.set(r.ppid, [...(byParent.get(r.ppid) ?? []), r]);
  const out: PsRow[] = rows.filter((r) => r.pid === root);
  for (let i = 0; i < out.length; i++) {
    for (const c of byParent.get(out[i]!.pid) ?? []) if (!out.some((o) => o.pid === c.pid)) out.push(c);
  }
  return out;
}

function psTable(): Promise<PsRow[]> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { timeout: 8000, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (_e, out) =>
      resolve(parsePs(String(out ?? '')))
    );
  });
}

const signal = (pid: number): void => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
};

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
  if (roots.length === 0) return out;
  if (process.platform !== 'win32') {
    const rows = await psTable();
    for (const root of roots) out.set(root, descendants(root, rows).map((r) => ({ pid: r.pid, startedAt: r.started })));
    return out;
  }
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
  if (procs.length === 0) return;
  if (process.platform !== 'win32') {
    const now = new Map((await psTable()).map((r) => [r.pid, r.started]));
    // children first, so a shell cannot start new ones while it is still alive
    for (const p of [...procs].reverse()) if (now.get(p.pid) === p.startedAt) signal(p.pid);
    return;
  }
  const items = procs.map((p) => `@(${Math.trunc(p.pid)},${p.startedAt})`).join(',');
  await powershell(
    `foreach ($x in @(${items})) { $p = Get-Process -Id $x[0] -ErrorAction SilentlyContinue; ` +
      `if ($p -and $p.StartTime.ToFileTimeUtc() -eq $x[1]) { Stop-Process -Id $x[0] -Force -ErrorAction SilentlyContinue } }`,
    8000
  );
}

/**
 * Ends a process tree and returns only when that is done. For the last moments of the app, when nothing asynchronous
 * is going to get a chance to finish. Safe to call on a dead pid.
 */
export function killTreeSync(pid: number): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' });
    else {
      const rows = parsePs(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,lstart='], { timeout: 3000, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }));
      for (const r of descendants(pid, rows).reverse()) signal(r.pid);
    }
  } catch {
    /* already gone, or taskkill found nothing to end */
  }
}

/** Kills a process and everything it spawned. Safe to call on a dead pid. */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform !== 'win32') {
      void psTable().then((rows) => {
        for (const r of descendants(pid, rows).reverse()) signal(r.pid);
        resolve();
      });
      return;
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}
