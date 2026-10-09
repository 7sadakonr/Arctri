// Smoke test: load native modules inside the real Electron runtime.
const { app } = require('electron');
app.whenReady().then(() => {
  const out = { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules };
  try {
    const pty = require('node-pty');
    out.nodePty = typeof pty.spawn;
    const p = pty.spawn('cmd.exe', ['/c', 'echo pty-ok'], { cols: 80, rows: 24 });
    let data = '';
    p.onData((d) => (data += d));
    p.onExit(() => {
      out.ptyOutput = data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
      try {
        const Database = require('better-sqlite3');
        const db = new Database(':memory:');
        out.sqlite = db.prepare('select sqlite_version() v').get().v;
        db.close();
      } catch (e) { out.sqliteError = String(e); }
      console.log('RESULT ' + JSON.stringify(out));
      app.quit();
    });
  } catch (e) { out.error = String(e); console.log('RESULT ' + JSON.stringify(out)); app.quit(); }
});
