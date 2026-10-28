import { clipboard, nativeImage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '@shared/types/attachment';
import type { SessionInfo } from '@shared/types/session';
import type { WslManager } from '../wsl/wsl-manager';
import { findPastedImage, tempRoots } from '../agents/claude-images';
import { formatRef, uncToPosix } from './refs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const THUMB_WIDTH = 320;


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

/** Files copied in the file manager, as references for an agent. Empty when the clipboard holds anything else. */
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
  return [];
}

const MAX_PASTED_BYTES = 25 * 1024 * 1024;

/** Preview of `[Image #n]` from the file the agent saved when the image was pasted; undefined when there is none (yet). */
export async function pastedImageThumb(info: SessionInfo, agentSessionId: string | undefined, n: number): Promise<string | undefined> {
  if (!info.cwd) return undefined;
  const file = await findPastedImage(tempRoots(info.env), info.cwd.path, agentSessionId, n);
  if (!file) return undefined;
  const st = await stat(file).catch(() => null);
  if (!st || st.size > MAX_PASTED_BYTES) return undefined;
  return thumbOf(nativeImage.createFromBuffer(await readFile(file)));
}
