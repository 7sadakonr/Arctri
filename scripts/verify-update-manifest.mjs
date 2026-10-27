// Checks the updater metadata of a release before it is published: node scripts/verify-update-manifest.mjs <dir> <tag>
// Every manifest must name the tag's version, point at files that are in the directory, and carry the sha512 and size of
// those files. Nothing is repaired here: a mismatch stops the release.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const sha512 = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha512');
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('base64'))).on('error', reject);
  });

/** @returns {Promise<string[]>} the problems found; empty when the release is consistent */
export async function verifyManifests(dir, tag) {
  const version = tag.replace(/^v/, '');
  const problems = [];
  const names = readdirSync(dir);
  const manifests = names.filter((n) => /^(latest|beta)(-mac)?\.yml$/.test(n));
  // A prerelease tag (v0.4.0-beta.1) is published to its own channel; a stable tag must also serve people on beta.
  const pre = version.split('-')[1]?.split('.')[0];
  const channels = pre ? [pre] : ['latest', 'beta'];
  for (const c of channels) for (const name of [`${c}.yml`, `${c}-mac.yml`]) if (!names.includes(name)) problems.push(`missing ${name}`);

  for (const name of manifests) {
    let doc;
    try {
      doc = yaml.load(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      problems.push(`${name}: not valid YAML (${e.message})`);
      continue;
    }
    if (doc?.version !== version) problems.push(`${name}: version ${doc?.version} does not match tag ${tag}`);
    const files = Array.isArray(doc?.files) ? doc.files : [];
    if (files.length === 0) problems.push(`${name}: no files listed`);
    for (const f of files) {
      const path = join(dir, decodeURIComponent(String(f.url)));
      if (!existsSync(path)) {
        problems.push(`${name}: ${f.url} is not among the release files`);
        continue;
      }
      if (f.size !== undefined && f.size !== statSync(path).size) problems.push(`${name}: ${f.url} size differs from the file`);
      if (f.sha512 !== (await sha512(path))) problems.push(`${name}: sha512 of ${f.url} differs from the file`);
      if (/\.(exe|zip)$/.test(path) && !existsSync(`${path}.blockmap`)) problems.push(`${name}: ${f.url}.blockmap is missing`);
    }
    if (name.endsWith('-mac.yml')) {
      for (const arch of ['arm64', 'x64']) {
        if (!files.some((f) => String(f.url).endsWith('.zip') && f.url.includes(arch))) problems.push(`${name}: no ${arch} zip listed`);
      }
    } else if (!files.some((f) => String(f.url).endsWith('.exe'))) problems.push(`${name}: no installer listed`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, tag] = process.argv.slice(2);
  if (!dir || !tag) {
    console.error('usage: node scripts/verify-update-manifest.mjs <dir> <tag>');
    process.exit(2);
  }
  const problems = await verifyManifests(dir, tag);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(`update metadata is consistent for ${tag}`);
}
