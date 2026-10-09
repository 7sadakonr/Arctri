// PoC-1: do OSC sequences survive ConPTY intact and in order?
// Usage: node poc/conpty-osc.mjs
import pty from 'node-pty';

const ESC = '\x1b';
const N = 300;

const shells = {
  powershell: {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-Command',
      `$e=[char]27;$b=[char]7;1..${N}|%{[Console]::Out.Write("$e]6973;seq=$_$b"); Write-Output "line $_"; if($_ % 50 -eq 0){[Console]::Out.Write("$e]133;D;0$b")}}`],
  },
  pwsh: {
    file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: ['-NoLogo', '-NoProfile', '-Command',
      `1..${N}|%{[Console]::Out.Write("\`e]6973;seq=$_\`a"); Write-Output "line $_"; if($_ % 50 -eq 0){[Console]::Out.Write("\`e]133;D;0\`a")}}`],
  },
  'wsl-bash': {
    file: 'wsl.exe',
    args: ['-d', 'Ubuntu', '--', 'bash', '/mnt/d/Desktop/Arctri/poc/wsl-osc.sh'],
  },
};

function run(name, conptyDll) {
  const { file, args } = shells[name];
  return new Promise((resolve) => {
    let buf = '';
    let p;
    try {
      p = pty.spawn(file, args, { cols: 120, rows: 30, useConptyDll: conptyDll });
    } catch (e) { return resolve({ name, conptyDll, error: String(e) }); }
    const t = setTimeout(() => { try { p.kill(); } catch {} }, 20000);
    p.onData((d) => (buf += d));
    p.onExit(() => {
      clearTimeout(t);
      // events in stream order: seq markers and "line N" text
      const events = [];
      const re = new RegExp(`${ESC}\\]6973;seq=(\\d+)(?:\\x07|${ESC}\\\\)|line (\\d+)|${ESC}\\]133;D;(\\d+)(?:\\x07|${ESC}\\\\)`, 'g');
      let m;
      while ((m = re.exec(buf))) {
        if (m[1]) events.push(['s', +m[1]]);
        else if (m[2]) events.push(['l', +m[2]]);
        else events.push(['d', +m[3]]);
      }
      const seqs = events.filter((e) => e[0] === 's').map((e) => e[1]);
      const lines = events.filter((e) => e[0] === 'l').map((e) => e[1]);
      const ds = events.filter((e) => e[0] === 'd').length;
      // ordering: marker N must come before "line N" and after "line N-1"
      let misordered = 0;
      let lastLine = 0;
      for (const [k, v] of events) {
        if (k === 'l') lastLine = v;
        if (k === 's' && v - 1 !== lastLine) misordered++;
      }
      resolve({ name, conptyDll, bytes: buf.length, seqFound: seqs.length, linesFound: lines.length,
        d133Found: ds, misordered });
    });
  });
}

const only = process.argv[2];
for (const name of Object.keys(shells)) {
  if (only && only !== name) continue;
  for (const dll of [false, true]) {
    const r = await run(name, dll);
    const ok = !r.error && r.seqFound === N && r.d133Found === N / 50 && r.misordered === 0;
    console.log((ok ? 'PASS ' : 'FAIL ') + JSON.stringify(r));
  }
}
