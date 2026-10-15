// Measures the cost of draining hook event files on the main thread: node scripts/bench-spool.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'arctri-bench-')), 'spool.mjs');
await build({ entryPoints: ['src/main/agents/status/spool.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, external: [] , logLevel: 'silent' });
const { EventSpool } = await import(pathToFileURL(out).href);

const BURST = 100;
for (const tabs of [1, 5, 10]) {
  const root = mkdtempSync(join(tmpdir(), 'arctri-bench-root-'));
  let events = 0;
  const spools = [];
  for (let i = 0; i < tabs; i++) {
    const s = new EventSpool(join(root, `t${i}`), `t${i}`, 'n', () => { events++; });
    s.start();
    spools.push(s);
  }
  for (let i = 0; i < tabs; i++) {
    for (let k = 0; k < BURST; k++) {
      writeFileSync(join(root, `t${i}`, `${String(k).padStart(6, '0')}.json`), JSON.stringify({ nonce: 'n', ts: Date.now() * 1e6, agent: 'claude', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash' } }));
    }
  }
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const t0 = performance.now();
  const per = [];
  for (const s of spools) { const a = performance.now(); await s.drain(); per.push(performance.now() - a); }
  const total = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  h.disable();
  console.log(`${String(tabs).padStart(2)} tabs x ${BURST} events: ${events} read, total ${total.toFixed(1)} ms, longest single drain ${Math.max(...per).toFixed(1)} ms, loop delay max ${(h.max / 1e6).toFixed(1)} ms, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
  for (const s of spools) s.stop();
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
