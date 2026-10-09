import { parse } from 'smol-toml';

type Toml = { tui?: { notifications?: unknown; notification_method?: unknown } };

/** True when Codex is already set to show notifications (`tui.notifications` is true or a non-empty list). */
export function tuiNotificationsEnabled(toml: string): boolean {
  try {
    const n = (parse(toml) as Toml).tui?.notifications;
    return n === true || (Array.isArray(n) && n.length > 0);
  } catch {
    return false;
  }
}

/**
 * Turns on `tui.notifications` (and sends them as OSC 9, which AgentDock listens for) with the smallest possible edit:
 * comments, ordering and every other setting stay exactly as they are. Throws if the result would not be valid TOML.
 */
export function enableTuiNotifications(toml: string): string {
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const lines = toml.length ? toml.split(/\r?\n/) : [];
  const header = lines.findIndex((l) => /^\s*\[tui\]\s*(#.*)?$/.test(l));
  const setLine = (key: string, value: string) => `${key} = ${value}`;
  let out: string[];

  if (header === -1) {
    const tail = lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    out = [...tail, ...(tail.length ? [''] : []), '[tui]', setLine('notifications', 'true'), setLine('notification_method', '"osc9"'), ''];
  } else {
    let end = lines.length;
    for (let i = header + 1; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    out = [...lines];
    const find = (key: string) => {
      for (let i = header + 1; i < end; i++) if (new RegExp(`^\\s*${key}\\s*=`).test(out[i]!)) return i;
      return -1;
    };
    const upsert = (key: string, value: string, onlyIfMissing: boolean) => {
      const at = find(key);
      if (at >= 0) {
        if (!onlyIfMissing) out[at] = setLine(key, value);
      } else {
        out.splice(header + 1, 0, setLine(key, value));
        end++;
      }
    };
    upsert('notification_method', '"osc9"', true); // an explicit choice of the user (e.g. "bel") is kept
    upsert('notifications', 'true', false);
  }
  const result = out.join(eol);
  parse(result); // never write a file that does not parse
  if (!tuiNotificationsEnabled(result)) throw new Error('notifications were not enabled by the edit');
  return result;
}

export const codexConfigBackupName = (now = new Date()): string =>
  `config.toml.agentdock-backup-${now.toISOString().replace(/[:.]/g, '-')}`;
