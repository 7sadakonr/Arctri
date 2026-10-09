import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { blockText } from '@shared/types/block';
import { Harness, allProfiles, waitFor } from './harness';
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

for (const id of ['powershell', 'pwsh', 'wsl:Ubuntu:bash', 'wsl:Ubuntu:zsh'].filter(
  (x) => !process.env['ARCTRI_SKIP_WSL'] || !x.startsWith('wsl:')
)) {
  const isPs = id === 'powershell' || id === 'pwsh';
  describe(`block output capture: ${id}`, () => {
    it('captures exact output for consecutive commands', async () => {
      h = new Harness(profiles);
      await h.start(id);
      await h.run('echo first-output');
      await h.run(isPs ? "Write-Output 'a'; Write-Output 'b'" : 'printf "a\\nb\\n"');
      await h.run(isPs ? 'cmd /c exit 7' : '(exit 7)');
      await waitFor(() => h!.blocks.length === 3, 5000, 'blocks');
      expect(h.blocks.map((b) => blockText(b.output))).toEqual(['first-output', 'a\nb', '']);
      expect(h.blocks.map((b) => b.exitCode)).toEqual([0, 0, 7]);
      expect(h.blocks.map((b) => b.status)).toEqual(['success', 'success', 'failed']);
      expect(h.blocks[2]!.cwd).toBeTruthy();
    });

    it('captures Thai output unchanged', async () => {
      h = new Harness(profiles);
      await h.start(id);
      await h.run(isPs ? "Write-Output 'สวัสดี น้ำ ผู้ใหญ่'" : "printf 'สวัสดี น้ำ ผู้ใหญ่\\n'");
      await waitFor(() => h!.blocks.length === 1, 5000, 'block');
      expect(blockText(h.blocks[0]!.output)).toBe('สวัสดี น้ำ ผู้ใหญ่');
    });

    it('handles large output without losing the boundaries', async () => {
      h = new Harness(profiles);
      await h.start(id);
      await h.run(isPs ? '1..3000 | % { "row $_" }' : 'seq 1 3000 | sed "s/^/row /"', 60000);
      await h.run('echo after-large');
      await waitFor(() => h!.blocks.length === 2, 5000, 'blocks');
      const lines = h.blocks[0]!.output!.lines;
      expect(lines).toHaveLength(3000);
      expect(lines[0]!.runs[0]!.text).toBe('row 1');
      expect(lines[2999]!.runs[0]!.text).toBe('row 3000');
      expect(blockText(h.blocks[1]!.output)).toBe('after-large');
    }, 90000);

    it('survives a resize while a command is running', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const before = h.commands.length;
      h.manager.submitCommand(h.info.id, isPs ? '1..40 | % { "tick $_"; Start-Sleep -Milliseconds 50 }' : 'for i in $(seq 1 40); do echo tick $i; sleep 0.05; done');
      await waitFor(() => h!.info.phase === 'executing', 10000, 'executing');
      for (let i = 0; i < 12; i++) {
        const cols = 60 + (i % 5) * 20;
        h.term.resize(cols, 24 + (i % 3));
        h.manager.resize(h.info.id, cols, 24 + (i % 3));
        await new Promise((r) => setTimeout(r, 40));
      }
      await waitFor(() => h!.commands.length > before && h!.info.phase === 'editing', 30000, 'done');
      await waitFor(() => h!.blocks.length === 1, 5000, 'block');
      const text = blockText(h.blocks[0]!.output);
      expect(text).toContain('tick 1\n');
      expect(text).toContain('tick 40');
      expect(text.match(/tick \d+/g)!.length).toBe(40);
    }, 60000);
  });
}
