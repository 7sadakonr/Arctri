import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { requestSchemas, type Req, type RequestChannel } from '@shared/ipc/contract';

export class IpcError extends Error {
  constructor(readonly code: 'E_INVALID_ARGS' | 'E_FORBIDDEN' | 'E_FAILED', message: string) {
    super(`${code}: ${message}`);
  }
}

type Ev = IpcMainInvokeEvent | IpcMainEvent;

/** Only the application's own page may talk to the main process. */
export function isTrustedSender(event: Ev, allowedOrigins: string[]): boolean {
  const url = event.senderFrame?.url ?? '';
  if (!url) return false;
  return allowedOrigins.some((o) => url === o || url.startsWith(o.endsWith('/') ? o : o + '/') || url.startsWith(o + '#'));
}

export function validate<C extends RequestChannel>(channel: C, payload: unknown): Req<C> {
  const parsed = requestSchemas[channel].safeParse(payload);
  if (!parsed.success) throw new IpcError('E_INVALID_ARGS', `${channel}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return parsed.data as Req<C>;
}

export class Router {
  constructor(private readonly origins: () => string[]) {}

  handle<C extends RequestChannel>(channel: C, fn: (args: Req<C>, event: IpcMainInvokeEvent) => unknown): void {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event, this.origins())) throw new IpcError('E_FORBIDDEN', channel);
      return fn(validate(channel, payload), event);
    });
  }

  /** Fire-and-forget channels (high frequency input and acknowledgements). */
  on<C extends RequestChannel>(channel: C, fn: (args: Req<C>) => void): void {
    ipcMain.on(channel, (event, payload) => {
      if (!isTrustedSender(event, this.origins())) return;
      const parsed = requestSchemas[channel].safeParse(payload);
      if (parsed.success) fn(parsed.data as Req<C>);
    });
  }
}
