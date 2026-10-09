import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

type Tui = { tui: { notification_method?: string; notifications?: boolean; theme?: string; model_availability_nux: Record<string, number> } };
import { codexConfigBackupName, enableTuiNotifications, tuiNotificationsEnabled } from './codex-config';

const real = `model = "gpt-5.6-terra"
# my comment
[tui]
screen_reader_detection_done = true
theme = "one-half-dark"

[tui.model_availability_nux]
gpt-6-astra = 4

[projects."/home/me"]
`;

describe('codex config', () => {
  it('adds the keys to an existing [tui] table and leaves everything else untouched', () => {
    const out = enableTuiNotifications(real);
    expect(tuiNotificationsEnabled(out)).toBe(true);
    const t = parse(out) as unknown as Tui;
    expect(t.tui.notification_method).toBe('osc9');
    expect(t.tui.theme).toBe('one-half-dark');
    expect(t.tui.model_availability_nux['gpt-6-astra']).toBe(4);
    expect(out).toContain('# my comment');
    expect(out.split('\n').filter((l) => l.includes('theme')).length).toBe(1);
  });

  it('flips a disabled setting and keeps a method the user chose', () => {
    const out = enableTuiNotifications('[tui]\nnotifications = false\nnotification_method = "bel"\n');
    const t = parse(out) as unknown as Tui;
    expect(t.tui.notifications).toBe(true);
    expect(t.tui.notification_method).toBe('bel');
  });

  it('creates [tui] when it is missing, also in an empty file, and keeps CRLF files CRLF', () => {
    expect(tuiNotificationsEnabled(enableTuiNotifications(''))).toBe(true);
    expect(tuiNotificationsEnabled(enableTuiNotifications('model = "x"\n'))).toBe(true);
    expect(enableTuiNotifications('model = "x"\r\n')).toContain('\r\n[tui]\r\n');
  });

  it('recognises an enabled list form and refuses to write invalid TOML', () => {
    expect(tuiNotificationsEnabled('[tui]\nnotifications = ["agent-turn-complete"]\n')).toBe(true);
    expect(tuiNotificationsEnabled('[tui]\nnotifications = []\n')).toBe(false);
    expect(tuiNotificationsEnabled('not = [valid')).toBe(false);
    expect(() => enableTuiNotifications('this is = = broken')).toThrow();
  });

  it('names backups with a sortable timestamp', () => {
    expect(codexConfigBackupName(new Date('2026-10-09T15:04:05.123Z'))).toBe('config.toml.agentdock-backup-2026-10-09T15-04-05-123Z');
  });
});
