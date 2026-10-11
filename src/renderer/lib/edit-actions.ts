import { peekHost } from '@/features/terminal/xterm-host';
import { copyText, readClipboard } from '@/lib/clipboard';
import { useSessions } from '@/stores/sessions';

type Field = HTMLInputElement | HTMLTextAreaElement;
const isField = (el: Element | null): el is Field => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
const host = () => {
  const id = useSessions.getState().activeId;
  return id ? peekHost(id) : undefined;
};

/** Edit menu actions. `target` is what had the focus before the menu opened (a text field, or nothing for the terminal). */
export function editCopy(target: Element | null): void {
  if (isField(target)) {
    const text = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
    if (text) void copyText(text);
    return;
  }
  host()?.copySelection();
}

export async function editPaste(target: Element | null): Promise<void> {
  if (isField(target)) {
    const text = await readClipboard();
    if (!text) return;
    target.focus();
    document.execCommand('insertText', false, text);
    return;
  }
  await host()?.pasteFromClipboard();
}

export function editSelectAll(target: Element | null): void {
  if (isField(target)) target.select();
  else host()?.selectAll();
}
