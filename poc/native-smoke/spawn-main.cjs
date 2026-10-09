const { app } = require('electron');
const { Worker } = require('node:worker_threads');
app.whenReady().then(async () => {
  let last = performance.now(), maxGap = 0;
  const beat = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 20);
  const w = new Worker(__dirname + '/worker.cjs');
  const results = [];
  w.on('message', (m) => { if (m.spawned !== undefined) results.push(`spawn #${m.spawned} took ${m.ms} ms in the worker`); });
  w.postMessage({ n: 1 });
  w.postMessage({ n: 2 });
  w.postMessage({ n: 3 });
  await new Promise((r) => setTimeout(r, 14000));
  clearInterval(beat);
  console.log('RESULT ' + results.join(' | ') + ` | main thread longest stall: ${maxGap.toFixed(0)} ms`);
  app.exit(0);
});
