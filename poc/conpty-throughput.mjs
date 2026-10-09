// How fast can ConPTY itself move bytes? No flow control, no parser: just drain the PTY.
import pty from 'node-pty';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = join(tmpdir(), 'ad-8mb.txt');
if (!existsSync(file)) writeFileSync(file, ('x'.repeat(119) + '\n').repeat(Math.floor((8 * 1024 * 1024) / 120)));

function run(label, exe, args, dll) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let bytes = 0;
    const p = pty.spawn(exe, args, { cols: 120, rows: 30, useConptyDll: dll });
    p.onData((d) => (bytes += d.length));
    const guard = setTimeout(() => { console.log(label + ' dll=' + dll + ' TIMEOUT after 120s bytes=' + (bytes / 1048576).toFixed(1) + 'MB'); try { p.kill(); } catch {} resolve(); }, 120000);
    p.onExit(() => {
      clearTimeout(guard);
      const s = (Date.now() - t0) / 1000;
      console.log(`${label} dll=${dll} bytes=${(bytes / 1048576).toFixed(1)}MB seconds=${s.toFixed(1)} rate=${(bytes / 1048576 / s).toFixed(1)}MB/s`);
      resolve();
    });
  });
}

const sys = process.env.SystemRoot + '\\System32\\';
for (const dll of [true, false]) {
  await run('cmd-type      ', sys + 'cmd.exe', ['/c', 'type', file], dll);
  await run('pwsh-getcontent', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', ['-NoProfile', '-Command', `Get-Content -Raw '${file}' | Write-Host -NoNewline`], dll);
  await run('wsl-base64    ', sys + 'wsl.exe', ['-d', 'Ubuntu', '--exec', 'sh', '-c', 'head -c 6000000 /dev/zero | base64 -w 120'], dll);
}
