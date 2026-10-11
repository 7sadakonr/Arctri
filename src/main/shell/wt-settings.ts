import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShellProfile } from '@shared/types/env';

/** Removes // and block comments and trailing commas without touching anything inside strings. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

interface WtProfile {
  guid?: string;
  name?: string;
  source?: string;
  commandline?: string;
  hidden?: boolean;
}

export interface WtSettings {
  profiles: WtProfile[];
  defaultGuid?: string;
}

export function parseWtSettings(text: string): WtSettings | undefined {
  let json: unknown;
  try {
    json = JSON.parse(stripJsonc(text.replace(/^﻿/, '')));
  } catch {
    return undefined;
  }
  if (!json || typeof json !== 'object') return undefined;
  const root = json as { profiles?: unknown; defaultProfile?: unknown };
  const raw = Array.isArray(root.profiles) ? root.profiles : (root.profiles as { list?: unknown } | undefined)?.list;
  if (!Array.isArray(raw)) return undefined;
  const profiles = raw.filter((p): p is WtProfile => !!p && typeof p === 'object');
  return { profiles, ...(typeof root.defaultProfile === 'string' ? { defaultGuid: root.defaultProfile } : {}) };
}

/** Splits a Windows command line into its program and arguments (double quotes group words). */
export function splitCommandline(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2]!);
  return out;
}

const expandEnv = (s: string): string => s.replace(/%([^%]+)%/g, (_, k: string) => process.env[k] ?? `%${k}%`);
const baseName = (p: string): string => (p.split(/[\\/]/).pop() ?? p).toLowerCase();

/** Lower-case letters and digits only, so "Ubuntu22.04LTS" and "Ubuntu-22.04" compare alike. */
export const normalizeDistro = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const GUID_PS5 = '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}';
const GUID_CMD = '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}';

export interface WtDeps {
  /** Profiles Arctri already knows how to start (pwsh, powershell, cmd), keyed by id. */
  known: Map<string, ShellProfile>;
  gitBash: () => string | undefined;
}

export interface WtResult {
  /** Windows profiles, in Windows Terminal order. */
  windows: ShellProfile[];
  /** Lower-cased ids (including `wsl:<distro>`) in Windows Terminal order. */
  order: string[];
  defaultId?: string;
}

export function mapWtProfiles(wt: WtSettings, deps: WtDeps): WtResult {
  const windows: ShellProfile[] = [];
  const order: string[] = [];
  let defaultId: string | undefined;
  const add = (id: string, guid: string | undefined, p?: ShellProfile) => {
    if (order.includes(id.toLowerCase())) return;
    order.push(id.toLowerCase());
    if (p) windows.push(p);
    if (guid && guid === wt.defaultGuid) defaultId = id;
  };

  for (const p of wt.profiles) {
    if (p.hidden) continue;
    const cmdline = p.commandline ? splitCommandline(expandEnv(p.commandline)) : [];
    const exe = cmdline[0] ? baseName(cmdline[0]) : '';

    const wslDistro =
      p.source === 'Windows.Terminal.Wsl'
        ? p.name
        : exe === 'wsl.exe' || exe === 'wsl'
          ? cmdline[cmdline.findIndex((a) => a === '-d' || a === '--distribution') + 1]
          : undefined;
    if (wslDistro) {
      add(`wsl:${wslDistro}`, p.guid);
      continue;
    }
    // A distribution installed from the Store: `<Publisher>.<Distro>_<hash>`. The distribution it starts is only known
    // once WSL has listed them, so the registry resolves this `wslapp:` entry later.
    const appx = p.source && !p.source.startsWith('Windows.Terminal.') ? /^[^.]+\.(.+)_[a-z0-9]{13}$/i.exec(p.source) : null;
    if (appx) {
      add(`wslapp:${normalizeDistro(appx[1]!)}`, p.guid);
      continue;
    }
    if (p.source === 'Windows.Terminal.PowershellCore' || exe === 'pwsh.exe') {
      const k = deps.known.get('pwsh');
      if (k) add('pwsh', p.guid, k);
      continue;
    }
    if (p.guid === GUID_PS5 || exe === 'powershell.exe') {
      const k = deps.known.get('powershell');
      if (k) add('powershell', p.guid, k);
      continue;
    }
    if (p.guid === GUID_CMD || exe === 'cmd.exe') {
      const k = deps.known.get('cmd');
      if (k) add('cmd', p.guid, k);
      continue;
    }
    const label = p.name ?? p.guid ?? 'Shell';
    if (p.source === 'Git') {
      const bash = deps.gitBash();
      if (bash) {
        add('gitbash', p.guid, {
          id: 'gitbash', label, env: { kind: 'windows' }, shell: 'other', executable: bash, args: ['--login', '-i'], integration: 'none'
        });
      }
      continue;
    }
    if (cmdline.length > 0) {
      const id = `wt:${p.guid ?? label}`;
      add(id, p.guid, {
        id, label, env: { kind: 'windows' }, shell: 'other', executable: cmdline[0]!, args: cmdline.slice(1), integration: 'none'
      });
    }
  }
  return { windows, order, ...(defaultId ? { defaultId } : {}) };
}

function settingsFiles(): string[] {
  const local = process.env['LOCALAPPDATA'];
  if (!local) return [];
  return [
    join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    join(local, 'Microsoft', 'Windows Terminal', 'settings.json')
  ];
}

function findGitBash(): string | undefined {
  const dirs = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA'] && join(process.env['LOCALAPPDATA'], 'Programs')];
  for (const d of dirs) {
    if (!d) continue;
    const c = join(d, 'Git', 'bin', 'bash.exe');
    if (existsSync(c)) return c;
  }
  return undefined;
}

/** The profiles Windows Terminal shows, or undefined when it is not installed or its settings cannot be read. */
export function loadWindowsTerminalProfiles(base: ShellProfile[]): WtResult | undefined {
  for (const f of settingsFiles()) {
    if (!existsSync(f)) continue;
    try {
      const wt = parseWtSettings(readFileSync(f, 'utf8'));
      if (!wt) continue;
      const r = mapWtProfiles(wt, { known: new Map(base.map((p) => [p.id, p])), gitBash: findGitBash });
      if (r.order.length > 0) return r;
    } catch {
      /* try the next location */
    }
  }
  return undefined;
}
