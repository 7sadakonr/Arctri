import { clipboard, nativeImage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attachment } from '@shared/types/attachment';
import type { SessionInfo } from '@shared/types/session';
import type { WslManager } from '../wsl/wsl-manager';
import { findPastedImage, tempRoots } from '../agents/claude-images';
import { formatRef, uncToPosix } from './refs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const THUMB_WIDTH = 320;
const PREVIEW_MAX = 2048;
const MAX_PASTED_BYTES = 25 * 1024 * 1024;

/** Files this app handed to the window as attachments: the only ones the window may ask to see or open. */
const handedOut = new Set<string>();
const MAX_HANDED_OUT = 500;
function rememberSource(path: string): void {
  handedOut.delete(path);
  handedOut.add(path);
  if (handedOut.size > MAX_HANDED_OUT) handedOut.delete(handedOut.values().next().value as string);
}
export const isHandedOut = (path: string): boolean => handedOut.has(path);

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
    rememberSource(f);
    out.push({ ref, name: basename(f.replace(/\\/g, '/')), image, src: f, thumb: image ? thumbOf(nativeImage.createFromPath(f)) : undefined });
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

/** Preview of `[Image #n]` from the file the agent saved when the image was pasted; undefined when there is none (yet). */
export async function pastedImageThumb(
  info: SessionInfo, agentSessionId: string | undefined, n: number
): Promise<{ thumb: string; src: string } | undefined> {
  if (!info.cwd) return undefined;
  const file = await findPastedImage(tempRoots(info.env), info.cwd.path, agentSessionId, n);
  if (!file) return undefined;
  const st = await stat(file).catch(() => null);
  if (!st || st.size > MAX_PASTED_BYTES) return undefined;
  const thumb = thumbOf(nativeImage.createFromBuffer(await readFile(file)));
  if (!thumb) return undefined;
  rememberSource(file);
  return { thumb, src: file };
}

/** A larger picture of an attachment for the preview; null when the file was not handed out, is too big or is not an image. */
export async function attachmentImage(path: string): Promise<string | null> {
  if (!isHandedOut(path)) return null;
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile() || st.size > MAX_PASTED_BYTES) return null;
  const img = nativeImage.createFromBuffer(await readFile(path));
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const long = Math.max(width, height);
  const fit = long > PREVIEW_MAX ? img.resize(width >= height ? { width: PREVIEW_MAX } : { height: PREVIEW_MAX }) : img;
  return fit.toDataURL();
}
