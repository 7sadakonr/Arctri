import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../types/session';
import { tabStatus } from './tab-status';

const info = (o: Partial<SessionInfo> = {}): SessionInfo => ({ state: 'running', kind: 'shell', integration: 'active', ...o }) as SessionInfo;

describe('terminal model: starting -> ready -> running -> ready', () => {
  it('follows the process and the prompt', () => {
    expect(tabStatus(info({ state: 'starting' }), undefined)).toBe('starting');
    expect(tabStatus(info({ integration: 'pending' }), 'unknown')).toBe('starting');
    expect(tabStatus(info(), 'editing')).toBe('ready');
    expect(tabStatus(info(), 'executing')).toBe('running');
    expect(tabStatus(info(), 'prompt')).toBe('ready');
  });
  it('a shell without integration is ready, not waiting for a hello that never comes', () => {
    expect(tabStatus(info({ integration: 'unavailable' }), 'unknown')).toBe('ready');
  });
});

describe('agent model', () => {
  const tab = (s?: Parameters<typeof tabStatus>[2], o: Partial<SessionInfo> = {}) =>
    tabStatus(info({ kind: 'agent', ...o }), 'unknown', s);
  it('is unknown without any reliable event', () => {
    expect(tab(undefined)).toBe('unknown');
    expect(tab({ state: 'unknown' })).toBe('unknown');
  });
  it('maps every state an agent can report', () => {
    expect(tab({ state: 'starting' })).toBe('starting');
    expect(tab({ state: 'ready' })).toBe('ready');
    expect(tab({ state: 'working' })).toBe('working');
    expect(tab({ state: 'waiting' })).toBe('waiting');
    expect(tab({ state: 'needs-approval' })).toBe('approval');
    expect(tab({ state: 'finished' })).toBe('finished');
  });
  it('the process starting wins over a status that is not there yet', () => {
    expect(tab({ state: 'working' }, { state: 'starting' })).toBe('starting');
  });
  it('an agent typed into a shell uses the agent model; when it ends the shell is ready again', () => {
    const running = info({ runningAgent: { agentId: 'claude-code', startedAt: 1, command: 'claude' } });
    expect(tabStatus(running, 'executing', { state: 'finished' })).toBe('finished');
    expect(tabStatus(running, 'executing', undefined)).toBe('unknown');
    expect(tabStatus(info(), 'editing', undefined)).toBe('ready');
  });
});

describe('error and exit apply to both models', () => {
  it('failed or a non-zero exit is an error, a clean exit is exited', () => {
    expect(tabStatus(info({ state: 'failed' }), undefined, { state: 'working' })).toBe('error');
    expect(tabStatus(info({ state: 'exited', exit: { code: 1 } }), undefined)).toBe('error');
    expect(tabStatus(info({ kind: 'agent', state: 'exited', exit: { code: 0 } }), undefined, { state: 'finished' })).toBe('exited');
  });
});
