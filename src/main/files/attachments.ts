import { app, clipboard, nativeImage } from 'electron';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '@shared/types/attachment';
import type { SessionInfo } from '@shared/types/session';
import type { WslManager } from '../wsl/wsl-manager';
import { formatRef, uncToPosix } from './refs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const THUMB_WIDTH = 320;
const KEEP_MS = 7 * 24 * 3600 * 1000;

const pastesDir = () => join(app.getPath('temp'), 'arctri', 'pastes');

function thumbOf(img: Electron.NativeImage): string | undefined {
  if (img.isEmpty()) return undefined;
  const { width } = img.getSize();
  return (width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH }) : img).toDataURL();
}

/** `@ref` entries (with a preview for images) for files on this machine, written for the tab's environment. */
export async function attachmentsForPaths(info: SessionInfo, wsl: WslManager, paths: string[]): Promise<Attachment[]> {
  const cwd = info.cwd;
  if (!cwd) return [];
  const out: Attachment[] = [];
  for (const f of paths) {
    let ref: string | undefined;
    if (info.env.kind === 'windows') ref = formatRef(cwd.path, f, 'windows');
    else if (info.env.kind === 'local') ref = formatRef(cwd.path, f, 'local');
    else {
      const posixPath = uncToPosix(f, info.env.distro) ?? (f.startsWith('/') ? f : await wsl.toPosix(info.env.distro, f));
      if (posixPath) ref = formatRef(cwd.path, posixPath, 'wsl');
    }
    if (!ref) continue;
    const image = IMAGE_EXT.test(f);
    out.push({ ref, name: basename(f.replace(/\\/g, '/')), image, thumb: image ? thumbOf(nativeImage.createFromPath(f)) : undefined });
  }
  return out;
}

/** Reads one entry of the clipboard; undefined when it is not there. */
async function readType(item: Electron.ClipboardItem, type: string): Promise<Blob | undefined> {
  if (!item.types.includes(type)) return undefined;
  try {
    return (await item.getType(type)) as Blob;
  } catch {
    return undefined;
  }
}

/** What is on the clipboard for an agent: copied files, or an image (saved to the temp folder). Empty when it is plain text. */
export async function clipboardAttachments(info: SessionInfo, wsl: WslManager): Promise<Attachment[]> {
  let items: Electron.ClipboardItem[];
  try {
    items = await clipboard.read();
  } catch {
    return [];
  }
  for (const item of items) {
    // files copied in the file manager arrive as a list of file:// links
    const list = await readType(item, 'text/uri-list');
    const files = list
      ? (await list.text())
          .split(/\r?\n/)
          .filter((l) => l.startsWith('file://'))
          .flatMap((l) => {
            try {
              return [fileURLToPath(l)];
            } catch {
              return [];
            }
          })
      : [];
    if (files.length) return attachmentsForPaths(info, wsl, files);
  }
  for (const item of items) {
    const png = await readType(item, 'image/png');
    if (!png) continue;
    const dir = pastesDir();
    await mkdir(dir, { recursive: true });
    const file = join(dir, `paste-${Date.now()}.png`);
    await writeFile(file, Buffer.from(await png.arrayBuffer()));
    return attachmentsForPaths(info, wsl, [file]);
  }
  return [];
}

/** Pasted images older than a week are removed when the app starts. */
export async function sweepPastes(): Promise<void> {
  const dir = pastesDir();
  try {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      const st = await stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > KEEP_MS) await rm(p, { force: true });
    }
  } catch {
    /* nothing pasted yet */
  }
}
