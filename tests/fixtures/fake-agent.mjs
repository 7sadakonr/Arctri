// A minimal full-screen terminal program used in place of a real AI agent in automated tests.
// It behaves like a TUI: alternate screen, raw input, bracketed paste, resize redraws, Esc and Ctrl+C.
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('fake-agent 9.9.9');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log(`fake-agent

Commands:
  resume            Resume a previous interactive session

Options:
  -m, --model <MODEL>
  -a, --ask-for-approval <APPROVAL_POLICY>
      Possible values: untrusted, on-request, on-failure, never
`);
  process.exit(0);
}

const out = (s) => process.stdout.write(s);
const notifyAfter = args.indexOf('--notify-after');
if (notifyAfter >= 0) setTimeout(() => out('\x1b]9;fake-agent needs your attention\x07'), Number(args[notifyAfter + 1] ?? 3) * 1000);
let typed = '';
let pasted = '';
let note = '';
const draw = () => {
  out('\x1b[H\x1b[2J');
  out(`FAKE-AGENT ready args=[${args.join(' ')}] size=${process.stdout.columns}x${process.stdout.rows}\r\n`);
  out(`approval> Allow command? (y/n)\r\n`);
  out(`input: ${typed}\r\n`);
  out(`paste: ${pasted}\r\n`);
  out(`note: ${note}\r\n`);
};
out('\x1b[?1049h\x1b[?2004h');
draw();
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdout.on('resize', draw);
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (;;) {
    const s = buf.indexOf('\x1b[200~');
    if (s === -1) break;
    const e = buf.indexOf('\x1b[201~', s);
    if (e === -1) return;
    pasted = buf.slice(s + 6, e).replace(/\r|\n/g, '⏎');
    buf = buf.slice(0, s) + buf.slice(e + 6);
  }
  for (const ch of buf) {
    if (ch === '\x03') {
      out('\x1b[?2004l\x1b[?1049l');
      process.exit(130);
    } else if (ch === '#') out('\x1b]9;fake-agent needs your attention\x07');
    else if (ch === '\x1b') note = 'esc';
    else if (ch === '\r') {
      note = `submitted:${typed}`;
      typed = '';
    } else if (ch === '\x7f') typed = [...typed].slice(0, -1).join('');
    else if (ch >= ' ') typed += ch;
  }
  buf = buf.endsWith('\x1b') ? '\x1b' : '';
  draw();
});
