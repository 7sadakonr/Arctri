import { homedir, userInfo } from 'node:os';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Secrets that show up in log lines and error messages. The list is deliberately about shapes, not about names of variables. */
const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[token]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[key]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [token]'],
  [/\b(authorization|x-api-key|api[_-]?key|token|secret|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, '$1$2[redacted]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@']
];

/** A function that hides who the user is: the home folder becomes `~`, the account name `<user>`. Applies on any platform's path spelling. */
export function makeRedactor(home = homedir(), user = safeUser()): (text: string) => string {
  const homes = [...new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\'), home.replace(/\//g, '\\').replace(/\\/g, '\\\\')])].filter((h) => h.length > 3);
  const homeRe = homes.length ? new RegExp(homes.map(escape).join('|'), 'gi') : undefined;
  const userRe = user && user.length > 2 ? new RegExp(`(?<=[\\\\/])${escape(user)}(?=[\\\\/]|\\b)`, 'gi') : undefined;
  return (text) => {
    let out = text;
    for (const [re, to] of SECRET_SHAPES) out = out.replace(re, to);
    if (homeRe) out = out.replace(homeRe, '~');
    if (userRe) out = out.replace(userRe, '<user>');
    return out;
  };
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

export const redact = makeRedactor();
