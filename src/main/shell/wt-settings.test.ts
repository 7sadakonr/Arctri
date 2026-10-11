import { describe, expect, it } from 'vitest';
import type { ShellProfile } from '@shared/types/env';
import { mapWtProfiles, parseWtSettings, splitCommandline, stripJsonc } from './wt-settings';

const mk = (id: string, shell: ShellProfile['shell']): ShellProfile => ({
  id, label: id, env: { kind: 'windows' }, shell, executable: `C:\\${id}.exe`, integration: 'blocks'
});
const known = new Map([['pwsh', mk('pwsh', 'pwsh')], ['powershell', mk('powershell', 'powershell')], ['cmd', mk('cmd', 'cmd')]]);

const SETTINGS = `{
  // comment with "quotes"
  "defaultProfile": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}",
  "profiles": {
    "list": [
      { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell", "commandline": "%SystemRoot%\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" },
      { "guid": "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}", "name": "Command Prompt", "hidden": true },
      { "guid": "{a}", "name": "Ubuntu", "source": "Windows.Terminal.Wsl" },
      { "guid": "{b}", "name": "Git Bash", "source": "Git" },
      { "guid": "{c}", "name": "My bash", "commandline": "\\"C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe\\" --login -i", },
      { "guid": "{d}", "name": "Azure", "source": "Windows.Terminal.Azure" },
    ]
  }
}`;

describe('Windows Terminal settings', () => {
  it('strips comments and trailing commas but not text inside strings', () => {
    expect(JSON.parse(stripJsonc('{"a": "x // y", /* c */ "b": [1,],}'))).toEqual({ a: 'x // y', b: [1] });
  });

  it('splits a command line with quotes', () => {
    expect(splitCommandline('"C:\\Program Files\\x.exe" --a b')).toEqual(['C:\\Program Files\\x.exe', '--a', 'b']);
  });

  it('maps profiles in order, skips hidden and unknown ones, and finds the default', () => {
    const wt = parseWtSettings(SETTINGS)!;
    const r = mapWtProfiles(wt, { known, gitBash: () => 'C:\\Git\\bin\\bash.exe' });
    expect(r.order).toEqual(['powershell', 'wsl:ubuntu', 'gitbash', 'wt:{c}']);
    expect(r.defaultId).toBe('powershell');
    expect(r.windows.map((p) => p.id)).toEqual(['powershell', 'gitbash', 'wt:{c}']);
    const custom = r.windows.find((p) => p.id === 'wt:{c}')!;
    expect(custom.executable).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(custom.args).toEqual(['--login', '-i']);
    expect(custom.integration).toBe('none');
  });

  it('returns undefined for broken settings', () => {
    expect(parseWtSettings('not json')).toBeUndefined();
  });

  it('maps a Store distribution (the real default of the author) to a wslapp entry and makes it the default', () => {
    const wt = parseWtSettings(`{
      "defaultProfile": "{51855cb2-8cce-5362-8f54-464b92b32386}",
      "profiles": { "list": [
        { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell" },
        { "guid": "{51855cb2-8cce-5362-8f54-464b92b32386}", "name": "me/ubuntu", "source": "CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc" },
        { "guid": "{2c4de342-38b7-51cf-b940-2309a097f518}", "hidden": true, "name": "Ubuntu", "source": "Windows.Terminal.Wsl" }
      ] }
    }`)!;
    const r = mapWtProfiles(wt, { known, gitBash: () => undefined });
    expect(r.order).toEqual(['powershell', 'wslapp:ubuntu']);
    expect(r.defaultId).toBe('wslapp:ubuntu');
  });
});
