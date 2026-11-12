import { defaultPrefs, prefsSchema, type Prefs } from '@shared/prefs';

const AGENT_FULLSCREEN = 'agent-fullscreen-default-v2';

export interface KeyValueBackend {
  get(): unknown;
  set(value: unknown): void;
}

/** Validated application preferences. Invalid stored values fall back to defaults field by field. */
export class PrefsStore {
  private value: Prefs;
  constructor(private readonly backend: KeyValueBackend) {
    this.value = this.migrate(this.load());
  }

  /**
   * Changes to stored values that a new default cannot reach. Each one runs once (its name is kept in `migrations`), so a user who
   * later chooses otherwise keeps their choice.
   */
  private migrate(value: Prefs): Prefs {
    if (value.migrations.includes(AGENT_FULLSCREEN)) return value;
    // 0.4.2 stored `true` for everyone (and a build in between set it back to `true` once more): agents on the main screen repaint from the top on resize and on long output
    const next: Prefs = { ...value, agentNormalBuffer: false, migrations: [...value.migrations, AGENT_FULLSCREEN] };
    this.backend.set(next);
    return next;
  }

  private load(): Prefs {
    const raw = this.backend.get();
    const parsed = prefsSchema.safeParse(raw ?? {});
    if (parsed.success) return parsed.data;
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
      const one = prefsSchema.safeParse({ [k]: v });
      if (one.success) merged[k] = (one.data as Record<string, unknown>)[k];
    }
    const retry = prefsSchema.safeParse(merged);
    return retry.success ? retry.data : defaultPrefs();
  }

  get(): Prefs {
    return this.value;
  }

  set(patch: Partial<Prefs>): Prefs {
    const next = prefsSchema.parse({ ...this.value, ...patch });
    this.value = next;
    this.backend.set(next);
    return next;
  }
}

export class MemoryBackend implements KeyValueBackend {
  private v: unknown;
  get() { return this.v; }
  set(value: unknown) { this.v = value; }
}
