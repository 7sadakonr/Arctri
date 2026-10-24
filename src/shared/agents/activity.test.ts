import { describe, expect, it } from 'vitest';
import { activityOf } from './activity';

describe('activityOf', () => {
  it('uses the description the agent wrote, never the command', () => {
    expect(activityOf('Bash', { command: 'rm -rf /', description: 'Clean build output' })).toBe('Clean build output');
    expect(activityOf('Bash', { command: 'ls' })).toBe('Bash');
  });
  it('names the file for file tools, by its base name', () => {
    expect(activityOf('Edit', { file_path: '/a/b/foo.ts', new_string: 'x' })).toBe('Edit foo.ts');
    expect(activityOf('Read', { file_path: 'C:\\x\\bar.md' })).toBe('Read bar.md');
    expect(activityOf('Write', {})).toBe('Write');
  });
  it('TodoWrite: the task in progress', () => {
    expect(activityOf('TodoWrite', { todos: [{ status: 'completed', activeForm: 'A' }, { status: 'in_progress', activeForm: 'Running tests' }] })).toBe('Running tests');
    expect(activityOf('TodoWrite', { todos: [] })).toBe('TodoWrite');
  });
  it('any other tool is shown by its name; odd input does not throw', () => {
    expect(activityOf('WebSearch', { query: 'secret' })).toBe('WebSearch');
    expect(activityOf('Grep', null)).toBe('Grep');
    expect(activityOf('Bash', 'x')).toBe('Bash');
  });
});
