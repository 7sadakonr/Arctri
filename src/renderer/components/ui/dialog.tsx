import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  title, className, children, closeLabel, onCloseAutoFocus
}: { title: string; className?: string; children: React.ReactNode; closeLabel: string; onCloseAutoFocus?: (e: Event) => void }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-panel p-5 text-fg shadow-2xl',
          className
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg" aria-label={closeLabel}>
            <X size={14} />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
