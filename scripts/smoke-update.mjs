// Update path of an installed build (Windows): installs version N, points it at a loopback feed that serves N+1, and checks what happens.
//   node scripts/smoke-update.mjs --old <Setup-N.exe> --feed <dir with N+1 files and its latest.yml> --expect <N+1> [--scenario ok|missing|checksum]
// ok       N is offered N+1, downloads it, restarts into it; settings and the database are still there.
// missing  the feed has nothing (404): an error is reported and N keeps running, untouched.
// checksum the installer in the feed is damaged: the download is rejected and N keeps running, untouched.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const old = arg('old');
const feedDir = arg('feed');
const expect = arg('expect');
const scenario = arg('scenario') ?? 'ok';
if (process.platform !== 'win32' || !old || !feedDir || !expect || !['ok', 'missing', 'checksum'].includes(scenario)) {
  console.error('usage (Windows): node scripts/smoke-update.mjs --old <Setup-N.exe> --feed <dir> --expect <version> [--scenario ok|missing|checksum]');
  process.exit(2);
}

// What the feed serves for this scenario.
let served = resolve(feedDir);
const scratch = mkdtempSync(join(tmpdir(), 'arctri-update-'));
if (scenario === 'missing') {
  served = join(scratch, 'empty');
  mkdirSync(served);
} else if (scenario === 'checksum') {
  served = join(scratch, 'damaged');
  mkdirSync(served);
  for (const n of readdirSync(feedDir)) {
    if (!statSync(join(feedDir, n)).isFile() || n.endsWith('.blockmap')) continue;
    copyFileSync(join(feedDir, n), join(served, n));
    if (n.endsWith('.exe')) appendFileSync(join(served, n), Buffer.from([0]));
  }
}

const server = createServer((req, res) => {
  const file = normalize(join(served, decodeURIComponent((req.url ?? '/').split('?')[0])));
  if (!file.startsWith(served) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-length': statSync(file).size, 'content-type': extname(file) === '.yml' ? 'text/yaml' : 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `http://127.0.0.1:${server.address().port}`;

const installDir = mkdtempSync(join(tmpdir(), 'arctri update '));
const data = join(scratch, 'data');
mkdirSync(data);
// settings the update must not lose
writeFileSync(join(data, 'preferences.json'), JSON.stringify({ prefs: { fontSize: 17 } }));
const out = join(scratch, 'update.json');
const exe = join(installDir, 'Arctri.exe');
const fail = [];
const read = () => (existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const powershell = (script) => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000 }).trim();
  } catch {
    return '';
  }
};
// Processes of the installed app (and only those: matched by path) and any installer still at work.
const running = () =>
  powershell(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir.replace(/'/g, "''")}*' -or $_.ProcessName -like 'Arctri-Setup*' } | ForEach-Object { "$($_.Id) $($_.ProcessName)" }`)
    .split(/\r?\n/).filter(Boolean);
const stopInstalled = () =>
  powershell(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir.replace(/'/g, "''")}*' } | Stop-Process -Force`);

/** Starts the installed app with the test environment and waits for it to write its report and exit. */
const launch = async (install, timeoutMs) => {
  rmSync(out, { force: true });
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      ARCTRI_USER_DATA: data,
      ARCTRI_UPDATE_TEST_FEED: feed,
      ARCTRI_SMOKE_UPDATE_OUT: out,
      ARCTRI_SMOKE_UPDATE_INSTALL: install ? '1' : '0'
    },
    stdio: 'ignore'
  });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  return read();
};

try {
  console.log('install N ->', installDir);
  execFileSync(resolve(old), ['/S', `/D=${installDir}`], { stdio: 'inherit' });
  const exeBefore = statSync(exe).mtimeMs;
  // while the installer replaces the files the exe can be missing for a moment: that is not yet "replaced"
  const replaced = () => {
    try {
      return statSync(exe).mtimeMs !== exeBefore;
    } catch {
      return false;
    }
  };

  const first = await launch(scenario === 'ok', 120_000);
  console.log('first run:', JSON.stringify(first));
  if (!first) fail.push('the installed build wrote no report');
  else if (scenario === 'ok') {
    if (!first.installing) fail.push(`N did not start the update: ${JSON.stringify(first.phase)}`);
    else {
      // The silent installer replaces the files and may start the app again; that copy has not got this script's environment
      // (Windows starts it through the shell), so it is only waited for and stopped, and the new version is read by starting it here.
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline && !replaced()) await sleep(2000);
      if (!replaced()) fail.push('the installer did not replace the app within 150 s');
      while (Date.now() < deadline && running().some((l) => /Arctri-Setup/.test(l))) await sleep(2000);
      await sleep(5000);
      console.log('still running after the install:', JSON.stringify(running()));
      stopInstalled();
      await sleep(2000);
      const after = await launch(false, 120_000);
      console.log('after update:', JSON.stringify(after));
      if (after?.current !== expect) fail.push(`expected version ${expect} after the update, got ${after?.current}`);
      else if (after.phase?.kind !== 'up-to-date') fail.push(`N+1 should be up to date, is ${JSON.stringify(after.phase)}`);
    }
  } else {
    if (first.phase?.kind !== 'error') fail.push(`expected an error, got ${JSON.stringify(first.phase)}`);
    else if (scenario === 'checksum' && first.phase.code !== 'checksum') fail.push(`expected a checksum error, got ${first.phase.code}`);
    if (first.current === expect) fail.push('the app changed version although the update was rejected');
  }

  // user data survives in every scenario
  const prefsFile = join(data, 'preferences.json');
  const fontSize = existsSync(prefsFile) ? JSON.parse(readFileSync(prefsFile, 'utf8')).prefs?.fontSize : undefined;
  if (fontSize !== 17) fail.push(`preferences lost (fontSize ${fontSize})`);
  if (scenario === 'ok' && !existsSync(join(data, 'arctri.db'))) fail.push('arctri.db is missing after the update');
} finally {
  server.close();
  stopInstalled();
  const un = join(installDir, 'Uninstall Arctri.exe');
  if (existsSync(un)) {
    try {
      execFileSync(un, ['/S', `_?=${installDir}`], { stdio: 'inherit' });
    } catch {
      /* best effort */
    }
  }
  for (const d of [installDir, scratch]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* the uninstaller may still be exiting */
    }
  }
}

if (fail.length) {
  for (const f of fail) console.error(`::error::${scenario}: ${f}`);
  process.exit(1);
}
console.log(`update smoke (${scenario}) passed`);
