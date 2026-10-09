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

// text, cells that xterm (Unicode 11) gives it: base letters 1, combining vowels/tone marks 0
const SAMPLES: Array<[string, number]> = [
  ['สวัสดี', 4], ['น้ำ', 2], ['ผู้ใหญ่', 4], ['ที่นี่', 2], ['ฤๅษี', 3], ['กำลัง', 4], ['abc สวัสดี def', 12]
];

// The marker is spelled by code so the echoed command line itself never contains a literal '|'.
const sh = (id: string, text: string) =>
  id === 'powershell' || id === 'pwsh' ? `[Console]::Out.Write('${text}' + [char]124)` : `printf '%s\\174\\n' '${text}'`;

/** Column (in xterm cells) where the trailing marker landed, on the line that holds the text. */
function markerCol(h: Harness, text: string): { col: number; line: string } | undefined {
  const b = h.term.buffer.active;
  for (let y = b.length - 1; y >= 0; y--) {
    const line = b.getLine(y);
    const t = line?.translateToString(true) ?? '';
    if (!t.includes(text.slice(0, 2)) || !t.includes('|')) continue;
    for (let x = 0; x < line!.length; x++) if (line!.getCell(x)?.getChars() === '|') return { col: x, line: t };
  }
  return undefined;
}

for (const dll of [true, false]) {
  for (const id of ['pwsh', 'powershell', 'wsl:Ubuntu:bash']) {
    if (process.env['AGENTDOCK_SKIP_WSL'] && id.startsWith('wsl:')) continue;
    describe(`Thai cell width through ConPTY (${dll ? 'bundled' : 'inbox'} conpty): ${id}`, () => {
      it('records where the cursor lands after Thai text (printed as THAI lines)', async () => {
        h = new Harness(profiles, { conptyDll: dll, unicode11: true });
        await h.start(id, 'classic');
        // classic mode keeps the shell's own screen so the line can be inspected
        const results: string[] = [];
        for (const [text, cells] of SAMPLES) {
          const before = h.commands.length;
          h.manager.write(h.info.id, '\x15'); // clear anything on the line
          h.manager.submitCommand(h.info.id, sh(id, text));
          await waitFor(() => h!.commands.length > before, 20000, 'sample');
          await sleep(150);
          const r = markerCol(h, text);
          const intact = !!r && r.line.replace(/\|.*$/, '') === text;
          results.push(
            `${text} expect=${cells} got=${r ? r.col : 'n/a'} ${r && r.col === cells ? 'width-ok' : 'width-MISMATCH'} ${intact ? 'text-ok' : 'text-LOST:' + JSON.stringify(r?.line)}`
          );
        }
        console.log(`THAI ${dll ? 'bundled' : 'inbox'} ${id}:\n  ${results.join('\n  ')}`);
        // The bundled ConPTY (the default) must be exact. The Windows 10 inbox one is only recorded:
        // it drops Thai vowels and tone marks in Windows PowerShell 5.1 (see ADR-003).
        if (dll) expect(results.filter((r) => !r.endsWith('width-ok text-ok'))).toEqual([]);
      }, 120000);
    });
  }
}
