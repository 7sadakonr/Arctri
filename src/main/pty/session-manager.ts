import { randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { parseOsc } from '@shared/osc/protocol';
import { OscTokenizer } from '@shared/osc/tokenizer';
import { ShellStateMachine, type Transition } from '@shared/shell/state-machine';
import type { EnvPath, ShellProfile } from '@shared/types/env';
import type { SessionId, SessionInfo, SessionSpec } from '@shared/types/session';
import { detectAgentCommand } from '@shared/agents/detect-command';
import { cleanAgentTopic } from '@shared/agents/topic';
import { buildShellLaunch, type LaunchPlan } from '../shell/launch';
import { submitSteps } from '../shell/submit';
import { gitBranchOf } from '../shell/git';
import { mark } from '../timing';
import { DataPump } from './data-pump';
import { killRecorded, killTree, killTreeSync, snapshotTrees, type ProcRef } from './process-cleanup';
import type { PtyBackend, PtyProcess } from './pty-backend';

export interface FinishedCommand {
  sessionId: SessionId;
  profileId: string;
  command: string;
  cwd?: EnvPath;
  exitCode?: number;
  startedAt: number;
  endedAt: number;
}

export interface AgentLaunch {
  plan: LaunchPlan;
  agentId: NonNullable<SessionInfo['agentId']>;
  title: string;
  env: SessionInfo['env'];
  summary?: string;
  unsafe?: boolean;
  capabilities?: SessionInfo['agentCaps'];
  /** Hooks / notify were added to the command line, so the agent will report its status. */
  statusHooks?: boolean;
  /** Why no hooks were added (only when `statusHooks` is false). */
  noHooksReason?: 'no-hooks-windows' | 'no-hooks-cli' | 'no-hooks-shell';
}

export interface SessionManagerDeps {
  backend: PtyBackend;
  getProfile: (id: string) => ShellProfile | undefined;
  toPosix: (distro: string, winPath: string) => Promise<string | null>;
  /** Builds the launch for agent sessions (Phase 4). */
  agentLaunch?: (spec: SessionSpec, ctx: { id: string; nonce: string }) => Promise<AgentLaunch>;
  /** Extra environment for a shell tab so agents typed into it can report their status (bash and zsh). */
  shellStatusEnv?: (c: { id: string; nonce: string; env: SessionInfo['env']; shell: string }) => Promise<Record<string, string> | null>;
  wslBranch?: (cwd: Extract<EnvPath, { env: 'wsl' }>) => Promise<string | undefined>;
  onData: (id: SessionId, chunk: string) => void;
  onInfo: (info: SessionInfo) => void;
  onClosed?: (id: SessionId) => void;
  onCommand?: (c: FinishedCommand) => void;
  helloTimeoutMs?: number;
  /** Lifecycle and failures only; terminal data is never passed here. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, detail?: Record<string, unknown>) => void;
  /** Ends a process tree; replaceable so tests never signal a real pid. */
  killTree?: (pid: number) => Promise<void>;
  /** The last resort when closing everything ran out of time. */
  killTreeSync?: (pid: number) => void;
  /** How often tabs without shell integration are looked at for running child programs (ms); 0 turns it off. */
  busyPollMs?: number;
  snapshotTrees?: (roots: number[]) => Promise<Map<number, ProcRef[]>>;
}

interface Session {
  info: SessionInfo;
  pty?: PtyProcess;
  tokenizer: OscTokenizer;
  sm: ShellStateMachine;
  pump?: DataPump;
  helloTimer?: ReturnType<typeof setTimeout>;
  anomalies: number;
  /** The profile has shell integration, so a late `hello` is still welcome. */
  expectsHello: boolean;
  exited: Promise<void>;
  markExited: () => void;
  exitedFlag: boolean;
  closing: boolean;
  /** A tab without block integration cannot say when a command runs; a program running below its shell is the sign. */
  hasChildren?: boolean;
  /** A pending return to the session's name once a tool call is over (see `setActivity`). */
  activityTimer?: ReturnType<typeof setTimeout>;
}

/** How long the tab keeps a tool's label after the tool call ends. */
const ACTIVITY_HOLD_MS = 1200;

export class SessionManager {
  private sessions = new Map<SessionId, Session>();
  constructor(private readonly deps: SessionManagerDeps) {}

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  /** Work is running in the tab: an agent, a command in a tab with blocks, or a program below the shell of a tab without them. */
  isBusy(id: SessionId): boolean {
    const s = this.sessions.get(id);
    if (!s || s.info.state !== 'running') return false;
    if (s.info.kind === 'agent') return true;
    return s.info.integration === 'active' ? s.info.phase === 'executing' : !!s.hasChildren;
  }

  busyCount(): number {
    return [...this.sessions.keys()].filter((id) => this.isBusy(id)).length;
  }

  private busyTimer: ReturnType<typeof setInterval> | undefined;
  private watchBusy(): void {
    const every = this.deps.busyPollMs ?? 10_000;
    if (this.busyTimer || every <= 0) return;
    this.busyTimer = setInterval(() => void this.pollChildren(), every);
    this.busyTimer.unref?.();
  }

  private async pollChildren(): Promise<void> {
    const watched = [...this.sessions.values()].filter(
      (s) => s.info.kind === 'shell' && s.info.state === 'running' && s.info.integration !== 'active' && s.pty?.pid && !s.exitedFlag
    );
    if (watched.length === 0) return;
    const roots = watched.map((s) => s.pty!.pid);
    const trees = await (this.deps.snapshotTrees ?? snapshotTrees)(roots).catch(() => new Map<number, ProcRef[]>());
    for (const s of watched) s.hasChildren = (trees.get(s.pty!.pid)?.length ?? 0) > 1;
  }

  /** Reads the branch of the tab's folder again (after a commit or a branch switch made outside the shell). */
  refreshBranch(id: SessionId): void {
    const s = this.sessions.get(id);
    if (s?.info.cwd) void this.resolveBranch(s, s.info.cwd);
  }

  /**
   * What the agent is doing now, shown as the name of its tab; null when the tool call is over. Back to the session's name
   * is held for a moment, so the tab does not flicker between two tool calls that follow each other.
   */
  setActivity(id: SessionId, activity: string | null): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (activity === null) {
      if (s.info.agentActivity === undefined || s.activityTimer) return;
      s.activityTimer = setTimeout(() => this.dropActivity(s), ACTIVITY_HOLD_MS);
      s.activityTimer.unref?.();
      return;
    }
    if (s.activityTimer) clearTimeout(s.activityTimer);
    delete s.activityTimer;
    if (s.info.agentActivity === activity || (s.info.kind !== 'agent' && !s.info.runningAgent)) return;
    s.info.agentActivity = activity;
    this.emit(s);
  }

  private dropActivity(s: Session): void {
    if (s.activityTimer) clearTimeout(s.activityTimer);
    delete s.activityTimer;
    if (s.info.agentActivity === undefined) return;
    delete s.info.agentActivity;
    this.emit(s);
  }

  get(id: SessionId): SessionInfo | undefined {
    const s = this.sessions.get(id);
    return s ? { ...s.info } : undefined;
  }

  async create(spec: SessionSpec): Promise<SessionInfo> {
    mark('createStart');
    const id = randomUUID();
    const nonce = randomBytes(12).toString('hex');
    let plan: LaunchPlan;
    let info: SessionInfo;
    let integrationWanted = false;

    if (spec.kind === 'agent') {
      if (!this.deps.agentLaunch) throw new Error('Agents are not available');
      const a = await this.deps.agentLaunch(spec, { id, nonce });
      plan = a.plan;
      info = this.baseInfo(id, nonce, spec, a.env, 'other', a.title);
      info.agentId = a.agentId;
      info.kind = 'agent';
      info.presentation = 'classic';
      if (a.summary) info.launchSummary = a.summary;
      if (a.unsafe) info.unsafeLaunch = true;
      if (a.capabilities) info.agentCaps = a.capabilities;
      if (a.plan.note) info.launchNote = a.plan.note;
    } else {
      const profile = this.deps.getProfile(spec.profileId);
      if (!profile) throw new Error(`Unknown profile: ${spec.profileId}`);
      const blocks = profile.integration === 'blocks' && (spec.presentation ?? 'blocks') === 'blocks';
      plan = await buildShellLaunch(profile, {
        sessionId: id,
        nonce,
        blocks,
        toPosix: this.deps.toPosix,
        ...(spec.cwd ? { cwd: spec.cwd } : {})
      });
      if (profile.integration === 'blocks') {
        const extra = await this.deps.shellStatusEnv?.({ id, nonce, env: profile.env, shell: profile.shell }).catch(() => null);
        if (extra) {
          Object.assign(plan.env, extra);
          if (profile.env.kind === 'wsl') plan.env['WSLENV'] = [plan.env['WSLENV'], ...Object.keys(extra)].filter(Boolean).join(':');
        }
      }
      info = this.baseInfo(id, nonce, spec, profile.env, profile.shell, spec.title ?? profile.label);
      info.profileId = profile.id;
      info.presentation = blocks ? 'blocks' : 'classic';
      integrationWanted = profile.integration === 'blocks';
      info.integration = integrationWanted ? 'pending' : 'unavailable';
      if (plan.note) info.launchNote = plan.note;
    }

    mark('launchBuilt');
    let markExited!: () => void;
    const exited = new Promise<void>((r) => (markExited = r));
    const s: Session = {
      info, tokenizer: new OscTokenizer(), sm: new ShellStateMachine(), anomalies: 0, expectsHello: integrationWanted,
      exited, markExited, exitedFlag: false, closing: false
    };
    this.sessions.set(id, s);
    this.watchBusy();

    let pty: PtyProcess;
    try {
      pty = this.deps.backend.spawn({
        file: plan.file, args: plan.args, cwd: plan.cwd, env: plan.env, cols: spec.cols, rows: spec.rows
      });
    } catch (e) {
      this.deps.log?.('error', 'pty spawn failed', { session: id, shell: info.shell, message: e instanceof Error ? e.message : String(e) });
      info.state = 'failed';
      info.exit = { code: null, reason: e instanceof Error ? e.message : String(e) };
      s.exitedFlag = true;
      s.markExited();
      this.emit(s);
      return { ...info };
    }
    s.pty = pty;
    s.pump = new DataPump((chunk) => this.deps.onData(id, chunk), () => pty.pause(), () => pty.resume());
    // The process may take seconds to appear (and spawning never blocks the main process), so the
    // session starts out as 'starting' and becomes 'running' when the PTY reports its pid.
    pty.onSpawn((pid) => {
      mark('ptySpawned');
      info.pid = pid;
      info.state = 'running';
      this.emit(s);
      if (integrationWanted) {
        s.helloTimer = setTimeout(() => {
          if (!s.sm.helloSeen && info.integration === 'pending') {
            info.integration = 'unavailable';
            this.emit(s);
          }
        // PowerShell 7 can need 5+ seconds just to start here, and a distribution that was stopped boots first.
        }, this.deps.helloTimeoutMs ?? 30000);
      }
    });
    pty.onError((message) => this.handleFailure(s, message));
    pty.onData((d) => this.handleData(s, d));
    pty.onExit((e) => this.handleExit(s, e.exitCode));

    this.emit(s);
    return { ...info };
  }

  private baseInfo(
    id: string, nonce: string, spec: SessionSpec, env: SessionInfo['env'],
    shell: SessionInfo['shell'], title: string
  ): SessionInfo {
    return {
      id, title, titleSource: spec.title ? 'user' : 'auto', profileId: spec.profileId, env, shell,
      kind: 'shell', presentation: 'classic', integration: 'unavailable', phase: 'unknown',
      pid: 0, state: 'starting', nonce, createdAt: Date.now()
    };
  }

  private emit(s: Session): void {
    this.deps.onInfo({ ...s.info });
  }

  private handleData(s: Session, data: string): void {
    s.pump?.push(data);
    let changed = false;
    for (const tok of s.tokenizer.push(data)) {
      // OSC 0 / 2 is the window title: from an agent it names the subject of the session (a label only)
      if ((tok.id === 0 || tok.id === 2) && (s.info.kind === 'agent' || s.info.runningAgent)) {
        // the title follows the conversation: a new subject replaces the old one, and the generic name (what Claude Code
        // sets after /clear or before the first prompt) means "no subject" and brings the tab's own name back
        const topic = cleanAgentTopic(tok.payload);
        if (topic !== s.info.agentTopic) {
          if (topic) s.info.agentTopic = topic;
          else delete s.info.agentTopic;
          changed = true;
        }
        continue;
      }
      const ev = parseOsc(tok.id, tok.payload, s.info.nonce);
      if (!ev) continue;
      const tr = s.sm.apply(ev, Date.now());
      changed = this.applyTransition(s, tr, ev.t) || changed;
    }
    if (s.sm.phase !== s.info.phase) {
      s.info.phase = s.sm.phase;
      changed = true;
    }
    if (changed) this.emit(s);
  }

  private applyTransition(s: Session, tr: Transition, evType: string): boolean {
    let changed = false;
    // A hello that arrives after the timeout is accepted too: the shell is running our script, so the tab recovers by itself.
    if (evType === 'hello' && (s.info.integration === 'pending' || (s.info.integration === 'unavailable' && s.expectsHello))) {
      s.info.integration = s.sm.blocksCapable ? 'active' : 'unavailable';
      if (s.helloTimer) clearTimeout(s.helloTimer);
      changed = true;
    }
    // A WSL tab chooses between zsh and bash when it starts: show (and complete for) the one that is running.
    if (evType === 'hello' && s.info.kind === 'shell' && s.info.env.kind === 'wsl') {
      const real = s.sm.helloShell;
      if ((real === 'zsh' || real === 'bash') && real !== s.info.shell) {
        s.info.shell = real;
        changed = true;
      }
    }
    if (evType === 'cwd' && s.sm.cwd) changed = this.setCwd(s, s.sm.cwd) || changed;
    if (tr.kind === 'blockStarted' && s.info.kind === 'shell') {
      const agentId = detectAgentCommand(tr.command.text, s.info.shell);
      if (agentId) {
        s.info.runningAgent = { agentId, startedAt: tr.command.startedAt, command: tr.command.text };
        changed = true;
      }
    }
    if (tr.kind === 'blockFinished' && s.info.runningAgent) {
      delete s.info.runningAgent;
      delete s.info.agentTopic;
      if (s.activityTimer) clearTimeout(s.activityTimer);
      delete s.activityTimer;
      delete s.info.agentActivity;
      changed = true;
    }
    if (tr.kind === 'anomaly') {
      s.anomalies++;
      if (s.anomalies >= 3 && s.info.integration === 'active') {
        s.info.integration = 'degraded';
        changed = true;
      }
    } else if (tr.kind === 'blockFinished' && tr.command.text) {
      this.deps.onCommand?.({
        sessionId: s.info.id, profileId: s.info.profileId, command: tr.command.text,
        ...(s.info.cwd ? { cwd: s.info.cwd } : {}),
        ...(tr.exitCode !== undefined ? { exitCode: tr.exitCode } : {}),
        startedAt: tr.command.startedAt, endedAt: tr.endedAt
      });
    }
    return changed;
  }

  private setCwd(s: Session, raw: string): boolean {
    const env = s.info.env;
    const cwd: EnvPath =
      env.kind === 'windows'
        ? { env: 'windows', path: raw as never }
        : env.kind === 'local'
          ? { env: 'local', path: raw as never }
          : { env: 'wsl', distro: env.distro, path: raw as never };
    if (s.info.cwd && s.info.cwd.path === cwd.path) return false;
    s.info.cwd = cwd;
    if (s.info.titleSource === 'auto' && s.info.kind === 'shell') {
      const leaf = basename(raw.replace(/[\\/]+$/, '')) || raw;
      s.info.title = `${this.titleBase(s)} · ${leaf}`;
    }
    void this.resolveBranch(s, cwd);
    return true;
  }

  private titleBase(s: Session): string {
    return this.deps.getProfile(s.info.profileId)?.label ?? s.info.title.split(' · ')[0] ?? s.info.title;
  }

  private async resolveBranch(s: Session, cwd: EnvPath): Promise<void> {
    let branch: string | undefined;
    try {
      branch = cwd.env !== 'wsl' ? gitBranchOf(cwd.path) : await this.deps.wslBranch?.(cwd);
    } catch {
      branch = undefined;
    }
    if (s.info.cwd?.path !== cwd.path || s.info.gitBranch === branch) return;
    if (branch) s.info.gitBranch = branch;
    else delete s.info.gitBranch;
    this.emit(s);
  }

  /** The end of a session, however it came about: output already received is delivered, timers stop, a running block is finished. */
  private finish(s: Session): void {
    s.exitedFlag = true;
    s.pump?.flush();
    s.pump?.dispose();
    if (s.helloTimer) clearTimeout(s.helloTimer);
    const tr = s.sm.closed(Date.now());
    if (tr.kind === 'blockFinished' && tr.command.text) {
      this.deps.onCommand?.({
        sessionId: s.info.id, profileId: s.info.profileId, command: tr.command.text,
        startedAt: tr.command.startedAt, endedAt: tr.endedAt
      });
    }
    delete s.info.runningAgent;
    if (s.activityTimer) clearTimeout(s.activityTimer);
    delete s.activityTimer;
    delete s.info.agentActivity;
    if (s.info.kind === 'shell') delete s.info.agentTopic; // an agent tab keeps the subject of its last work
    s.info.phase = 'unknown';
  }

  private handleExit(s: Session, code: number): void {
    if (s.exitedFlag) return;
    this.finish(s);
    s.info.state = 'exited';
    s.info.exit = { code };
    this.deps.log?.('info', 'pty exited', { session: s.info.id, shell: s.info.shell, code });
    // A tab the user is closing is already gone from the window; telling it about the exit would bring it back for a moment.
    if (!s.closing) this.emit(s);
    s.markExited();
  }

  /**
   * The PTY machinery failed (the worker crashed, ConPTY broke). The tab shows why, and the shell it started is not left
   * running unseen: its process tree is ended, because nothing can talk to it any more.
   */
  private handleFailure(s: Session, message: string): void {
    if (s.exitedFlag) return;
    const pid = s.info.pid;
    this.finish(s);
    s.info.state = 'failed';
    s.info.exit = { code: null, reason: message };
    this.deps.log?.('error', 'pty failed', { session: s.info.id, shell: s.info.shell, pid, message });
    if (pid) void (this.deps.killTree ?? killTree)(pid).catch(() => undefined);
    if (!s.closing) this.emit(s);
    s.markExited();
  }

  write(id: SessionId, data: string): void {
    const s = this.sessions.get(id);
    if (!s?.pty || s.exitedFlag) return;
    s.pty.write(data.length > 1_000_000 ? data.slice(0, 1_000_000) : data);
  }

  submitCommand(id: SessionId, command: string): { ok: true } | { ok: false; reason: 'not-at-prompt' | 'no-integration' } {
    const s = this.sessions.get(id);
    if (!s?.pty || s.exitedFlag) return { ok: false, reason: 'no-integration' };
    if (s.info.integration !== 'active') return { ok: false, reason: 'no-integration' };
    if (s.info.phase !== 'prompt' && s.info.phase !== 'editing') return { ok: false, reason: 'not-at-prompt' };
    const pty = s.pty;
    let delay = 0;
    for (const step of submitSteps(s.info.shell, command)) {
      delay += step.delayMs;
      if (delay === 0) pty.write(step.data);
      else setTimeout(() => !s.exitedFlag && pty.write(step.data), delay);
    }
    return { ok: true };
  }

  ack(id: SessionId, length: number): void {
    this.sessions.get(id)?.pump?.ack(length);
  }

  resize(id: SessionId, cols: number, rows: number): void {
    this.sessions.get(id)?.pty?.resize(cols, rows);
  }

  rename(id: SessionId, title: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const t = title.trim().slice(0, 80);
    if (t) {
      s.info.title = t;
      s.info.titleSource = 'user';
    } else {
      s.info.titleSource = 'auto';
    }
    this.emit(s);
  }

  async close(id: SessionId, recorded?: ProcRef[]): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.closing = true;
    if (!s.exitedFlag && s.pty) {
      const pid = s.pty.pid;
      // Children can only be found while the root is alive, so record them first.
      const tree = recorded ?? (pid ? ((await snapshotTrees([pid])).get(pid) ?? []) : []);
      try {
        s.pty.kill();
      } catch {
        /* already gone */
      }
      const done = await Promise.race([s.exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
      if (!done) {
        this.deps.log?.('warn', 'pty did not exit after kill; ending its process tree', { session: id, pid });
        await (this.deps.killTree ?? killTree)(pid);
        await Promise.race([s.exited, new Promise((r) => setTimeout(r, 1000))]);
      }
      // Whatever survived the console closing (a shell that ignores the hang-up) is ended explicitly.
      await killRecorded(tree);
    }
    if (s.helloTimer) clearTimeout(s.helloTimer);
    s.pump?.dispose();
    this.sessions.delete(id);
    this.deps.onClosed?.(id);
  }

  async closeAll(maxMs = 5000): Promise<void> {
    if (this.busyTimer) clearInterval(this.busyTimer);
    this.busyTimer = undefined;
    const ids = [...this.sessions.keys()];
    await Promise.race([
      (async () => {
        const roots = ids.flatMap((id) => {
          const pty = this.sessions.get(id)?.pty;
          return pty && pty.pid && !this.sessions.get(id)!.exitedFlag ? [pty.pid] : [];
        });
        const trees = await snapshotTrees(roots); // one look at the process table for all sessions
        await Promise.all(
          ids.map((id) => {
            const pid = this.sessions.get(id)?.pty?.pid;
            return this.close(id, pid !== undefined ? (trees.get(pid) ?? []) : []);
          })
        );
      })(),
      new Promise((r) => setTimeout(r, maxMs))
    ]);
    // Closing everything took longer than the app can wait. Whatever is still alive is ended now, in one go, rather than
    // being left behind when the process exits.
    for (const [id, s] of this.sessions) {
      if (s.exitedFlag || !s.pty?.pid) continue;
      this.deps.log?.('warn', 'closing did not finish in time; ending the process tree', { session: id, pid: s.pty.pid });
      (this.deps.killTreeSync ?? killTreeSync)(s.pty.pid);
    }
  }
}

