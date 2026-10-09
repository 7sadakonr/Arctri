import { rankItems } from '@shared/completion/rank';
import { tokenize } from '@shared/completion/tokenize';
import type { CompletionContext, CompletionItem, CompletionRequest, CompletionResponse } from '@shared/types/completion';
import { envKeyOf } from '@shared/types/env';
import type { SessionInfo } from '@shared/types/session';
import type { HistoryRepo } from '../persistence/history-repo';
import type { EnvironmentQuery } from '../env-query/service';
import { commandProvider, gitProvider, historyProvider, pathProvider, scriptProvider, type Provider } from './providers';

export interface CompletionEngineDeps {
  sessions: { get(id: string): SessionInfo | undefined };
  history: HistoryRepo;
  env: EnvironmentQuery;
}

/**
 * Produces suggestions only. Nothing returned here is ever sent to a shell by the engine; the
 * renderer inserts the chosen text into the editor and the user decides whether to run it.
 */
export class CompletionEngine {
  private providers: Provider[];
  private inflight = new Map<string, AbortController>();

  constructor(
    private readonly deps: CompletionEngineDeps,
    private readonly providerTimeoutMs = 1500
  ) {
    this.providers = [
      historyProvider(deps), commandProvider(deps), pathProvider(deps), gitProvider(deps), scriptProvider(deps)
    ];
  }

  async query(req: CompletionRequest): Promise<CompletionResponse> {
    const info = this.deps.sessions.get(req.sessionId);
    const empty: CompletionResponse = { requestId: req.requestId, items: [] };
    // Completion is for the block editor of a shell prompt; never for agents or running programs.
    if (!info || info.kind !== 'shell' || !info.cwd || (info.phase !== 'prompt' && info.phase !== 'editing')) return empty;

    // A newer keystroke supersedes the previous request of this session.
    this.inflight.get(req.sessionId)?.abort();
    const ac = new AbortController();
    this.inflight.set(req.sessionId, ac);

    const ctx: CompletionContext = {
      sessionId: req.sessionId, env: info.env, shell: info.shell, cwd: info.cwd, line: req.line, cursor: req.cursor
    };
    const tok = tokenize(req.line, req.cursor, info.shell);
    try {
      // Each provider gets its own time limit: a slow one (a first scan of a huge PATH) costs only its own
      // suggestions, never those of the providers that already answered.
      const results = await Promise.all(
        this.providers.map((p) =>
          withTimeout(p.provide(ctx, tok, ac.signal).catch(() => [] as CompletionItem[]), this.providerTimeoutMs)
        )
      );
      if (ac.signal.aborted) return empty;
      const items = rankItems(results.flat(), 50);
      let ghost: string | undefined;
      if (req.cursor === req.line.length && req.line.trim()) {
        const h = this.deps.history.search(envKeyOf(info.env, info.shell), req.line, 1, info.cwd.path)[0];
        if (h && h.command.startsWith(req.line) && h.command.length > req.line.length && !h.command.includes('\n')) ghost = h.command;
      }
      return { requestId: req.requestId, items, ...(ghost ? { ghost } : {}) };
    } finally {
      if (this.inflight.get(req.sessionId) === ac) this.inflight.delete(req.sessionId);
    }
  }
}

function withTimeout<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve([]), ms);
    void p.then((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}
