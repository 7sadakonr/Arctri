import { Paperclip, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { attachFiles, sendToAgent } from './insert';

/** A multi-line message box. Nothing leaves it until the user presses Enter (or Send). IME composition is respected. */
export function RichInput({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const composing = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => area.current?.focus(), []);

  const send = () => {
    const value = text.replace(/\s+$/, '');
    if (!value) return;
    sendToAgent(sessionId, value);
    setText('');
    onClose();
  };

  const attach = async () => {
    const refs = (await attachFiles(sessionId)).map((a) => a.ref);
    if (refs.length) setText((v) => `${v}${v && !v.endsWith(' ') && !v.endsWith('\n') ? ' ' : ''}${refs.join(' ')} `);
    area.current?.focus();
  };

  return (
    <div data-testid="rich-input" className="mx-3 mb-1 rounded-lg border border-border bg-panel p-2">
      <textarea
        ref={area}
        value={text}
        rows={4}
        spellCheck={false}
        placeholder={t('agent.richPlaceholder')}
        aria-label={t('agent.richInput')}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'g')) {
            e.preventDefault();
            onClose();
          }
        }}
        className="block max-h-48 w-full resize-y bg-transparent text-[13px] leading-snug text-fg outline-none placeholder:text-fg-muted/70"
      />
      <div className="mt-1 flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => void attach()}>
          <Paperclip size={12} />
          {t('agent.attach')}
        </Button>
        <span className="flex-1" />
        <Button variant="default" size="sm" onClick={send} disabled={!text.trim()}>
          <Send size={12} />
          {t('agent.send')}
        </Button>
      </div>
    </div>
  );
}
