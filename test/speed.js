// velox :: speed.js — micro-benchmarks for the v2.1 speed work
import velox from '../src/index.js';
import { startSite } from './site/serve.js';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/?$/, '/');
const DEFAULT_EXE = ROOT + '.browsers/chrome-headless-shell-linux64/chrome-headless-shell';


const EXE = process.env.VELOX_BROWSER;
const site = await startSite();
const S = site.url;
const N = Number(process.argv[2] || 5);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (a) => `${med(a).toFixed(1)}ms`;
const results = [];
const row = (name, seq, fast, note = '') => {
  const speedup = med(seq) / med(fast);
  results.push([name, med(seq), med(fast), speedup]);
  console.log(`${speedup >= 1.05 ? '⚡' : ' '} ${name.padEnd(34)} sequential ${fmt(seq).padStart(8)}  |  velox ${fmt(fast).padStart(8)}  |  ${speedup.toFixed(2)}×  ${note}`);
};

const b = await velox.launch({ executablePath: EXE });

/* ── 1. batch(): independent actions over one flush ─────────────────────────── */
{
  const seq = [], fast = [];
  for (let i = 0; i < N; i++) {
    let p = await b.newPage();
    await p.setContent('<input id=a><input id=b><input id=c><h1>H</h1><p class=x>1</p><p class=x>2</p>');
    let t0 = Date.now();
    await p.fill('#a', '1'); await p.fill('#b', '2'); await p.fill('#c', '3'); await p.text('h1'); await p.count('p.x');
    seq.push(Date.now() - t0);
    t0 = Date.now();
    await p.batch([['fill', '#a', '1'], ['fill', '#b', '2'], ['fill', '#c', '3'], ['text', 'h1'], ['count', 'p.x']]);
    fast.push(Date.now() - t0);
    await p.close();
  }
  row('5 independent actions (batch)', seq, fast, 'one pipelined flush');
}

/* ── 2. warm(): pre-parsed selectors in the page ───────────────────────────── */
{
  const body = Array.from({ length: 400 }, (_, i) => `<div class="card c${i % 7}"><span class=t>item ${i}</span></div>`).join('');
  const cold = [], warm = [];
  for (let i = 0; i < N; i++) {
    let p = await b.newPage({ capture: false });
    await p.setContent(body);
    let t0 = Date.now();
    await p.eval(`(function(){for(var i=0;i<200;i++){__vlx.match('.card.c3 >> .t');__vlx.match('div.card:visible');__vlx.extract('span.t',{text:true,limit:50})}return 1})()`);
    cold.push(Date.now() - t0);
    await p.warm(['.card.c3 >> .t', 'div.card:visible', 'span.t']);
    t0 = Date.now();
    await p.eval(`(function(){for(var i=0;i<200;i++){__vlx.match('.card.c3 >> .t');__vlx.match('div.card:visible');__vlx.extract('span.t',{text:true,limit:50})}return 1})()`);
    warm.push(Date.now() - t0);
    await p.close();
  }
  row('200× selector parse+cache (in-page)', cold, warm, 'warm()/parse cache');
}

/* ── 3. capture:false — lighter page + navigation ──────────────────────────── */
{
  const on = [], off = [];
  for (let i = 0; i < N; i++) {
    let t0 = Date.now();
    let p = await b.newPage();
    await p.goto(S + '/heavy.html', { waitUntil: 'interactive' });
    on.push(Date.now() - t0); await p.close();
    t0 = Date.now();
    p = await b.newPage({ capture: false });
    await p.goto(S + '/heavy.html', { waitUntil: 'interactive' });
    off.push(Date.now() - t0); await p.close();
  }
  row('page create + goto (capture off)', on, off, 'no Network domain');
}

/* ── 4. fetchAll(): parallel lite fetches, no browser ──────────────────────── */
{
  const urls = Array.from({ length: 24 }, (_, i) => `${S}/api/delay?ms=40&i=${i}`);
  const seq = [], par = [];
  for (let i = 0; i < N; i++) {
    let t0 = Date.now();
    for (const u of urls) await velox.fetch(u);
    seq.push(Date.now() - t0);
    t0 = Date.now();
    await velox.fetchAll(urls, { concurrency: 12 });
    par.push(Date.now() - t0);
  }
  row('24 lite fetches', seq, par, 'fetchAll() keep-alive');
}

await b.close();
site.server.close();
console.log('\n' + results.map(([n, a, b_, s]) => `${n.padEnd(34)} ${s.toFixed(2)}×`).join('\n'));
process.exit(0);
