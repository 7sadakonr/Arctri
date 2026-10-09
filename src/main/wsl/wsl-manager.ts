import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WslDistro, WslStatus } from '@shared/types/wsl';
import { decodeWslOutput, parseWslList } from './list-parser';

const wslExe = (): string => join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'wsl.exe');

function run(args: string[], timeoutMs: number): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve) => {
    execFile(
      wslExe(),
      args,
      { encoding: 'buffer', timeout: timeoutMs, windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

export class WslManager {
  private cache: { at: number; distros: WslDistro[]; status: WslStatus } | undefined;
  private posixCache = new Map<string, string>();

  /** Never starts a distribution; only lists them. */
  async refresh(): Promise<{ status: WslStatus; distros: WslDistro[] }> {
    // AGENTDOCK_FAKE_WSL lets tests exercise the "WSL is not installed" path on a machine that has it.
    if (process.env['AGENTDOCK_FAKE_WSL'] === 'missing' || process.platform !== 'win32' || !existsSync(wslExe())) {
      return this.store({ available: false, reason: 'not-installed' }, []);
    }
    const r = await run(['--list', '--verbose'], 15000);
    const text = decodeWslOutput(r.stdout);
    if (r.code !== 0) {
      const detail = (decodeWslOutput(r.stderr) || text).trim().slice(0, 300);
      const disabled = /not enabled|Virtual Machine Platform|WSL 2 requires/i.test(detail);
      return this.store({ available: false, reason: disabled ? 'disabled' : 'error', detail }, []);
    }
    const distros = parseWslList(text);
    if (distros.length === 0) return this.store({ available: false, reason: 'no-distros' }, []);
    const def = distros.find((d) => d.isDefault && !d.hidden)?.name ?? distros.find((d) => !d.hidden)?.name;
    return this.store(def ? { available: true, defaultDistro: def } : { available: true }, distros);
  }

  private store(status: WslStatus, distros: WslDistro[]) {
    this.cache = { at: Date.now(), distros, status };
    return { status, distros };
  }

  async status(refresh = false): Promise<WslStatus> {
    if (refresh || !this.cache) await this.refresh();
    return this.cache!.status;
  }

  async listDistros(refresh = false): Promise<WslDistro[]> {
    if (refresh || !this.cache) await this.refresh();
    return this.cache!.distros.filter((d) => !d.hidden);
  }

  async hasDistro(name: string): Promise<boolean> {
    return (await this.listDistros(true)).some((d) => d.name === name);
  }

  /** Windows path -> path inside the distro (honours custom automount roots). */
  async toPosix(distro: string, winPath: string): Promise<string | null> {
    const key = `${distro}\0${winPath}`;
    const hit = this.posixCache.get(key);
    if (hit) return hit;
    const r = await run(['-d', distro, '--exec', 'wslpath', '-u', winPath], 20000);
    const out = r.stdout.toString('utf8').trim();
    if (r.code !== 0 || !out.startsWith('/')) return null;
    this.posixCache.set(key, out);
    return out;
  }

  /** Executes a fixed argv inside a distro; used for non-interactive probes. */
  async exec(distro: string, argv: string[], timeoutMs = 8000): Promise<{ code: number; stdout: string }> {
    const r = await run(['-d', distro, '--exec', ...argv], timeoutMs);
    return { code: r.code, stdout: r.stdout.toString('utf8') };
  }
}

export const wslExePath = wslExe;
