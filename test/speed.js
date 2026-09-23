// velox :: speed.js (v2.3) — the speed features, measured end to end
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const EXE = process.env.VELOX_BROWSER || process.env.VLOX_EXE;
const site = await startSite();
const S = site.url;
const N = Number(process.argv[2] || 8);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (n) => `${n.toFixed(1)} ms`;
const out = [];
const row = (label, before, after, note = '') => {
  const mb = med(before), ma = med(after);
  const x = mb / Math.max(ma, 0.01);
  out.push([label, mb, ma, x]);
  console.log(`${x >= 1.05 ? '⚡' : ' '} ${label.padEnd(38)} before ${fmt(mb).padStart(9)}  |  v2.3 ${fmt(ma).padStart(9)}  |  ${x.toFixed(2)}×  ${note}`);
};

/* ── 1. page creation: cold vs the transparent spare ─────────────────────── */
{
  const before = [], after = [];
  for (let i = 0; i < N; i++) {
    const b = await velox.launch({ executablePath: EXE, spare: 0 });     // no spare: the old path
    let t = Date.now(); const p = await b.newPage({ capture: false }); before.push(Date.now() - t);
    await p.close(); await b.close();
  }
  for (let i = 0; i < N; i++) {
    const b = await velox.launch({ executablePath: EXE, spare: 2 });     // opt-in warm renderers
    await new Promise((r) => setTimeout(r, 80));                        // let them warm
    let t = Date.now(); const p = await b.newPage({ capture: false }); after.push(Date.now() - t);
    await p.close(); await b.close();
  }
  row('newPage() (spare: 2)', before, after, 'opt-in warm renderers');
}

/* ── 2. launch: cold vs prewarmed ────────────────────────────────────────── */
{
  const before = [], after = [];
  for (let i = 0; i < N; i++) { const t = Date.now(); const b = await velox.launch({ executablePath: EXE }); before.push(Date.now() - t); await b.close(); }
  for (let i = 0; i < N; i++) {
    await velox.prewarm({ browsers: 1, launch: {}, executablePath: EXE });
    const t = Date.now(); const b = await velox.launch({ executablePath: EXE }); after.push(Date.now() - t); await b.close();
  }
  row('launch() + first page handoff', before, after, 'velox.prewarm()');
}

/* ── 3. per-action round-trips ───────────────────────────────────────────── */
{
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage({ capture: false });
  await p.goto(S + '/', { waitUntil: 'interactive' });
  const seq = [], batched = [];
  for (let i = 0; i < N; i++) {
    let t = Date.now();
    await p.text('h1'); await p.count('a'); await p.attr('h1', 'id'); await p.exists('p');
    seq.push(Date.now() - t);
    t = Date.now();
    await p.batch([['text', 'h1'], ['count', 'a'], ['attr', 'h1', 'id'], ['exists', 'p']]);
    batched.push(Date.now() - t);
  }
  row('4 data actions', seq, batched, 'page.batch() one flush');
  await b.close();
}

/* ── 4. navigation shape ─────────────────────────────────────────────────── */
{
  const b = await velox.launch({ executablePath: EXE });
  const interactive = [], turbo = [];
  for (let i = 0; i < N; i++) {
    const p1 = await b.newPage({ capture: false });
    let t = Date.now(); await p1.goto(S + '/', { waitUntil: 'interactive' }); interactive.push(Date.now() - t); await p1.close();
    const p2 = await b.newPage({ capture: false });
    t = Date.now();
    await p2.goto(S + '/', { waitUntil: 'none' });
    await p2.waitForSelector('h1');
    turbo.push(Date.now() - t); await p2.close();
  }
  row('navigate + first paint + ready', interactive, turbo, 'waitUntil:"none" + waitForSelector');
  await b.close();
}

/* ── 5. screenshots ──────────────────────────────────────────────────────── */
{
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage({ capture: false });
  await p.goto(S + '/', { waitUntil: 'interactive' });
  const def = [], fast = [];
  for (let i = 0; i < N; i++) { let t = Date.now(); await p.screenshot(); def.push(Date.now() - t); }
  for (let i = 0; i < N; i++) { let t = Date.now(); await p.screenshot({ fast: true }); fast.push(Date.now() - t); }
  row('viewport screenshot', def, fast, 'fast:true');
  await b.close();
}

/* ── 6. browser-free scraping ────────────────────────────────────────────── */
{
  const urls = Array.from({ length: 24 }, (_, i) => `${S}/api/delay?ms=30&i=${i}`);
  const seq = [], par = [];
  for (let i = 0; i < 4; i++) {
    let t = Date.now();
    for (const u of urls) await velox.fetch(u);
    seq.push(Date.now() - t);
    t = Date.now();
    await velox.fetchAll(urls, { concurrency: 16 });
    par.push(Date.now() - t);
  }
  row('24 latency-bound pages', seq, par, 'fetchAll(), no browser');

  const cached = [];
  for (let i = 0; i < 4; i++) {
    const cache = velox.createCache();
    let t = Date.now();
    const u = `${S}/index.html`;
    await velox.fetch(u, { cache });
    await velox.fetch(u, { cache });
    cached.push(Date.now() - t);
  }
  const fresh = [];
  for (let i = 0; i < 4; i++) {
    let t = Date.now();
    await velox.fetch(`${S}/index.html`);
    await velox.fetch(`${S}/index.html`);
    fresh.push(Date.now() - t);
  }
  row('2× fetch same page', fresh, cached, 'ETag → 304 from cache');
}

/* ── 7. whole workflow: 12 pages, page-per-scrape ────────────────────────── */
{
  const slow = [];
  const b1 = await velox.launch({ executablePath: EXE, spare: 0 });
  for (let i = 0; i < 12; i++) {
    const t = Date.now();
    const p = await b1.newPage({ capture: false });
    await p.goto(`${S}/page2.html`, { waitUntil: 'none' });
    await p.waitForSelector('h1');
    const title = await p.text('h1');
    await p.close();
    slow.push(Date.now() - t);
  }
  await b1.close();
  const fast = [];
  const b2 = await velox.launch({ executablePath: EXE, spare: 2 });
  for (let i = 0; i < 12; i++) {
    const t = Date.now();
    const p = await b2.newPage({ capture: false });
    await p.goto(`${S}/page2.html`, { waitUntil: 'none' });
    await p.waitForSelector('h1');
    const title = await p.text('h1');
    await p.close();
    fast.push(Date.now() - t);
  }
  await b2.close();
  row('12 pages: open→navigate→read', slow, fast, 'warm renderers (opt-in)');
}

await site.server.close();
console.log('\nsummary:');
for (const [l, b, a, x] of out) console.log(`  ${l.padEnd(38)} ${x.toFixed(2)}×  (${b.toFixed(0)} → ${a.toFixed(0)} ms)`);
process.exit(0);
