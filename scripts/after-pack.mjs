// electron-builder afterPack hook. On macOS node-pty starts every shell through a small helper program (spawn-helper) that
// must have its execute bit; it is unpacked next to the asar, and a lost bit shows up as "posix_spawnp failed" for every tab.
// This runs before the app is signed, so the signature covers the fixed mode.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function helpers(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) helpers(p, out);
    else if (name === 'spawn-helper') out.push(p);
  }
  return out;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const unpacked = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked');
  if (!existsSync(unpacked)) return;
  const found = helpers(unpacked);
  for (const p of found) chmodSync(p, 0o755);
  console.log(`afterPack: spawn-helper made executable (${found.length})`);
}
