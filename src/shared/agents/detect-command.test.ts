import { describe, expect, it } from 'vitest';
import { detectAgentCommand as d } from './detect-command';

describe('detectAgentCommand', () => {
  it('recognises plain invocations on every shell', () => {
    expect(d('claude', 'zsh')).toBe('claude-code');
    expect(d('codex', 'bash')).toBe('codex');
    expect(d('claude --resume', 'bash')).toBe('claude-code');
    expect(d('codex resume --last', 'pwsh')).toBe('codex');
    expect(d('claude "แก้บั๊กหน้า login"', 'zsh')).toBe('claude-code');
    expect(d('codex --model gpt-5 "fix it"', 'powershell')).toBe('codex');
  });

  it('handles paths, extensions, wrappers and environment assignments', () => {
    expect(d('/home/me/.local/bin/claude', 'bash')).toBe('claude-code');
    expect(d('C:\\Users\\Me\\AppData\\codex.exe', 'pwsh')).toBe('codex');
    expect(d('& "C:\\tools\\codex.cmd"', 'pwsh')).toBe('codex');
    expect(d('FOO=1 BAR=2 claude', 'bash')).toBe('claude-code');
    expect(d('exec codex', 'bash')).toBe('codex');
    expect(d('command claude', 'zsh')).toBe('claude-code');
    expect(d('env NODE_ENV=dev codex', 'bash')).toBe('codex');
    expect(d('time claude', 'bash')).toBe('claude-code');
  });

  it('finds the agent after other commands on the line', () => {
    expect(d('cd proj && claude', 'bash')).toBe('claude-code');
    expect(d('cd proj; codex', 'zsh')).toBe('codex');
    expect(d('echo a\ncodex', 'bash')).toBe('codex');
    expect(d('git pull || claude', 'bash')).toBe('claude-code');
  });

  it('recognises package runners and drops the version', () => {
    expect(d('npx @anthropic-ai/claude-code', 'bash')).toBe('claude-code');
    expect(d('npx -y @openai/codex@latest', 'bash')).toBe('codex');
    expect(d('pnpm dlx @openai/codex', 'bash')).toBe('codex');
    expect(d('yarn dlx @anthropic-ai/claude-code@1.2.3 --resume', 'bash')).toBe('claude-code');
    expect(d('bunx @openai/codex', 'zsh')).toBe('codex');
    expect(d('npm exec @openai/codex', 'bash')).toBe('codex');
  });

  it('ignores one-shot and informational uses', () => {
    expect(d('claude -p "hi"', 'bash')).toBeUndefined();
    expect(d('claude --print hello', 'bash')).toBeUndefined();
    expect(d('claude --version', 'bash')).toBeUndefined();
    expect(d('claude mcp list', 'bash')).toBeUndefined();
    expect(d('claude update', 'bash')).toBeUndefined();
    expect(d('codex exec "run tests"', 'bash')).toBeUndefined();
    expect(d('codex login', 'bash')).toBeUndefined();
    expect(d('codex --help', 'pwsh')).toBeUndefined();
    expect(d('codex mcp add x', 'bash')).toBeUndefined();
    expect(d('npx @openai/codex --version', 'bash')).toBeUndefined();
  });

  it('ignores look-alikes, quoted text and piped output', () => {
    expect(d('claudette', 'bash')).toBeUndefined();
    expect(d('echo claude', 'bash')).toBeUndefined();
    expect(d('echo "cd x; claude"', 'bash')).toBeUndefined();
    expect(d('which claude', 'bash')).toBeUndefined();
    expect(d('claude | tee out.txt', 'bash')).toBeUndefined();
    expect(d('npx cowsay hi', 'bash')).toBeUndefined();
    expect(d('', 'bash')).toBeUndefined();
  });
});
