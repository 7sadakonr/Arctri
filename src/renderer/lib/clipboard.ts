export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

const THUMB_WIDTH = 320;

/** A small preview of the image on the clipboard (undefined when there is none or it cannot be read). */
export async function clipboardImageThumb(): Promise<{ name: string; thumb: string } | undefined> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const bitmap = await createImageBitmap(await item.getType(type));
      const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return { name: 'image', thumb: canvas.toDataURL('image/png') };
    }
  } catch {
    /* no image, or the clipboard is not readable now */
  }
  return undefined;
}
