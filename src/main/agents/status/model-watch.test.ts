import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastSetModel, TranscriptModelWatch } from './model-watch';

const setModel = (name: string) => JSON.stringify({ type: 'user', message: { content: `<local-command-stdout>Set model to \`${name}\` and saved</local-command-stdout>` } }) + '\n';

describe('lastSetModel', () => {
  it('is the last model /model reported, and nothing without one', () => {
    expect(lastSetModel(setModel('Opus 5.5') + setModel('Sonnet 5.5'))).toBe('Sonnet 5.5');
    expect(lastSetModel('{"type":"assistant"}')).toBeUndefined();
  });
});

describe('TranscriptModelWatch', () => {
  let w: TranscriptModelWatch | undefined;
  afterEach(() => w?.stop());

  it('reports only what is appended after it started', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'arctri-mw-')), 't.jsonl');
    writeFileSync(file, setModel('Haiku 5.5')); // from before: not news
    const seen = vi.fn();
    w = new TranscriptModelWatch(file, seen);
    w.start();
    appendFileSync(file, setModel('Opus 5.5'));
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('Opus 5.5'), { timeout: 3000 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a file that is not there yet is not an error', () => {
    w = new TranscriptModelWatch(join(tmpdir(), 'arctri-nope', 'x.jsonl'), vi.fn());
    expect(() => w!.start()).not.toThrow();
  });
});
