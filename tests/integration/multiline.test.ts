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

const CASES: Array<[string, string, string, string]> = [
  // id, multi-line command, expected output, description
  ['wsl:Ubuntu:bash', 'echo one\necho two', 'one\ntwo', 'two lines'],
  ['wsl:Ubuntu:zsh', 'echo one\necho two', 'one\ntwo', 'two lines'],
  ['pwsh', 'echo one\necho two', 'one\ntwo', 'two lines'],
  ['powershell', 'echo one\necho two', 'one\ntwo', 'two lines'],
  ['wsl:Ubuntu:bash', 'for i in 1 2 3; do\n  echo "n=$i ไทย"\ndone', 'n=1 ไทย\nn=2 ไทย\nn=3 ไทย', 'for loop with Thai and quotes'],
  ['pwsh', 'foreach ($i in 1..3) {\n  "n=$i ไทย"\n}', 'n=1 ไทย\nn=2 ไทย\nn=3 ไทย', 'foreach block with Thai'],
  ['powershell', 'foreach ($i in 1..3) {\n  "n=$i ไทย"\n}', 'n=1 ไทย\nn=2 ไทย\nn=3 ไทย', 'foreach block with Thai']
].filter(([id]) => !process.env['ARCTRI_SKIP_WSL'] || !id!.startsWith('wsl:')) as Array<[string, string, string, string]>;

for (const [id, command, expected, what] of CASES) {
  describe(`multi-line command: ${id}`, () => {
    it(`${what} runs as one command in one block`, async () => {
      h = new Harness(profiles);
      await h.start(id);
      const before = h.commands.length;
      expect(h.manager.submitCommand(h.info.id, command).ok).toBe(true);
      await waitFor(() => h!.commands.length > before && h!.info.phase === 'editing', 20000, 'finish');
      await waitFor(() => h!.blocks.length >= 1, 5000, 'block');
      console.log(`MULTI ${id} [${what}] commands=${h.commands.length - before} blocks=${h.blocks.length} text=${JSON.stringify(h.commands[before]?.command)} out=${JSON.stringify(blockText(h.blocks[0]?.output))}`);
      expect(h.commands.length - before).toBe(1);
      expect(h.blocks).toHaveLength(1);
      expect(blockText(h.blocks[0]!.output)).toBe(expected);
      expect(h.commands[before]!.command.replace(/\r/g, '')).toBe(command);
    });
  });
}

// A multi-line command must behave exactly as if the lines had been typed: state it creates stays.
const SCOPE: Array<[string, string, string, string]> = [
  ['wsl:Ubuntu:bash', 'y=7\nf() { echo "f$y"; }\ncd /tmp\necho set', 'echo "y=$y $(f) $PWD"', 'y=7 f7 /tmp'],
  ['wsl:Ubuntu:zsh', 'y=7\nf() { echo "f$y"; }\ncd /tmp\necho set', 'echo "y=$y $(f) $PWD"', 'y=7 f7 /tmp'],
  ['pwsh', '$y = 7\nfunction f { "f$y" }\nSet-Location $env:TEMP\n"set"', '"y=$y $(f) " + ((Get-Location).Path -eq $env:TEMP)', 'y=7 f7 True'],
  ['powershell', '$y = 7\nfunction f { "f$y" }\nSet-Location $env:TEMP\n"set"', '"y=$y $(f) " + ((Get-Location).Path -eq $env:TEMP)', 'y=7 f7 True']
].filter(([id]) => !process.env['ARCTRI_SKIP_WSL'] || !id!.startsWith('wsl:')) as Array<[string, string, string, string]>;

for (const [id, multi, follow, expected] of SCOPE) {
  describe(`multi-line scope: ${id}`, () => {
    it('variables, functions and the working directory persist after the block', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const a = h.commands.length;
      expect(h.manager.submitCommand(h.info.id, multi).ok).toBe(true);
      await waitFor(() => h!.commands.length > a && h!.info.phase === 'editing', 20000, 'multi');
      const b = h.commands.length;
      expect(h.manager.submitCommand(h.info.id, follow).ok).toBe(true);
      await waitFor(() => h!.commands.length > b && h!.info.phase === 'editing', 20000, 'follow');
      await waitFor(() => h!.blocks.length === 2, 5000, 'blocks');
      expect(blockText(h.blocks[1]!.output)).toBe(expected);
      expect(h.commands[a]!.command).toBe(multi);
    });

    it('reports the exit status of the last line and keeps the wrapper out of the history list we record', async () => {
      h = new Harness(profiles);
      await h.start(id);
      const cmd = id.startsWith('wsl') ? 'echo before\nfalse' : 'echo before\ncmd /c exit 4';
      const a = h.commands.length;
      h.manager.submitCommand(h.info.id, cmd);
      await waitFor(() => h!.commands.length > a && h!.info.phase === 'editing', 20000, 'status');
      expect(h.commands[a]!.exitCode).toBe(id.startsWith('wsl') ? 1 : 4);
      expect(h.commands[a]!.command).toBe(cmd);
      expect(h.commands[a]!.command).not.toMatch(/base64|__ad_sb/i);
    });
  });
}
