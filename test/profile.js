// velox :: profile.js — where does the time actually go?
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const EXE = process.env.VELOX_BROWSER;
const site = await startSite();
const S = site.url;
const N = Number(process.argv[2] || 20);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const row = (label, ms, note = '') => console.log(`  ${label.padEnd(42)} ${ms.toFixed(1).padStart(8)} ms  ${note}`);

console.log('── launch ────────────────────────────────────────────────');
{
  const plain = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); const b = await velox.launch({ executablePath: EXE }); plain.push(Date.now() - t); await b.close(); }
  row('launch (current flags)', med(plain));
  const gpu = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); const b = await velox.launch({ executablePath: EXE, args: ['--disable-gpu'] }); gpu.push(Date.now() - t); await b.close(); }
  row('launch (+ --disable-gpu)', med(gpu));
}

console.log('\n── page creation ─────────────────────────────────────────');
const b = await velox.launch({ executablePath: EXE });
{
  const t1 = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); const p = await b.newPage(); t1.push(Date.now() - t); await p.close(); }
  row('newPage()', med(t1));
  const t2 = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); const p = await b.newPage({ capture: false }); t2.push(Date.now() - t); await p.close(); }
  row('newPage({ capture: false })', med(t2));
}

console.log('\n── per-command round-trip ────────────────────────────────');
{
  const p = await b.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.eval('1');                                  // warm
  const t = Date.now();
  const K = 300;
  for (let i = 0; i < K; i++) await p.eval('1');
  row(`${K}× eval round-trips`, Date.now() - t, `${((Date.now() - t) / K).toFixed(2)} ms each`);
  const t2 = Date.now();
  for (let i = 0; i < K; i++) await p.text('h1');
  row(`${K}× page.text('h1')`, Date.now() - t2, `${((Date.now() - t2) / K).toFixed(2)} ms each`);
  const t3 = Date.now();
  for (let i = 0; i < K; i++) await p.batch([['text', 'h1'], ['count', 'a'], ['attr', 'h1', 'id']]);
  row(`${K}× batch(3 ops)`, Date.now() - t3, `${((Date.now() - t3) / K).toFixed(2)} ms each`);
  const t4 = Date.now();
  for (let i = 0; i < K; i++) await p.batch([['text', 'h1'], ['count', 'a'], ['attr', 'h1', 'id']], { concurrency: 1 });
  row(`${K}× batch(3 ops, serial)`, Date.now() - t4, `${((Date.now() - t4) / K).toFixed(2)} ms each`);
  await p.close();
}

console.log('\n── navigation ────────────────────────────────────────────');
{
  const a = [];
  for (let i = 0; i < N; i++) {
    const p = await b.newPage({ capture: false });
    let t = Date.now(); await p.goto(`${S}/`, { waitUntil: 'interactive' }); a.push(Date.now() - t); await p.close();
  }
  row('goto interactive', med(a));
  const c = [];
  for (let i = 0; i < N; i++) {
    const p = await b.newPage({ capture: false });
    let t = Date.now(); await p.goto(`${S}/`, { waitUntil: 'none' }); c.push(Date.now() - t); await p.close();
  }
  row('goto none', med(c));
  const d = [];
  for (let i = 0; i < N; i++) {
    const p = await b.newPage({ capture: false });
    let t = Date.now(); await p.goto(`${S}/`, { waitUntil: 'none' }); await p.waitForSelector('h1'); d.push(Date.now() - t); await p.close();
  }
  row('goto none + waitForSelector(h1)', med(d));
  const e = [];
  for (let i = 0; i < N; i++) {
    const p = await b.newPage({ capture: false });
    let t = Date.now(); await p.goto(`${S}/`, { waitUntil: 'load' }); e.push(Date.now() - t); await p.close();
  }
  row('goto load', med(e));
}

console.log('\n── screenshots ───────────────────────────────────────────');
{
  const p = await b.newPage({ capture: false });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const a = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); await p.screenshot(); a.push(Date.now() - t); }
  row('screenshot viewport (default)', med(a));
  const c = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); await p.screenshot({ fast: true }); c.push(Date.now() - t); }
  row('screenshot viewport (fast/optimizeForSpeed)', med(c));
  const d = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); await p.screenshot({ full: true }); d.push(Date.now() - t); }
  row('screenshot full page', med(d));
  await p.close();
}

console.log('\n── lite engine ───────────────────────────────────────────');
{
  const urls = Array.from({ length: 20 }, (_, i) => `${S}/page2.html?i=${i}`);
  const a = [];
  for (let i = 0; i < 5; i++) { const t = Date.now(); await velox.fetchAll(urls, { concurrency: 8 }); a.push(Date.now() - t); }
  row('fetchAll 20 (concurrency 8)', med(a));
  const c = [];
  for (let i = 0; i < 5; i++) { const t = Date.now(); await velox.fetchAll(urls, { concurrency: 20 }); c.push(Date.now() - t); }
  row('fetchAll 20 (concurrency 20)', med(c));
  const d = [];
  for (let i = 0; i < 5; i++) {
    const cache = velox.createCache({ ttl: 60000 });
    const t = Date.now();
    await velox.fetch(urls[0], { cache });
    await velox.fetch(urls[0], { cache });
    d.push(Date.now() - t);
  }
  row('fetch 2× with ttl cache', med(d));
}

await b.close();
site.server.close();
process.exit(0);
