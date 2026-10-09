import type { ShellKind } from '../types/env';

/**
 * AgentDock shell integration protocol.
 *  - OSC 133;A|B|C|D[;exit];aid=<nonce>   FinalTerm-compatible prompt marks
 *  - OSC 6973;<nonce>;hello;<shell>;<version>;<blocks 0|1>
 *  - OSC 6973;<nonce>;cmd;<commandId>;<base64 utf8 command text>
 *  - OSC 6973;<nonce>;cwd;<base64 utf8 path>
 *  - OSC 6973;<nonce>;cwdp;<plain path>   (cmd.exe)
 * Anything without the session nonce is ignored (a `cat`-ed file must not forge events).
 */
export const OSC_MARK = 133;
export const OSC_AGENTDOCK = 6973;

export type ShellEvent =
  | { t: 'hello'; shell: ShellKind; version: string; blocks: boolean }
  | { t: 'promptStart' }
  | { t: 'inputStart' }
  | { t: 'commandLine'; commandId: number; text: string }
  | { t: 'executed' }
  | { t: 'finished'; exitCode?: number }
  | { t: 'cwd'; path: string };

export function decodeB64(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

export function encodeB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const SHELLS: ShellKind[] = ['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'other'];

export function parseOsc(id: number, payload: string, nonce: string): ShellEvent | null {
  if (!nonce) return null;
  if (id === OSC_MARK) {
    const parts = payload.split(';');
    const aid = parts.find((p) => p.startsWith('aid='));
    if (aid !== `aid=${nonce}`) return null;
    const rest = parts.filter((p) => !p.startsWith('aid='));
    switch (rest[0]) {
      case 'A':
        return { t: 'promptStart' };
      case 'B':
        return { t: 'inputStart' };
      case 'C':
        return { t: 'executed' };
      case 'D': {
        const code = rest[1] !== undefined && /^-?\d+$/.test(rest[1]) ? Number(rest[1]) : undefined;
        return code === undefined ? { t: 'finished' } : { t: 'finished', exitCode: code };
      }
      default:
        return null;
    }
  }
  if (id === OSC_AGENTDOCK) {
    const parts = payload.split(';');
    if (parts[0] !== nonce) return null;
    switch (parts[1]) {
      case 'hello': {
        const shell = SHELLS.includes(parts[2] as ShellKind) ? (parts[2] as ShellKind) : 'other';
        return { t: 'hello', shell, version: parts[3] ?? '', blocks: parts[4] === '1' };
      }
      case 'cmd': {
        const commandId = Number(parts[2]);
        if (!Number.isInteger(commandId)) return null;
        return { t: 'commandLine', commandId, text: decodeB64(parts[3] ?? '') };
      }
      case 'cwd':
        return { t: 'cwd', path: decodeB64(parts[2] ?? '') };
      case 'cwdp': // plain path, used by cmd.exe PROMPT which cannot base64
        return { t: 'cwd', path: parts.slice(2).join(';') };
      default:
        return null;
    }
  }
  return null;
}
