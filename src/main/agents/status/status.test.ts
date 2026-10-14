import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '@shared/types/agent-status';
import { AgentStatusService } from '../status-service';
import { claudeSettings, isSafeHookPath, statusLaunch } from './launch';
import { parseCodexNotify, parseEnvelope, parseClaudeHook, sentAtMs } from './parse';
import { EventSpool } from './spool';

const b = { sessionId: 's1', now: 1000 };
const env = (agent: string, payload: unknown, nonce = 'n1') => JSON.stringify({ nonce, agent, payload });

describe('claude hook parsing', () => {
  it('maps verified events and carries only event names', () => {
    expect(parseClaudeHook({ hook_event_name: 'Stop', session_id: 'c1' }, b)).toMatchObject({ state: 'finished', confidence: 'high', agentSessionId: 'c1' });
    expect(parseClaudeHook({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, b)?.state).toBe('needs-approval');
    expect(parseClaudeHook({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, b)?.state).toBe('ready');
    expect(parseClaudeHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'secret' } }, b)).toMatchObject({ state: 'working', detail: { tool: 'Bash' } });
    expect(JSON.stringify(parseClaudeHook({ hook_event_name: 'UserPromptSubmit', prompt: 'my secret prompt' }, b))).not.toContain('secret');
  });
  it('a question to the user (AskUserQuestion) is waiting at once; a real permission request is an approval', () => {
    expect(parseClaudeHook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, b)).toMatchObject({ state: 'waiting', detail: { tool: 'AskUserQuestion' } });
    expect(parseClaudeHook({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' }, b)?.state).toBe('waiting');
    expect(parseClaudeHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, b)?.state).toBe('needs-approval');
    expect(parseClaudeHook({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' }, b)?.state).toBe('working');
    expect(parseClaudeHook({ hook_event_name: 'PostToolUseFailure', tool_name: 'AskUserQuestion' }, b)?.state).toBe('working');
    expect(parseClaudeHook({ hook_event_name: 'Elicitation' }, b)?.state).toBe('waiting');
  });
  it('SessionEnd is not a status: /clear and resume send it while the process lives on', () => {
    expect(parseClaudeHook({ hook_event_name: 'SessionEnd', reason: 'clear' }, b)).toBeNull();
    expect(parseClaudeHook({ hook_event_name: 'SessionStart', source: 'clear' }, b)?.state).toBe('ready');
    expect(parseClaudeHook({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }, b)?.state).toBe('waiting');
  });
  it('does not guess at events it does not know', () => {
    expect(parseClaudeHook({ hook_event_name: 'Notification', notification_type: 'something_new' }, b)).toBeNull();
    expect(parseClaudeHook({ hook_event_name: 'FutureEvent' }, b)).toBeNull();
    expect(parseClaudeHook('nope', b)).toBeNull();
  });
});

describe('codex notify parsing', () => {
  it('only a finished turn is reported, never an approval', () => {
    expect(parseCodexNotify({ type: 'agent-turn-complete', 'thread-id': 't1' }, b)).toMatchObject({ state: 'finished', agentSessionId: 't1', source: 'codex-notify' });
    expect(parseCodexNotify({ type: 'approval-requested' }, b)).toBeNull();
  });
});

describe('envelope', () => {
  it('rejects a wrong secret, bad JSON and oversize input', () => {
    expect(parseEnvelope(env('claude', { hook_event_name: 'Stop' }), 'n1', b)?.state).toBe('finished');
    expect(parseEnvelope(env('claude', { hook_event_name: 'Stop' }, 'other'), 'n1', b)).toBeNull();
    expect(parseEnvelope('{not json', 'n1', b)).toBeNull();
    expect(parseEnvelope(' '.repeat(70_000), 'n1', b)).toBeNull();
  });
});

describe('launch', () => {
  it('adds flags only when enabled and the paths are plain', () => {
    expect(statusLaunch('claude-code', false, '/a/hook.sh', '/a/s.json').args).toEqual([]);
    const c = statusLaunch('claude-code', true, '/a/hook.sh', '/a/s.json');
    expect(c.args).toEqual(['--settings', '/a/s.json']);
    expect(JSON.parse(c.settingsFile!.contents).hooks.Stop[0].hooks[0].command).toBe("sh '/a/hook.sh' claude");
    expect(statusLaunch('codex', true, '/a/hook.sh', '/a/s.json').args).toEqual(['-c', 'notify=["sh","/a/hook.sh","codex"]']);
    expect(statusLaunch('codex', true, "/a/';rm -rf x;'", '/a/s.json').args).toEqual([]);
    expect(isSafeHookPath('/mnt/d/Desktop/Arctri/resources')).toBe(true);
    expect(Object.keys(JSON.parse(claudeSettings('/x')).hooks)).toContain('Notification');
  });
});

describe('spool and service', () => {
  it('reads finished event files once, drops forged ones, and the service keeps unknown without signals', () => {
    const root = mkdtempSync(join(tmpdir(), 'arctri-spool-'));
    const seen: AgentStatus[] = [];
    const svc = new AgentStatusService({ root, windowFocused: () => false, onChanged: (s) => s && seen.push(s) });
    const dir = svc.watch('s1', 'n1');
    svc.begin('s1', 'claude-code');
    expect(seen.at(-1)).toMatchObject({ state: 'starting', source: 'pty' });
    writeFileSync(join(dir, '1.json.tmp'), 'half-written'); // not finished: ignored
    writeFileSync(join(dir, '2.json'), env('claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'forged'));
    writeFileSync(join(dir, '3.json'), env('claude', { hook_event_name: 'Notification', notification_type: 'permission_prompt' }));
    svc['spools'].get('s1')!.drain();
    expect(seen.at(-1)).toMatchObject({ state: 'needs-approval', unread: true });
    expect(svc.dropped()).toBe(1);
    // a genuine event that is not a status (SessionEnd) is read and removed, but is not counted as dropped
    writeFileSync(join(dir, '4.json'), env('claude', { hook_event_name: 'SessionEnd' }));
    svc['spools'].get('s1')!.drain();
    expect(svc.dropped()).toBe(1);
    expect(readdirSync(dir)).toEqual(['1.json.tmp']);
    svc.userInput('s1');
    expect(seen.at(-1)?.state).toBe('unknown');
    svc.forget('s1');
  });

  it('plain terminal output never becomes a permission request', () => {
    const root = mkdtempSync(join(tmpdir(), 'arctri-spool-'));
    const seen: AgentStatus[] = [];
    const svc = new AgentStatusService({ root, windowFocused: () => true, onChanged: (s) => s && seen.push(s) });
    svc.terminalSignal('s2', 'codex');
    expect(seen.at(-1)).toMatchObject({ state: 'unknown', confidence: 'low', source: 'terminal-signal', unread: true });
    new EventSpool(join(root, 'x'), 's2', 'n', () => undefined).drain();
  });
});

describe('delay measuring and grace', () => {
  it('reads when the hook wrote the event, in nanoseconds or seconds', () => {
    expect(sentAtMs('{"nonce":"n","ts":1791927986345001126,"agent":"claude"}')).toBeCloseTo(1791927986345.001, 0);
    expect(sentAtMs('{"nonce":"n","ts":1791927986,"agent":"claude"}')).toBe(1791927986000);
    expect(sentAtMs('{"nonce":"n"}')).toBeUndefined();
  });

  it('the spool reports how long an event waited', () => {
    const root = mkdtempSync(join(tmpdir(), 'arctri-spool-'));
    const got: Array<number | undefined> = [];
    const sp = new EventSpool(root, 's9', 'n1', (_e, m) => got.push(m.latencyMs), () => 4_000_000_000_500);
    // written at 4_000_000_000_000 ms (as nanoseconds), read 500 ms later
    writeFileSync(join(root, 'a.json'), '{"nonce":"n1","ts":4000000000000000000,"agent":"claude","payload":{"hook_event_name":"Stop"}}');
    sp.drain();
    expect(got).toEqual([500]);
  });

  it('clearSoon waits, and cancelClear keeps the status of an agent that was only briefly out of sight', () => {
    vi.useFakeTimers();
    try {
      const root = mkdtempSync(join(tmpdir(), 'arctri-spool-'));
      const seen: Array<AgentStatus | null> = [];
      const svc = new AgentStatusService({ root, windowFocused: () => true, onChanged: (s) => seen.push(s) });
      svc.begin('s3', 'claude-code');
      svc.clearSoon('s3', 1500);
      vi.advanceTimersByTime(1000);
      svc.cancelClear('s3');
      vi.advanceTimersByTime(5000);
      expect(svc.has('s3')).toBe(true);
      svc.clearSoon('s3', 1500);
      vi.advanceTimersByTime(1600);
      expect(svc.has('s3')).toBe(false);
      expect(seen.at(-1)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('service: starting, stale and simultaneous sessions', () => {
  const make = (extra: Partial<ConstructorParameters<typeof AgentStatusService>[0]> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'arctri-svc-'));
    const seen: Array<{ id: string; s: AgentStatus | null }> = [];
    const svc = new AgentStatusService({ root, windowFocused: () => true, onChanged: (s, id) => seen.push({ id, s }), ...extra });
    return { svc, seen };
  };
  const ev = (o: Partial<AgentStatus>): AgentStatus => ({
    sessionId: 's1', agentId: 'claude-code', state: 'working', timestamp: Date.now() + 60_000, source: 'claude-hook', confidence: 'high', since: 1, unread: false, ...o
  });

  it('starts as starting with hooks, becomes unknown when no event ever comes, and unknown at once without hooks', () => {
    vi.useFakeTimers();
    try {
      const { svc } = make({ noEventsMs: 1000 });
      svc.begin('a', 'claude-code', true);
      expect(svc.list().find((s) => s.sessionId === 'a')?.state).toBe('starting');
      vi.advanceTimersByTime(1100);
      expect(svc.list().find((s) => s.sessionId === 'a')?.state).toBe('unknown');
      svc.begin('b', 'codex', false);
      expect(svc.list().find((s) => s.sessionId === 'b')?.state).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a real event cancels the wait: a late timer never overrides what the agent said', () => {
    vi.useFakeTimers();
    try {
      const { svc } = make({ noEventsMs: 1000 });
      svc.begin('a', 'claude-code', true);
      svc.apply(ev({ sessionId: 'a', state: 'ready' }));
      vi.advanceTimersByTime(5000);
      expect(svc.list().find((s) => s.sessionId === 'a')?.state).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('full agent turn: ready, working, approval, working, finished, and a new turn', () => {
    const { svc } = make();
    svc.begin('a', 'claude-code', true);
    const states: string[] = [];
    let t = Date.now() + 60_000;
    for (const state of ['ready', 'working', 'needs-approval', 'working', 'finished', 'working'] as const) {
      svc.apply(ev({ sessionId: 'a', state, timestamp: (t += 10) }), { sentAt: t });
      states.push(svc.list().find((s) => s.sessionId === 'a')!.state);
    }
    expect(states).toEqual(['ready', 'working', 'needs-approval', 'working', 'finished', 'working']);
  });

  it('drops an event written before one that was already seen, and keeps sessions apart', () => {
    const { svc } = make();
    const now = Date.now() + 60_000;
    svc.apply(ev({ sessionId: 'a', state: 'finished', timestamp: now }), { sentAt: 500 });
    svc.apply(ev({ sessionId: 'a', state: 'working', timestamp: now + 1 }), { sentAt: 400 }); // late arrival of an older event
    svc.apply(ev({ sessionId: 'b', agentId: 'codex', state: 'working', timestamp: now + 2 }), { sentAt: 100 }); // another tab has its own clock of events
    const by = (id: string) => svc.list().find((s) => s.sessionId === id)?.state;
    expect(by('a')).toBe('finished');
    expect(by('b')).toBe('working');
  });

  it('closing a tab while events still arrive leaves nothing behind', () => {
    const { svc, seen } = make({ acceptsEvents: () => true });
    const dir = svc.watch('c', 'n1');
    writeFileSync(join(dir, '1.json'), env('claude', { hook_event_name: 'Stop' }, 'n1'));
    svc.forget('c');
    expect(existsSync(dir)).toBe(false); // the hook script finds no directory and exits quietly
    expect(svc.list().find((s) => s.sessionId === 'c')).toBeUndefined();
    expect(seen.at(-1)?.s ?? null).toBeNull();
  });
});

describe('the late permission notification of a question', () => {
  it('does not turn a question into an approval', () => {
    const root = mkdtempSync(join(tmpdir(), 'arctri-q-'));
    const svc = new AgentStatusService({ root, windowFocused: () => true, onChanged: () => undefined });
    const now = Date.now() + 60_000;
    const base = { sessionId: 'q', agentId: 'claude-code' as const, source: 'claude-hook' as const, confidence: 'high' as const };
    svc.apply({ ...base, state: 'waiting', timestamp: now, detail: { event: 'PreToolUse', tool: 'AskUserQuestion' } });
    svc.apply({ ...base, state: 'needs-approval', timestamp: now + 6000, detail: { event: 'Notification', notificationType: 'permission_prompt' } });
    expect(svc.list().find((s) => s.sessionId === 'q')?.state).toBe('waiting');
    // but a real permission request for another tool is still an approval
    svc.apply({ ...base, state: 'working', timestamp: now + 7000, detail: { event: 'PreToolUse', tool: 'Bash' } });
    svc.apply({ ...base, state: 'needs-approval', timestamp: now + 8000, detail: { event: 'Notification', notificationType: 'permission_prompt' } });
    expect(svc.list().find((s) => s.sessionId === 'q')?.state).toBe('needs-approval');
  });
});
