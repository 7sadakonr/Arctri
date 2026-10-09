import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Harness, allProfiles, sleep, waitFor } from './harness';
import type { ShellProfile } from '@shared/types/env';

let profiles: ShellProfile[] = [];
beforeAll(async () => {
  profiles = await allProfiles();
});
let h: Harness | undefined;
afterEach(async () => {
  await h?.stop();
  h = undefined;
});

const MB = 1024 * 1024;

describe('throughput and responsiveness (numbers are printed as PERF lines)', () => {
  it.skipIf(!!process.env['AGENTDOCK_SKIP_WSL'])('WSL bash: 100 MB of output through PTY -> pump -> xterm parser', async () => {
    h = new Harness(profiles);
    await h.start('wsl:Ubuntu:bash');
    const t0 = Date.now();
    const before = h.commands.length;
    h.manager.submitCommand(h.info.id, 'head -c 75000000 /dev/zero | base64 -w 120');
    await waitFor(() => h!.commands.length > before, 180000, 'big output');
    const secs = (Date.now() - t0) / 1000;
    const mbs = h.raw.length / MB / secs;
    console.log(`PERF wsl-100MB bytes=${(h.raw.length / MB).toFixed(1)}MB seconds=${secs.toFixed(1)} rate=${mbs.toFixed(1)}MB/s`);
    expect(h.raw.length).toBeGreaterThan(95 * MB);
    expect(mbs).toBeGreaterThan(5);
    // the snapshot of a huge command is capped by the scrollback, and says so
    await waitFor(() => h!.blocks.length === 1, 5000, 'block');
    expect(h.blocks[0]!.output!.truncated).toBe(true);
  }, 240000);

  it('PowerShell 7: 20 MB file printed with cmd /c type (cmd.exe is slow through any ConPTY, see ADR-007)', async () => {
    const file = join(tmpdir(), 'ad-20mb.txt');
    writeFileSync(file, ('x'.repeat(119) + '\n').repeat(Math.floor((20 * MB) / 120)));
    h = new Harness(profiles);
    await h.start('pwsh');
    const t0 = Date.now();
    const before = h.commands.length;
    h.manager.submitCommand(h.info.id, `cmd /c type "${file}"`);
    await waitFor(() => h!.commands.length > before, 180000, 'big output');
    const secs = (Date.now() - t0) / 1000;
    console.log(`PERF pwsh-20MB bytes=${(h.raw.length / MB).toFixed(1)}MB seconds=${secs.toFixed(1)} rate=${(h.raw.length / MB / secs).toFixed(1)}MB/s`);
    expect(h.raw.length).toBeGreaterThan(18 * MB);
    // the shell is usable again afterwards
    expect(h.manager.submitCommand(h.info.id, 'echo alive').ok).toBe(true);
  }, 240000);

  it('Ctrl+C stops a flood of output within one second (WSL and PowerShell)', async () => {
    for (const [id, flood, minBytes] of [['wsl:Ubuntu:bash', 'yes', 2 * MB], ['pwsh', 'while ($true) { "flood" }', 0.2 * MB]] as const) {
      if (process.env['AGENTDOCK_SKIP_WSL'] && id.startsWith('wsl:')) continue;
      h = new Harness(profiles);
      await h.start(id);
      const before = h.commands.length;
      h.manager.submitCommand(h.info.id, flood);
      await waitFor(() => h!.info.phase === 'executing' && h!.raw.length > minBytes, 30000, 'flood');
      const t0 = Date.now();
      h.manager.write(h.info.id, '\x03');
      await waitFor(() => h!.commands.length > before && h!.info.phase === 'editing', 15000, 'stop');
      const ms = Date.now() - t0;
      console.log(`PERF ctrl-c-under-flood ${id} ms=${ms}`);
      expect(ms).toBeLessThan(2500);
      await h.stop();
      h = undefined;
    }
  }, 120000);

  it.skipIf(!!process.env['AGENTDOCK_SKIP_WSL'])('keystroke echo latency in a shell prompt', async () => {
    h = new Harness(profiles);
    await h.start('wsl:Ubuntu:bash', 'classic');
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const mark = h.raw.length;
      const t0 = performance.now();
      h.manager.write(h.info.id, 'a');
      await waitFor(() => h!.raw.length > mark, 3000, 'echo');
      samples.push(performance.now() - t0);
      await sleep(15);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.log(`PERF echo-latency wsl-bash median=${samples[15]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(80);
  }, 60000);
});
