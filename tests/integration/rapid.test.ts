import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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

for (const id of ['pwsh', 'powershell', 'wsl:Ubuntu:bash', 'wsl:Ubuntu:zsh'].filter(
  (x) => !process.env['ARCTRI_SKIP_WSL'] || !x.startsWith('wsl:')
)) {
  describe(`back-to-back commands: ${id}`, () => {
    it('runs 25 commands submitted as soon as the previous one finished', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const sent: string[] = [];
      for (let i = 0; i < 25; i++) {
        const cmd = `echo item-${i}`;
        sent.push(cmd);
        const before = h.commands.length;
        // submit immediately when the previous command is done, like a fast user or "run again"
        await waitFor(() => (h!.manager.submitCommand(h!.info.id, cmd).ok ? true : undefined), 15000, `submit ${cmd}`);
        await waitFor(() => h!.commands.length > before, 15000, `finish ${cmd}`);
      }
      expect(h.commands.map((c) => c.command)).toEqual(sent);
    }, 120000);
  });
}
