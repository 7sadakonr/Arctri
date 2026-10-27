// Runs the integration tests with ARCTRI_INTEGRATION=1 set, the same way on Windows, macOS and Linux
// (`set X=1&& cmd` only works in cmd.exe).
//
// Each test file runs in its own vitest process. ConPTY sessions closed in bulk can crash a process with a native access
// violation that vitest cannot retry by itself; with one process per file, a crash costs one file, names that file, and
// only that file is run again. A file that passes only on the second try is a FLAKE: it is written to the report and, with
// --strict (the release gate), it fails the run unless the file is listed in tests/integration/quarantine.json.
//
//   node scripts/run-integration.mjs [--strict] [--report <file.json>] [--retries <n>] [vitest file filters...]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const strict = flag('strict');
const reportFile = value('report', 'test-results/integration-report.json');
const retries = Number(value('retries', '1'));
const filters = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--report' && argv[i - 1] !== '--retries');

// Files that are known to flake and are tracked as open issues: { "file.test.ts": "why / issue link" }.
const quarantineFile = 'tests/integration/quarantine.json';
const quarantine = existsSync(quarantineFile) ? JSON.parse(readFileSync(quarantineFile, 'utf8')) : {};

const files = readdirSync('tests/integration')
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)))
  .sort();

const run = (file) => {
  const t0 = Date.now();
  const r = spawnSync('npx', ['vitest', 'run', `tests/integration/${file}`], {
    stdio: 'inherit',
    shell: true,
    timeout: 20 * 60_000,
    env: { ...process.env, ARCTRI_INTEGRATION: '1' }
  });
  // a native crash shows up as a signal or a Windows NTSTATUS code (0xC0000005 is an access violation), not as a failed test
  const crashed = r.signal !== null || (r.status !== null && r.status > 255);
  return { ok: r.status === 0, status: r.status, signal: r.signal, crashed, seconds: Math.round((Date.now() - t0) / 1000) };
};

const results = [];
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const attempts = [run(file)];
  while (!attempts.at(-1).ok && attempts.length <= retries) {
    console.log(`::warning title=Integration file failed::${file} failed (status ${attempts.at(-1).status}${attempts.at(-1).crashed ? ', native crash' : ''}); running it once more`);
    attempts.push(run(file));
  }
  const passed = attempts.at(-1).ok;
  results.push({ file, passed, flaky: passed && attempts.length > 1, attempts });
}

const failed = results.filter((r) => !r.passed);
const flaky = results.filter((r) => r.flaky);
const unquarantined = flaky.filter((r) => !(r.file in quarantine));
mkdirSync(dirname(reportFile), { recursive: true });
writeFileSync(reportFile, JSON.stringify({ at: new Date().toISOString(), strict, failed: failed.map((r) => r.file), flaky: flaky.map((r) => r.file), results }, null, 2));

console.log('\nIntegration summary');
for (const r of results) console.log(`  ${r.passed ? (r.flaky ? 'FLAKY' : 'ok   ') : 'FAIL '} ${r.file} (${r.attempts.map((a) => `${a.seconds}s`).join(' + ')})`);
for (const r of flaky) console.log(`::warning title=Flaky integration file::${r.file} passed only on retry${r.file in quarantine ? ` (quarantined: ${quarantine[r.file]})` : ''}`);

if (failed.length) process.exit(1);
if (strict && unquarantined.length) {
  for (const r of unquarantined) console.error(`::error title=Unresolved flake::${r.file} passed only on retry and is not quarantined; fix it or record it in ${quarantineFile}`);
  process.exit(1);
}
process.exit(0);
