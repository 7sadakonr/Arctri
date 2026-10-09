import type { ShellKind } from '../types/env';
import type { AgentId } from '../types/session';
import { tokenize } from '../completion/tokenize';

/** First positional words after which the CLI is not an interactive session but a one-shot command. */
const ONE_SHOT: Record<AgentId, Set<string>> = {
  'claude-code': new Set(['config', 'mcp', 'update', 'upgrade', 'doctor', 'install', 'setup-token', 'migrate-installer', 'plugin', 'plugins']),
  codex: new Set([
    'exec', 'e', 'login', 'logout', 'mcp', 'mcp-server', 'app-server', 'remote-control', 'completion', 'apply', 'a',
    'cloud', 'features', 'sandbox', 'debug', 'help', 'proto'
  ])
};
const INFO_FLAGS = new Set(['-v', '-V', '--version', '-h', '--help']);
const PACKAGES: Record<string, AgentId> = { '@anthropic-ai/claude-code': 'claude-code', '@openai/codex': 'codex' };
const PROGRAMS: Record<string, AgentId> = { claude: 'claude-code', codex: 'codex' };
const WRAPPERS = new Set(['command', 'exec', 'env', 'time', 'nohup', 'builtin']);

/** Splits a command line at unquoted `;`, `&&`, `||`, `|` and newlines. Pipes are kept so the left side can be ignored. */
function segments(text: string): Array<{ text: string; piped: boolean }> {
  const out: Array<{ text: string; piped: boolean }> = [];
  let quote = '';
  let cur = '';
  const push = (piped: boolean) => {
    if (cur.trim()) out.push({ text: cur, piped });
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = '';
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === '\n' || c === ';') push(false);
    else if (c === '&' && text[i + 1] === '&') {
      push(false);
      i++;
    } else if (c === '|' && text[i + 1] === '|') {
      push(false);
      i++;
    } else if (c === '|') push(true);
    else cur += c;
  }
  push(false);
  return out;
}

const programName = (word: string): string =>
  word.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

function detectSegment(seg: string, shell: ShellKind): AgentId | undefined {
  const words = tokenize(seg, seg.length, shell).tokens.map((t) => t.value);
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || WRAPPERS.has(programName(words[i]!)))) i++;
  const first = words[i];
  if (!first) return undefined;
  const rest = words.slice(i + 1);

  let agent: AgentId | undefined = PROGRAMS[programName(first)];
  let args = rest;
  if (!agent) {
    // package runners: npx / bunx / pnpx <pkg>, pnpm dlx <pkg>, yarn dlx <pkg>, npm exec <pkg>
    const runner = programName(first);
    let r = rest;
    if (['pnpm', 'yarn'].includes(runner) && r[0] === 'dlx') r = r.slice(1);
    else if (runner === 'npm' && r[0] === 'exec') r = r.slice(1);
    else if (!['npx', 'bunx', 'pnpx'].includes(runner)) return undefined;
    while (r[0]?.startsWith('-') && r[0] !== '--') r = r.slice(1); // -y, --yes, --package=...
    if (r[0] === '--') r = r.slice(1);
    const pkg = r[0]?.replace(/(?<=.)@[^/@]*$/, ''); // drop a trailing @version
    agent = pkg ? PACKAGES[pkg] : undefined;
    args = r.slice(1);
  }
  if (!agent) return undefined;
  if (args.some((a) => INFO_FLAGS.has(a))) return undefined;
  if (agent === 'claude-code' && args.some((a) => a === '-p' || a === '--print')) return undefined;
  const firstPositional = args.find((a) => !a.startsWith('-'));
  if (firstPositional && ONE_SHOT[agent].has(firstPositional) && args.indexOf(firstPositional) === args.findIndex((a) => !a.startsWith('-'))) {
    return undefined;
  }
  return agent;
}

/**
 * Which interactive agent CLI a typed command starts, if any. Based on the command text the shell integration
 * reports, never on what is drawn on screen. One-shot uses (`claude -p`, `codex exec`, `--version`) do not count.
 */
export function detectAgentCommand(text: string, shell: ShellKind): AgentId | undefined {
  const segs = segments(text);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i]!;
    if (seg.piped) continue; // its output is being piped away: not an interactive session
    const found = detectSegment(seg.text, shell);
    if (found) return found;
  }
  return undefined;
}
