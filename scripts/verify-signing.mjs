// Fails when a build that is supposed to be signed is not, or is signed by someone else.
//   node scripts/verify-signing.mjs win <Setup.exe...> --publisher "<name in the certificate subject>"
//   node scripts/verify-signing.mjs mac <Arctri.app or .dmg...>       (run on a Mac)
import { execFileSync } from 'node:child_process';

const [platform, ...rest] = process.argv.slice(2);
const pi = rest.indexOf('--publisher');
const publisher = pi >= 0 ? rest[pi + 1] : undefined;
const files = rest.filter((a, i) => !a.startsWith('--') && i !== pi + 1);
const problems = [];

const run = (cmd, args) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

if (!['win', 'mac'].includes(platform) || files.length === 0) {
  console.error('usage: verify-signing.mjs <win|mac> <files...> [--publisher <name>]');
  process.exit(2);
}

for (const file of files) {
  if (platform === 'win') {
    if (!publisher) {
      problems.push('--publisher is required on Windows');
      break;
    }
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; ` +
      `@{ status = "$($s.Status)"; subject = "$($s.SignerCertificate.Subject)"; timestamp = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress`;
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    let sig;
    try {
      sig = JSON.parse(r.out.trim());
    } catch {
      problems.push(`${file}: could not read the signature (${r.out.trim().slice(0, 200)})`);
      continue;
    }
    if (sig.status !== 'Valid') problems.push(`${file}: signature status ${sig.status}`);
    if (!sig.timestamp) problems.push(`${file}: signature has no timestamp, it would expire with the certificate`);
    if (!sig.subject.includes(publisher)) problems.push(`${file}: signed by "${sig.subject}", expected "${publisher}"`);
  } else {
    const isDmg = file.endsWith('.dmg');
    const checks = [['codesign', ['--verify', '--deep', '--strict', '--verbose=2', file]], ['xcrun', ['stapler', 'validate', file]]];
    if (!isDmg) checks.push(['spctl', ['--assess', '--type', 'execute', '--verbose=2', file]]);
    else checks.push(['spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', file]]);
    for (const [cmd, args] of checks) {
      const r = run(cmd, args);
      if (!r.ok) problems.push(`${file}: ${cmd} ${args[0]} failed: ${r.out.trim().split('\n').slice(-2).join(' | ')}`);
    }
    if (!isDmg) {
      const info = run('codesign', ['-dv', '--verbose=4', file]).out;
      if (/Signature=adhoc/.test(info)) problems.push(`${file}: ad-hoc signature, not a Developer ID`);
      if (!/flags=0x[0-9a-f]*\(runtime\)/.test(info)) problems.push(`${file}: hardened runtime is not enabled`);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`::error title=Signing verification failed::${p}`);
  process.exit(1);
}
console.log(`signing verified for ${files.length} file(s)`);
