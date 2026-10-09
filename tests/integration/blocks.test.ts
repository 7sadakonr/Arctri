import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Harness, allProfiles, sleep, waitFor } from './harness';
import type { ShellProfile } from '@shared/types/env';

let profiles: ShellProfile[] = [];
beforeAll(async () => {
  profiles = await allProfiles();
});

const targets = ['powershell', 'pwsh', 'wsl:Ubuntu:bash', 'wsl:Ubuntu:zsh'].filter(
  (id) => !process.env['ARCTRI_SKIP_WSL'] || !id.startsWith('wsl:')
);
let h: Harness | undefined;
afterEach(async () => {
  await h?.stop();
  h = undefined;
});

for (const id of targets) {
  describe(`command blocks: ${id}`, () => {
    const ok = () => profiles.some((p) => p.id === id);
    const isPs = id === 'powershell' || id === 'pwsh';

    it('detects the profile', () => {
      expect(ok(), `profile ${id} not found`).toBe(true);
    });

    it('splits commands with exit codes', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const a = await h.run('echo hello-block');
      expect(a.command).toBe('echo hello-block');
      expect(a.exitCode).toBe(0);
      const b = await h.run(isPs ? 'cmd /c exit 3' : '(exit 3)');
      expect(b.exitCode).toBe(3);
      const c = await h.run(isPs ? 'Get-Date | Out-Null' : 'true');
      expect(c.exitCode).toBe(0);
      expect(h.commands.map((x) => x.command)).toEqual([
        'echo hello-block', isPs ? 'cmd /c exit 3' : '(exit 3)', isPs ? 'Get-Date | Out-Null' : 'true'
      ]);
      for (const cmd of h.commands) expect(cmd.endedAt).toBeGreaterThanOrEqual(cmd.startedAt);
    });

    it('keeps Thai text and quotes in command text', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const cmd = `echo "สวัสดี น้ำ ผู้ใหญ่ it's"`;
      const r = await h.run(cmd);
      expect(r.command).toBe(cmd);
    });

    it('reports cwd', async () => {
      h = new Harness(profiles);
      await h.start(id);
      await waitFor(() => h!.info.cwd, 5000, 'cwd');
      expect(h.info.cwd!.path.length).toBeGreaterThan(0);
    });

    it('tracks a long-running command and Ctrl+C', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const before = h.commands.length;
      expect(h.manager.submitCommand(h.info.id, isPs ? 'Start-Sleep 30' : 'sleep 30').ok).toBe(true);
      await waitFor(() => h!.info.phase === 'executing', 10000, 'executing');
      expect(h.manager.submitCommand(h.info.id, 'echo nope')).toEqual({ ok: false, reason: 'not-at-prompt' });
      await sleep(500);
      h.manager.write(h.info.id, '\x03');
      await waitFor(() => h!.commands.length > before && h!.info.phase === 'editing', 15000, 'interrupt');
      expect(h.commands[before]!.exitCode).not.toBe(0);
    });
  });
}
