// Starts a built/installed Arctri, waits until a real shell session reaches its prompt with
// shell integration active, and checks that the native modules loaded.
//   node scripts/smoke-installed.mjs [path-to-Arctri.exe] [--install <Setup.exe>]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const installIdx = args.indexOf('--install');
let exe = args.find((a) => !a.startsWith('--') && a !== args[installIdx + 1]) ?? 'release/win-unpacked/Arctri.exe';
let installDir;

if (installIdx >= 0) {
  const setup = resolve(args[installIdx + 1]);
  installDir = mkdtempSync(join(tmpdir(), 'arctri install '));
  console.log('silent install ->', installDir);
  execFileSync(setup, ['/S', `/D=${installDir}`], { stdio: 'inherit' });
  exe = join(installDir, 'Arctri.exe');
}
if (!existsSync(exe)) {
  console.error('not found:', exe);
  process.exit(2);
}

const data = mkdtempSync(join(tmpdir(), 'arctri-smoke-'));
const out = join(data, 'smoke.json');
const t0 = Date.now();
const child = spawn(exe, [], {
  env: { ...process.env, ARCTRI_USER_DATA: data, ARCTRI_SMOKE_OUT: out },
  stdio: 'ignore'
});
const code = await new Promise((r) => {
  child.on('exit', r);
  setTimeout(() => {
    child.kill();
    r(-1);
  }, 120_000);
});
let result = { ok: false, reason: 'no result file' };
if (existsSync(out)) result = JSON.parse(readFileSync(out, 'utf8'));
console.log(JSON.stringify({ exitCode: code, seconds: ((Date.now() - t0) / 1000).toFixed(1), ...result }, null, 2));

if (installDir) {
  const un = join(installDir, 'Uninstall Arctri.exe');
  if (existsSync(un)) {
    execFileSync(un, ['/S', `_?=${installDir}`], { stdio: 'inherit' });
    console.log('uninstalled');
  }
  try {
    rmSync(installDir, { recursive: true, force: true });
  } catch {
    /* the uninstaller may still be exiting */
  }
}
rmSync(data, { recursive: true, force: true });
process.exit(result.ok && code === 0 ? 0 : 1);
