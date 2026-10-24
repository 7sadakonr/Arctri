import { describe, expect, it } from 'vitest';
import { classifyRemoteError, classifySync, hasConflict, porcelainPaths } from './sync';

const base = { detached: false, upstream: 'origin/main', ahead: 0, behind: 0 };

describe('classifySync', () => {
  it('reads the numbers against the upstream', () => {
    expect(classifySync(base)).toBe('up-to-date');
    expect(classifySync({ ...base, behind: 3 })).toBe('behind');
    expect(classifySync({ ...base, ahead: 2 })).toBe('ahead');
    expect(classifySync({ ...base, ahead: 2, behind: 1 })).toBe('diverged');
  });
  it('has no standing without a branch or an upstream', () => {
    expect(classifySync({ ...base, detached: true })).toBe('detached');
    expect(classifySync({ ...base, upstream: undefined })).toBe('no-upstream');
  });
  it('never says up to date after a failed remote check', () => {
    expect(classifySync({ ...base, remoteError: true })).toBe('offline');
    expect(classifySync({ ...base, behind: 4, remoteError: true })).toBe('offline');
  });
  it('shows a fetch in progress and unknown numbers', () => {
    expect(classifySync({ ...base, fetching: true })).toBe('fetching');
    expect(classifySync({ ...base, ahead: null, behind: null })).toBe('unknown');
    expect(classifySync({ ...base, unknown: true })).toBe('unknown');
  });
});

describe('classifyRemoteError', () => {
  it('separates a refused login from an unreachable server', () => {
    expect(classifyRemoteError("fatal: Authentication failed for 'https://x/y.git'")).toBe('AUTH_REQUIRED');
    expect(classifyRemoteError('fatal: could not read Username for https://x: terminal prompts disabled')).toBe('AUTH_REQUIRED');
    expect(classifyRemoteError('git@x: Permission denied (publickey).')).toBe('AUTH_REQUIRED');
    expect(classifyRemoteError('fatal: unable to access: Could not resolve host: x')).toBe('OFFLINE');
    expect(classifyRemoteError("fatal: '/no/such' does not appear to be a git repository")).toBe('OFFLINE');
  });
});

describe('porcelain helpers', () => {
  it('finds conflicts and paths', () => {
    expect(hasConflict('UU a.ts\n M b.ts\n')).toBe(true);
    expect(hasConflict(' M a.ts\n?? b.ts\n')).toBe(false);
    expect(porcelainPaths(' M a.ts\nR  old -> new\n?? c\n')).toEqual(['a.ts', 'new', 'c']);
  });
});
