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
import { killRecorded, killTree, snapshotTrees, type ProcRef } from './process-cleanup';
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
}

export class SessionManager {
  private sessions = new Map<SessionId, Session>();
  constructor(private readonly deps: SessionManagerDeps) {}

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  /** Reads the branch of the tab's folder again (after a commit or a branch switch made outside the shell). */
  refreshBranch(id: SessionId): void {
    const s = this.sessions.get(id);
    if (s?.info.cwd) void this.resolveBranch(s, s.info.cwd);
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

    let pty: PtyProcess;
    try {
      pty = this.deps.backend.spawn({
        file: plan.file, args: plan.args, cwd: plan.cwd, env: plan.env, cols: spec.cols, rows: spec.rows
      });
    } catch (e) {
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
    pty.onError((message) => {
      info.state = 'failed';
      info.exit = { code: null, reason: message };
      s.exitedFlag = true;
      s.pump?.dispose();
      this.emit(s);
      s.markExited();
    });
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

  private handleExit(s: Session, code: number): void {
    if (s.exitedFlag) return;
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
    if (s.info.kind === 'shell') delete s.info.agentTopic; // an agent tab keeps the subject of its last work
    s.info.state = 'exited';
    s.info.phase = 'unknown';
    s.info.exit = { code };
    // A tab the user is closing is already gone from the window; telling it about the exit would bring it back for a moment.
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
        await killTree(pid);
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
  }
}

