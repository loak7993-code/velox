// velox :: bench — head-to-head vs playwright-core on the SAME browser binary.
// node test/bench.js [iterations]
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const EXE = process.env.VLOX_EXE || '/tmp/opencode/velox/.browsers/chrome-headless-shell-linux64/chrome-headless-shell';
const { chromium } = await import('playwright-core').catch(() => ({ chromium: null }));

const site = await startSite();
const SITE = site.url;
const N = Number(process.argv[2] || 8);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const fmt = (ms) => `${median(ms).toFixed(1)}ms`.padStart(9) + ` (p95 ${p95(ms).toFixed(1)})`;

/* ---------------------------------------------- scenarios ---------------------------------------------- */

async function veloxScenario() {
  const t = {};
  let t0 = Date.now();
  const b = await velox.launch({ executablePath: EXE, headless: true });
  t.launch = Date.now() - t0;

  const p = await b.newPage();

  t0 = Date.now();
  await p.goto(SITE, { waitUntil: 'interactive' });
  t.goto = Date.now() - t0;

  t0 = Date.now();
  for (let i = 0; i < 10; i++) await p.title();
  t.title10 = Date.now() - t0;

  t0 = Date.now();
  const items = await p.extract('li.item', { text: true, attrs: ['class'] });
  t.extract = Date.now() - t0;

  t0 = Date.now();
  await p.type('#user', 'benchmark', { delay: 0 });
  await p.fill('#pass', 'pw');
  await p.click('#go');
  await p.waitForFunction(`document.title.startsWith('submitted:')`, { timeout: 3000 });
  t.formFlow = Date.now() - t0;

  t0 = Date.now();
  await p.waitForSelector('#late', { timeout: 4000 });
  t.waitLate = Date.now() - t0;

  t0 = Date.now();
  const shot = await p.screenshot({ full: true });
  t.shotFull = Date.now() - t0;
  if (shot.length < 3000) throw new Error('bad screenshot');

  t0 = Date.now();
  await p.goto(`${SITE}/page2.html`, { waitUntil: 'interactive' });
  await p.text('h1');
  t.nav2 = Date.now() - t0;

  t0 = Date.now();
  await b.close();
  t.close = Date.now() - t0;
  return t;
}

async function playwrightScenario() {
  const t = {};
  let t0 = Date.now();
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  t.launch = Date.now() - t0;

  const p = await b.newPage();

  t0 = Date.now();
  await p.goto(SITE, { waitUntil: 'domcontentloaded' });
  t.goto = Date.now() - t0;

  t0 = Date.now();
  for (let i = 0; i < 10; i++) await p.title();
  t.title10 = Date.now() - t0;

  t0 = Date.now();
  const items = await p.$$eval('li.item', (els) => els.map((el) => ({ text: el.textContent.trim(), class: el.className })));
  t.extract = Date.now() - t0;

  t0 = Date.now();
  await p.fill('#user', 'benchmark');
  await p.fill('#pass', 'pw');
  await p.click('#go');
  await p.waitForFunction(() => document.title.startsWith('submitted:'), null, { timeout: 3000 });
  t.formFlow = Date.now() - t0;

  t0 = Date.now();
  await p.waitForSelector('#late', { timeout: 4000 });
  t.waitLate = Date.now() - t0;

  t0 = Date.now();
  const shot = await p.screenshot({ fullPage: true });
  t.shotFull = Date.now() - t0;
  if (shot.length < 3000) throw new Error('bad screenshot');

  t0 = Date.now();
  await p.goto(`${SITE}/page2.html`, { waitUntil: 'domcontentloaded' });
  await p.textContent('h1');
  t.nav2 = Date.now() - t0;

  t0 = Date.now();
  await b.close();
  t.close = Date.now() - t0;
  return t;
}

/** lite engine: same page, zero browser */
async function liteScenario() {
  const t = {};
  let t0 = Date.now();
  const res = await velox.fetch(SITE);
  t.fetch = Date.now() - t0;
  t0 = Date.now();
  const items = res.doc.selectAll('li.item').map((n) => ({ text: n.textContent(), class: n.attrs.class }));
  t.extract = Date.now() - t0;
  if (items.length !== 3) throw new Error('bad extract');
  return t;
}

/* ------------------------------------------------- run ------------------------------------------------- */

const keys = ['launch', 'goto', 'title10', 'extract', 'formFlow', 'waitLate', 'shotFull', 'nav2', 'close'];
const runs = { velox: {}, playwright: {}, lite: {} };
for (const k of keys.concat(['fetch'])) runs.velox[k] = [], runs.playwright[k] = [], runs.lite[k] = [];

// warmups
await veloxScenario().catch((e) => console.error('velox warmup:', e.message));
if (chromium) await playwrightScenario().catch((e) => console.error('pw warmup:', e.message));

for (let i = 0; i < N; i++) {
  const v = await veloxScenario();
  for (const k of keys) runs.velox[k].push(v[k]);
  if (chromium) {
    const w = await playwrightScenario();
    for (const k of keys) runs.playwright[k].push(w[k]);
  }
  const l = await liteScenario();
  runs.lite.fetch.push(l.fetch); runs.lite.extract.push(l.extract);
}

console.log(`\nvelox vs playwright-core — same binary, ${N} runs each (median / p95, ms)`);
console.log('─'.repeat(78));
const label = { launch: 'browser launch', goto: 'goto + DOMContentLoaded', title10: '10× title()', extract: 'batch extract (3 els)', formFlow: 'fill + click + submit', waitLate: 'waitForSelector (700ms delay)', shotFull: 'full-page screenshot', nav2: 'second navigation', close: 'browser close', fetch: 'full page fetch (no browser)' };
for (const k of keys) {
  const v = runs.velox[k], w = runs.playwright[k];
  if (!w.length) continue;
  const speedup = median(w) / median(v);
  const flag = speedup >= 1.05 ? '⚡' : speedup <= 0.95 ? ' ' : '=';
  console.log(`${flag} ${label[k].padEnd(31)} velox ${fmt(v)}  |  playwright ${fmt(w)}  |  ${speedup.toFixed(2)}×`);
}
console.log('─'.repeat(78));
console.log(`🚀 lite engine (no browser):  page fetch ${fmt(runs.lite.fetch)}   batch extract ${fmt(runs.lite.extract)}`);
console.log(`   → the lite path skips the browser entirely; auto mode uses it whenever a page doesn't need JS`);

site.server.close();
process.exit(0);
