import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../../../resources/agent-hooks/arctri-hook.sh');

/** Runs the real hook script in a temp spool and returns the envelope it wrote. */
function run(agent: 'claude' | 'codex', payload: object, env: Record<string, string> = {}, viaArg = false): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'arctri-hook-'));
  const body = JSON.stringify(payload);
  execFileSync('sh', viaArg ? [script, agent, body] : [script, agent], {
    input: viaArg ? '' : body,
    env: { PATH: process.env['PATH'] ?? '', ARCTRI_EVENTS_DIR: dir, ARCTRI_EVENT_TOKEN: 'tok', ...env }
  });
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as Record<string, unknown>;
}

const line = (model: string) => JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'hi' }] } });
const transcript = (...lines: string[]) => {
  const file = join(mkdtempSync(join(tmpdir(), 'arctri-tr-')), 't.jsonl');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
};

describe.skipIf(process.platform === 'win32')('hook script: the model in use', () => {
  it('Claude: the last real model of the transcript at Stop and SessionStart', () => {
    const t = transcript(line('claude-sonnet-5-5'), line('<synthetic>'), line('claude-opus-5-5'), line('<synthetic>'));
    expect(run('claude', { hook_event_name: 'Stop', transcript_path: t })['model']).toBe('claude-opus-5-5');
    expect(run('claude', { hook_event_name: 'SessionStart', transcript_path: t })['model']).toBe('claude-opus-5-5');
  });

  it('Claude: a prompt, a relative path, a path with .. or odd characters give no model; the payload is untouched', () => {
    const t = transcript(line('claude-opus-5-5'));
    expect(run('claude', { hook_event_name: 'UserPromptSubmit', transcript_path: t })['model']).toBe('');
    expect(run('claude', { hook_event_name: 'PostToolUse', transcript_path: t })['model']).toBe('claude-opus-5-5');
    expect(run('claude', { hook_event_name: 'PostToolUseFailure', transcript_path: t })['model']).toBe('claude-opus-5-5');
    expect(run('claude', { hook_event_name: 'Stop', transcript_path: 't.jsonl' })['model']).toBe('');
    expect(run('claude', { hook_event_name: 'Stop', transcript_path: `${t}/../t.jsonl` })['model']).toBe('');
    expect(run('claude', { hook_event_name: 'Stop', transcript_path: `${t};x` })['model']).toBe('');
    const e = run('claude', { hook_event_name: 'Stop', transcript_path: t });
    expect(e['payload']).toEqual({ hook_event_name: 'Stop', transcript_path: t });
    expect(JSON.stringify(e)).not.toContain('hi'); // transcript text never travels
  });

  it('Codex: the last model of the rollout of that thread', () => {
    const home = mkdtempSync(join(tmpdir(), 'arctri-codex-'));
    const tid = '01a128cb-bf50-7fc0-ba6f-02d819637786';
    const day = join(home, 'sessions', '2026', '10', '11');
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, `rollout-2026-10-11T09-30-04-${tid}.jsonl`), [
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-sol' } })
    ].join('\n'));
    writeFileSync(join(day, 'rollout-2026-10-11T09-30-04-99999999-aaaa.jsonl'), JSON.stringify({ payload: { model: 'other-thread' } }));
    const env = { CODEX_HOME: home };
    expect(run('codex', { type: 'agent-turn-complete', 'thread-id': tid }, env, true)['model']).toBe('gpt-6-sol');
    expect(run('codex', { type: 'agent-turn-complete', thread_id: tid }, env, true)['model']).toBe('gpt-6-sol');
    expect(run('codex', { type: 'agent-turn-complete', 'thread-id': 'nope' }, env, true)['model']).toBe('');
    expect(run('codex', { type: 'agent-turn-complete', 'thread-id': '../../etc/passwd' }, env, true)['model']).toBe('');
  });
});
