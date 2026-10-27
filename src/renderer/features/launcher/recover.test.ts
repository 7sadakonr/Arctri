import { describe, expect, it } from 'vitest';
import { recoverHint } from './recover';

describe('recoverHint', () => {
  it('points a missing agent at its install guide and settings', () => {
    expect(recoverHint('Claude Code is not installed in Windows.')).toBe('recover.missingCli');
  });
  it('knows WSL, permission and not-found failures', () => {
    expect(recoverHint('WSL is not available')).toBe('recover.wsl');
    expect(recoverHint("spawn pwsh.exe EACCES")).toBe('recover.permission');
    expect(recoverHint('Access is denied.')).toBe('recover.permission');
    expect(recoverHint('spawn pwsh ENOENT')).toBe('recover.notFound');
  });
  it('says nothing when it does not know', () => {
    expect(recoverHint('something odd happened')).toBeUndefined();
  });
});
