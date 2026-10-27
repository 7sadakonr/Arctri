import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { verifyManifests } from '../../scripts/verify-update-manifest.mjs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arctri-manifest-'));
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function asset(name: string, body: string) {
  writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, `${name}.blockmap`), 'map');
  return { url: name, sha512: createHash('sha512').update(body).digest('base64'), size: body.length };
}

function manifest(name: string, version: string, files: Array<{ url: string; sha512: string; size: number }>) {
  const lines = [`version: ${version}`, 'files:', ...files.flatMap((f) => [`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`])];
  writeFileSync(join(dir, name), lines.join('\n'));
}

function release(version: string, channel: string) {
  const exe = asset(`Arctri-Setup-${version}-x64.exe`, 'exe');
  const arm = asset(`Arctri-${version}-arm64.zip`, 'arm');
  const x64 = asset(`Arctri-${version}-x64.zip`, 'x64');
  manifest(`${channel}.yml`, version, [exe]);
  manifest(`${channel}-mac.yml`, version, [arm, x64]);
  return { exe, arm, x64 };
}

describe('verifyManifests', () => {
  it('accepts a consistent release, beta or stable (the metadata is latest.yml either way)', async () => {
    release('0.4.0-beta.1', 'latest');
    expect(await verifyManifests(dir, 'v0.4.0-beta.1')).toEqual([]);
  });

  it('wants both the Windows and the macOS metadata', async () => {
    release('1.0.0', 'latest');
    rmSync(join(dir, 'latest-mac.yml'));
    expect(await verifyManifests(dir, 'v1.0.0')).toEqual(['missing latest-mac.yml']);
  });

  it('rejects a manifest for another version than the tag', async () => {
    release('0.4.0-beta.1', 'latest');
    expect((await verifyManifests(dir, 'v0.4.0-beta.2')).some((p: string) => p.includes('does not match tag'))).toBe(true);
  });

  it('rejects a checksum that does not match the file', async () => {
    const { exe } = release('0.4.0-beta.1', 'latest');
    manifest('latest.yml', '0.4.0-beta.1', [{ ...exe, sha512: createHash('sha512').update('other').digest('base64') }]);
    expect(await verifyManifests(dir, 'v0.4.0-beta.1')).toEqual([expect.stringContaining('sha512 of Arctri-Setup-0.4.0-beta.1-x64.exe differs')]);
  });

  it('rejects a manifest that points at a file that is not in the release', async () => {
    const { exe } = release('0.4.0-beta.1', 'latest');
    manifest('latest.yml', '0.4.0-beta.1', [{ ...exe, url: 'Arctri-Setup-gone.exe' }]);
    expect((await verifyManifests(dir, 'v0.4.0-beta.1'))[0]).toContain('is not among the release files');
  });

  it('rejects a mac manifest without both architectures', async () => {
    const { arm } = release('0.4.0-beta.1', 'latest');
    manifest('latest-mac.yml', '0.4.0-beta.1', [arm]);
    expect(await verifyManifests(dir, 'v0.4.0-beta.1')).toEqual(['latest-mac.yml: no x64 zip listed']);
  });

  it('rejects an installer without its blockmap', async () => {
    release('0.4.0-beta.1', 'latest');
    rmSync(join(dir, 'Arctri-Setup-0.4.0-beta.1-x64.exe.blockmap'));
    expect((await verifyManifests(dir, 'v0.4.0-beta.1'))[0]).toContain('blockmap is missing');
  });
});
