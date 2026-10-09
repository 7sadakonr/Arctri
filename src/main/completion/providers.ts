import { posix, win32 } from 'node:path';
import { matchScore, SOURCE_WEIGHT } from '@shared/completion/rank';
import {
  BASH_BUILTINS, CMD_BUILTINS, GIT_BRANCH_COMMANDS, GIT_SUBCOMMANDS, NPM_SUBCOMMANDS, PNPM_SUBCOMMANDS,
  POWERSHELL_COMMANDS, SCRIPT_RUNNERS
} from '@shared/completion/static-data';
import { quoteForShell, type TokenizedLine } from '@shared/completion/tokenize';
import type { CompletionContext, CompletionItem } from '@shared/types/completion';
import { envKeyOf } from '@shared/types/env';
import type { HistoryRepo } from '../persistence/history-repo';
import type { EnvironmentQuery } from '../env-query/service';

export interface ProviderDeps {
  history: HistoryRepo;
  env: EnvironmentQuery;
}

export interface Provider {
  id: string;
  provide(ctx: CompletionContext, tok: TokenizedLine, signal: AbortSignal): Promise<CompletionItem[]>;
}

const isPs = (c: CompletionContext) => c.shell === 'pwsh' || c.shell === 'powershell';
const isWindows = (c: CompletionContext) => c.env.kind === 'windows';
const ci = (c: CompletionContext) => isWindows(c);
const pathLib = (c: CompletionContext) => (isWindows(c) ? win32 : posix);

const looksLikePath = (v: string) => /[\\/]/.test(v) || /^[.~]/.test(v) || /^[A-Za-z]:/.test(v);

function item(
  tok: TokenizedLine, kind: CompletionItem['kind'], source: string, label: string, insert: string, score: number, detail?: string
): CompletionItem {
  return {
    label, insertText: insert, replace: [tok.current.start, tok.current.end], kind, source,
    score: score * SOURCE_WEIGHT[kind], ...(detail ? { detail } : {})
  };
}

export const historyProvider = (d: ProviderDeps): Provider => ({
  id: 'history',
  async provide(ctx) {
    if (ctx.cursor !== ctx.line.length || !ctx.line.trim()) return [];
    const rows = d.history.search(envKeyOf(ctx.env, ctx.shell), ctx.line, 8, ctx.cwd.path);
    const now = Date.now();
    return rows
      .filter((r) => r.command !== ctx.line)
      .map((r): CompletionItem => {
        const score =
          (70 + Math.min(r.count, 10) * 1.5 + (r.inCwd ? 8 : 0) + (now - r.lastAt < 86_400_000 ? 5 : 0)) * SOURCE_WEIGHT.history;
        return {
          label: r.command.split('\n')[0]! + (r.command.includes('\n') ? ' …' : ''),
          insertText: r.command,
          replace: [0, ctx.line.length],
          kind: 'history',
          source: 'history',
          score,
          ...(r.count > 1 ? { detail: `×${r.count}` } : {})
        };
      });
  }
});

export const commandProvider = (d: ProviderDeps): Provider => ({
  id: 'commands',
  async provide(ctx, tok, signal) {
    const v = tok.current.value;
    if (!tok.isCommandPosition || !v || looksLikePath(v) || tok.current.quote) return [];
    const builtins =
      ctx.shell === 'cmd' ? CMD_BUILTINS : isPs(ctx) ? POWERSHELL_COMMANDS : BASH_BUILTINS;
    const exes = await d.env.listExecutables(ctx.env);
    if (signal.aborted) return [];
    const out: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const name of [...builtins, ...exes]) {
      const key = ci(ctx) ? name.toLowerCase() : name;
      if (seen.has(key)) continue;
      const s = matchScore(name, v, ci(ctx));
      if (s < 25) continue;
      seen.add(key);
      out.push(item(tok, 'command', 'commands', name, name + ' ', s));
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 30);
  }
});

export const pathProvider = (d: ProviderDeps): Provider => ({
  id: 'paths',
  async provide(ctx, tok, signal) {
    const cur = tok.current;
    const v = cur.value;
    if (tok.isCommandPosition && !looksLikePath(v)) return [];
    const lib = pathLib(ctx);
    const sepChars = isWindows(ctx) ? ['\\', '/'] : ['/'];
    const lastSep = Math.max(...sepChars.map((s) => v.lastIndexOf(s)));
    const dirPart = lastSep >= 0 ? v.slice(0, lastSep + 1) : '';
    const prefix = v.slice(lastSep + 1);
    const sep = isWindows(ctx) ? '\\' : '/';

    let base: string;
    const home = v.startsWith('~') ? await d.env.homeDir(ctx.env) : '';
    if (dirPart === '') base = ctx.cwd.path;
    else if (dirPart.startsWith('~')) base = lib.join(home, dirPart.slice(1));
    else base = lib.resolve(ctx.cwd.path, dirPart);
    if (!isWindows(ctx) && dirPart.startsWith('~')) base = posix.join(home, dirPart.slice(1));

    const entries = await d.env.listDir(ctx.env, base);
    if (signal.aborted) return [];
    const out: CompletionItem[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') && !prefix.startsWith('.')) continue;
      const s = matchScore(e.name, prefix, ci(ctx));
      if (s === 0 || (prefix && s < 50)) continue; // paths are matched by prefix or word boundary only
      const full = dirPart + e.name + (e.isDir ? sep : '');
      const quoted = quoteForShell(full, ctx.shell, cur.quote, { closeQuote: !e.isDir });
      let insert = cur.quote ? cur.quote + quoted : quoted;
      if (tok.isCommandPosition && isPs(ctx) && insert.startsWith("'")) insert = `& ${insert}`;
      out.push(item(tok, e.isDir ? 'dir' : 'path', 'paths', e.name + (e.isDir ? sep : ''), insert, s + (e.isDir ? 2 : 0)));
    }
    return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 40);
  }
});

export const gitProvider = (d: ProviderDeps): Provider => {
  const cache = new Map<string, { at: number; branches: string[] }>();
  return {
    id: 'git',
    async provide(ctx, tok, signal) {
      const [cmd, sub] = tok.words;
      if (cmd !== 'git' && cmd !== 'git.exe') return [];
      const v = tok.current.value;
      const idx = tok.index - tok.commandIndex;
      if (idx === 1) {
        if (v.startsWith('-')) return [];
        return GIT_SUBCOMMANDS.flatMap(([name, detail]) => {
          const s = matchScore(name, v, false);
          return s >= 25 ? [item(tok, 'git-subcommand', 'git', name, name + ' ', s, detail)] : [];
        });
      }
      if (idx >= 2 && sub && GIT_BRANCH_COMMANDS.has(sub) && !v.startsWith('-')) {
        const key = `${ctx.env.kind === 'wsl' ? ctx.env.distro : 'win'}:${ctx.cwd.path}`;
        let hit = cache.get(key);
        if (!hit || Date.now() - hit.at > 10_000) {
          hit = { at: Date.now(), branches: await d.env.gitBranches(ctx.env, ctx.cwd.path) };
          cache.set(key, hit);
        }
        if (signal.aborted) return [];
        return hit.branches.flatMap((b) => {
          const s = matchScore(b, v, false);
          return s >= 25 ? [item(tok, 'git-branch', 'git', b, quoteForShell(b, ctx.shell, tok.current.quote, { closeQuote: true }) + ' ', s)] : [];
        });
      }
      return [];
    }
  };
};

export const scriptProvider = (d: ProviderDeps): Provider => ({
  id: 'scripts',
  async provide(ctx, tok, signal) {
    const [runner, sub] = tok.words;
    if (!runner || !SCRIPT_RUNNERS.has(runner)) return [];
    const idx = tok.index - tok.commandIndex;
    const v = tok.current.value;
    const out: CompletionItem[] = [];
    if (idx === 1) {
      const subs = runner === 'npm' ? NPM_SUBCOMMANDS : PNPM_SUBCOMMANDS;
      for (const s of subs) {
        const m = matchScore(s, v, false);
        if (m >= 25) out.push(item(tok, 'command', 'scripts', s, s + ' ', m));
      }
    }
    const wantsScript = (idx === 2 && (sub === 'run' || sub === 'run-script')) || (idx === 1 && runner !== 'npm');
    if (wantsScript) {
      const lib = pathLib(ctx);
      let dir: string = ctx.cwd.path;
      for (let i = 0; i < 8; i++) {
        const text = await d.env.readSmallText(ctx.env, lib.join(dir, 'package.json'), 512 * 1024);
        if (signal.aborted) return [];
        if (text) {
          try {
            const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
            for (const [name, body] of Object.entries(scripts)) {
              const m = matchScore(name, v, false);
              if (m >= 25) out.push(item(tok, 'script', 'scripts', name, quoteForShell(name, ctx.shell, tok.current.quote, { closeQuote: true }) + ' ', m, body.slice(0, 80)));
            }
          } catch {
            /* invalid package.json */
          }
          break;
        }
        const parent = lib.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    return out;
  }
});
