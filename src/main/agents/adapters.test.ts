import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeCode, codex, isUnsafeArgs } from './adapters';
import { findOnWindowsPath, parseVersion } from './detect';

const CLAUDE_HELP = `
  -c, --continue   Continue the most recent conversation
  -r, --resume [value]  Resume a conversation
  --model <model>  Model for the current session
  --permission-mode <mode>  (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")
`;
const CODEX_HELP = `
Commands:
  resume            Resume a previous interactive session
Options:
  -m, --model <MODEL>
  -a, --ask-for-approval <APPROVAL_POLICY>
      - untrusted: only trusted commands
      - on-request: the model decides
      - on-failure: ask on failure
      - never: never ask
`;

describe('claude code adapter', () => {
  const caps = claudeCode.capabilities(CLAUDE_HELP);
  it('derives capabilities from help and never offers the bypass mode', () => {
    expect(caps.resumeLast).toBe(true);
    expect(caps.permissionModes).toEqual(['manual', 'acceptEdits', 'plan']);
    expect(caps.permissionModes).not.toContain('bypassPermissions');
  });
  it('builds argv for resume, model and permission mode', () => {
    expect(claudeCode.buildArgs(caps, { resume: 'last', model: 'opus', permissionMode: 'plan' })).toEqual([
      '--continue', '--model', 'opus', '--permission-mode', 'plan'
    ]);
    expect(claudeCode.buildArgs(caps, { resume: 'picker' })).toEqual(['--resume']);
  });
  it('drops options the CLI does not advertise or that look unsafe', () => {
    const none = claudeCode.capabilities('nothing here');
    expect(claudeCode.buildArgs(none, { resume: 'last', model: 'opus', permissionMode: 'plan' })).toEqual([]);
    expect(claudeCode.buildArgs(caps, { model: 'a b; rm -rf /' })).toEqual([]);
    expect(claudeCode.buildArgs(caps, { permissionMode: 'bypassPermissions' })).toEqual([]);
  });
});

describe('codex adapter', () => {
  const caps = codex.capabilities(CODEX_HELP);
  it('offers only approval modes that keep a human in the loop', () => {
    expect(caps.permissionModes).toEqual(['untrusted', 'on-request', 'on-failure']);
  });
  it('puts flags before the resume subcommand', () => {
    expect(codex.buildArgs(caps, { resume: 'last', model: 'gpt-5', permissionMode: 'on-request' })).toEqual([
      '--model', 'gpt-5', '--ask-for-approval', 'on-request', 'resume', '--last'
    ]);
  });
});

describe('unsafe launch arguments', () => {
  it('flags arguments that turn permission checks off', () => {
    expect(isUnsafeArgs(['--dangerously-skip-permissions'])).toBe(true);
    expect(isUnsafeArgs(['--dangerously-bypass-approvals-and-sandbox'])).toBe(true);
    expect(isUnsafeArgs(['--permission-mode=bypassPermissions'])).toBe(true);
    expect(isUnsafeArgs(['--verbose'])).toBe(false);
    expect(isUnsafeArgs(undefined)).toBe(false);
  });
});

describe('detection helpers', () => {
  it('prefers a native exe over an npm cmd shim and honours overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ad-path-'));
    const other = mkdtempSync(join(tmpdir(), 'ad-path-'));
    writeFileSync(join(dir, 'codex.cmd'), '');
    writeFileSync(join(other, 'codex.exe'), '');
    expect(findOnWindowsPath('codex', `${dir};${other}`)).toBe(join(other, 'codex.exe'));
    expect(findOnWindowsPath('codex', dir)).toBe(join(dir, 'codex.cmd'));
    expect(findOnWindowsPath('nope', `${dir};${other}`)).toBeUndefined();
    expect(findOnWindowsPath('codex', dir, join(other, 'missing.exe'))).toBeUndefined();
  });
  it('parses versions', () => {
    expect(parseVersion('2.1.295 (Claude Code)')).toBe('2.1.295');
    expect(parseVersion('codex-cli 0.160.0')).toBe('0.160.0');
    expect(parseVersion('garbage')).toBeUndefined();
  });
});
