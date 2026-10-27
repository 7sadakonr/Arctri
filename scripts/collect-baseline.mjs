// Records the machine and tool versions a measurement was taken on, and optionally runs the measurements, into one
// markdown file under docs/testing/results/ that can be committed (no host name, user name or paths).
//   node scripts/collect-baseline.mjs [--startup <runs>] [--perf] [--out <file.md>]
//   --startup N  starts the unpacked build N times (scripts/smoke-installed.mjs) and reports p50/p95 of "window to first prompt"
//   --perf       runs tests/integration/perf.test.ts and keeps its PERF lines
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem, type as osType } from 'node:os';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const date = new Date().toISOString().slice(0, 10);
const cpu = cpus()[0]?.model.trim() ?? 'unknown';
const slug = `${osType()}-${cpu}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = value('out') ?? join('docs/testing/results', `baseline-${date}-${slug}.md`);

const probe = (file, args) => {
  try {
    return execFileSync(file, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .replace(/\0/g, '') // wsl.exe prints UTF-16
      .trim().split(/\r?\n/).filter(Boolean).slice(0, 12).join('\n');
  } catch {
    return 'not found';
  }
};
const first = (s) => s.split('\n')[0];

const tools = {
  'Node.js': process.version,
  'Windows PowerShell 5.1': probe('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
  'PowerShell 7': probe('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
  'WSL': probe('wsl.exe', ['--version']),
  'WSL distributions': probe('wsl.exe', ['-l', '-v']),
  git: first(probe('git', ['--version'])),
  'Claude Code': first(probe('claude', ['--version'])),
  'Codex CLI': first(probe('codex', ['--version']))
};
let appVersion = 'unknown';
let electronVersion = 'unknown';
try {
  const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
  appVersion = pkg.version;
  electronVersion = pkg.devDependencies?.electron ?? 'unknown';
} catch {
  /* run from the repo root */
}

const percentile = (xs, p) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : undefined;
};

const lines = [`# Baseline ${date}`, '', '## Machine', '',
  `- OS: ${osType()} ${release()}`, `- CPU: ${cpu} (${cpus().length} logical)`, `- RAM: ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
  `- Arctri: ${appVersion} (Electron ${electronVersion})`, '', '## Tools', '',
  ...Object.entries(tools).map(([k, v]) => (v.includes('\n') ? `- ${k}:\n\n  \`\`\`\n${v.split('\n').map((l) => `  ${l}`).join('\n')}\n  \`\`\`` : `- ${k}: ${v}`)), ''];

const runs = Number(value('startup') ?? 0);
if (runs > 0) {
  const seconds = [];
  const prompts = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, ['scripts/smoke-installed.mjs'], { encoding: 'utf8', timeout: 150_000 });
    const m = /\{[\s\S]*\}\s*$/.exec(r.stdout ?? '');
    if (!m) continue;
    const j = JSON.parse(m[0]);
    if (j.ok) {
      seconds.push(Number(j.seconds));
      if (j.timingMs?.prompt) prompts.push(j.timingMs.prompt / 1000);
    }
  }
  lines.push('## Cold start (unpacked build, window to first prompt with integration active)', '',
    `- runs: ${seconds.length} of ${runs} completed`,
    `- total process time p50 / p95: ${percentile(seconds, 50) ?? 'n/a'} s / ${percentile(seconds, 95) ?? 'n/a'} s`,
    `- app uptime at first prompt p50 / p95: ${percentile(prompts, 50)?.toFixed(2) ?? 'n/a'} s / ${percentile(prompts, 95)?.toFixed(2) ?? 'n/a'} s`, '');
}

if (argv.includes('--perf')) {
  const r = spawnSync('node', ['scripts/run-integration.mjs', 'perf'], { encoding: 'utf8', timeout: 30 * 60_000, shell: process.platform === 'win32' });
  const perf = `${r.stdout ?? ''}`.split(/\r?\n/).filter((l) => l.startsWith('PERF'));
  lines.push('## Throughput and latency (tests/integration/perf.test.ts)', '', perf.length ? perf.map((l) => `- \`${l}\``).join('\n') : '- no PERF lines (tests skipped or failed)', '');
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'));
console.log(`written ${out}`);
