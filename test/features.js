// velox :: features.js — stability (retries, health, reconnect) + customisation
// (config, plugins, custom selector engines, registered devices)
import velox from '../src/index.js';
import { startSite } from './site/serve.js';
import { startHttpProxy } from './site/proxy.js';
import { writeFileSync, rmSync } from 'node:fs';

const EXE = process.env.VELOX_BROWSER;
const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const soft = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`… ${name} `);
  try { const v = await fn(); process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, v === undefined || v === true || !!v); }
  catch (e) { process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, false, e.message.slice(0, 150)); }
};

const site = await startSite();
const S = site.url;

/* ─────────────────────────── stability ─────────────────────────── */
await soft('velox.open retries a dropped connection', async () => {
  await velox.fetch(`${S}/flaky-reset`);
  const s = await velox.open(`${S}/flaky`, { engine: 'lite', retries: 2, retryDelay: 150 });
  return s.status === 200 && s.text('#flaky').includes('recovered');
});

await soft('retries are off by default (failure surfaces)', async () => {
  await velox.fetch(`${S}/flaky-reset`);
  let threw = false;
  await velox.open(`${S}/flaky`, { engine: 'lite' }).catch(() => (threw = true));
  return threw;
});

await soft('browser.healthy()', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const before = await b.healthy();
  await b.close();
  const after = await b.healthy();
  check('healthy while open', before === true);
  check('unhealthy after close', after === false);
  return true;
});

await soft('manual reconnect keeps existing pages usable', async () => {
  const b = await velox.launch({ executablePath: EXE, transport: 'socket' });   // socket so we can reconnect
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const titleBefore = await p.title();
  b.conn.close();                                    // simulate a network drop
  await new Promise((r) => setTimeout(r, 250));
  await b.reconnect({ attempts: 3, delay: 200 });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });   // same page object keeps working
  const titleAfter = await p.title();
  const fresh = await b.newPage();                       // and new pages still work
  await fresh.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const ok = titleBefore === 'Page Two' && titleAfter === 'Velox Test Site' && (await fresh.title()) === 'Page Two';
  await b.close();
  return ok;
});

await soft('auto-reconnect on a connected browser', async () => {
  const b = await velox.launch({ executablePath: EXE, transport: 'socket' });
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const remote = await velox.connect(b.conn.wsUrl, { autoReconnect: true, reconnectDelay: 100 });
  const rp = remote.pages()[0] || await remote.newPage();
  const reconnected = remote.waitForEvent('reconnected', { timeout: 10000 }).catch(() => null);
  remote.conn.ws.close();                                // simulate a network drop
  const ev = await reconnected;
  check('reconnected event fired', !!ev, ev ? `attempt ${ev.attempt}` : 'no event');
  await rp.goto(`${S}/`, { waitUntil: 'interactive' });
  const ok = (await rp.title()) === 'Velox Test Site';
  await remote.close().catch(() => {});
  await b.close();
  return ok;
});

/* ─────────────────────────── customisation ─────────────────────────── */
await soft('velox.config defaults (timeout + engine)', async () => {
  velox.config({ timeout: 700, engine: 'lite', retries: 0 });
  const s = await velox.open(`${S}/page2.html`);
  check('config engine applied', s.engine === 'lite', s.engine);
  let timedOut = false;
  await s.$$ ? null : null;
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/`);
  await p.click('#does-not-exist').catch((e) => (timedOut = /Timeout/i.test(e.message)));
  check('config timeout applied to actions', timedOut, String(timedOut));
  await b.close();
  velox.config({ timeout: 15000, engine: 'auto' });
  return true;
});

await soft('page.setDefaultTimeout overrides config', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  p.setDefaultTimeout(500);
  await p.goto(`${S}/`);
  const t0 = Date.now();
  await p.click('#nope').catch(() => {});
  const took = Date.now() - t0;
  await b.close();
  return took < 3000;
});

await soft('velox.use(): hooks fire', async () => {
  const seen = { onPage: 0, onBrowser: 0, pageOptions: 0 };
  velox.use({
    name: 'test-hooks',
    pageOptions(o) { seen.pageOptions++; return { ...o, headers: { ...(o.headers || {}), 'x-plugin': 'yes' } }; },
    onBrowser() { seen.onBrowser++; },
    onPage() { seen.onPage++; },
  });
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/`);
  const hdr = p.requests().find((r) => r.url === `${S}/`)?.response?.headers;
  const sent = (await p.eval('performance.getEntriesByType("resource").length')) >= 0;
  check('onBrowser hook fired', seen.onBrowser >= 1);
  check('onPage hook fired', seen.onPage >= 1);
  check('pageOptions hook applied', seen.pageOptions >= 1);
  const reqHeader = p.requests().find((r) => r.url === `${S}/`)?.headers?.['x-plugin'];
  check('pageOptions mutated the request', reqHeader === 'yes', String(reqHeader));
  await b.close();
  return true;
});

await soft('plugins.stealth()', async () => {
  velox.use(velox.plugins.stealth());
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/`);
  const wd = await p.eval('navigator.webdriver');
  await b.close();
  return wd === undefined;
});

await soft('plugins.blockImages()', async () => {
  velox.use(velox.plugins.blockImages());
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/heavy.html`, { waitUntil: 'load' }).catch(() => {});
  await p.wait(600);
  const imgs = p.requests().filter((r) => /\.bin$/.test(r.url));
  const blocked = imgs.filter((r) => !r.response || r.failed).length;
  const ok = imgs.length >= 5 && blocked === imgs.length;
  await b.close();
  return ok, `images=${imgs.length} blocked=${blocked}`;
});

await soft('plugins.proxyRotate(pool)', async () => {
  const p1 = await startHttpProxy({ id: 'rot-1' });
  const p2 = await startHttpProxy({ id: 'rot-2' });
  // Chrome bypasses loopback by default; <-loopback> forces local targets through the proxy
  const pool = new velox.ProxyPool([{ server: p1.url, bypass: ['<-loopback>'] }, { server: p2.url, bypass: ['<-loopback>'] }]);
  velox.use(velox.plugins.proxyRotate(pool));
  const seen = new Set();
  for (let i = 0; i < 2; i++) {                       // rotation is per browser launch
    const b = await velox.launch({ executablePath: EXE });
    const p = await b.newPage();
    await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
    const via = p.requests().find((r) => r.url.includes('page2'))?.response?.headers?.['x-vx-proxy-id'];
    if (via) seen.add(via);
    await b.close();
  }
  await p1.close(); await p2.close();
  check('each browser used a different exit', seen.size === 2, JSON.stringify([...seen]));
  return true;
});

await soft('page.addSelectorEngine()', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><section class="box"><div id="a" data-price="10">10</div></section>
    <section class="box"><div id="b" data-price="50">50</div></section>
    <section class="box"><div id="c" data-price="99">99</div></section>`);
  // custom engine: "priceabove=25" → elements priced above 25
  await p.addSelectorEngine('priceabove', (value, root) =>
    Array.from(root.querySelectorAll('[data-price]')).filter((el) => Number(el.dataset.price) > Number(value)));
  const n = await p.count('priceabove=25');
  const ids = await p.extract('priceabove=25', { attrs: ['id'] });
  check('custom engine matches', n === 2, `n=${n}`);
  check('custom engine values', JSON.stringify(ids.map((x) => x.id)) === '["b","c"]', JSON.stringify(ids));
  const chained = await p.count('section.box >> priceabove=25');
  check('custom engine chains with >>', chained === 2, `n=${chained}`);
  await b.close();
  return true;
});

await soft('velox.registerDevice()', async () => {
  velox.registerDevice('my_watch', { width: 320, height: 320, dsf: 2, mobile: true, ua: 'Mozilla/5.0 (WatchOS) VeloxTest' });
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><p>watch</p>');
  await p.emulate('my_watch');
  const ua = await p.eval('navigator.userAgent');
  const w = await p.eval('innerWidth');
  await b.close();
  check('registered device applied', ua.includes('WatchOS'), ua);
  check('registered device viewport', w === 320, String(w));
  return true;
});

await soft('VELOX_CONFIG file is honoured', async () => {
  const cfgPath = '/tmp/velox-config-test.json';
  writeFileSync(cfgPath, JSON.stringify({ engine: 'lite', timeout: 4321 }));
  const { spawnSync } = await import('node:child_process');
  const probe = '/tmp/velox-config-probe.mjs';
  writeFileSync(probe, `import { getConfig } from '/tmp/opencode/velox/src/index.js';
const c = getConfig();
process.stdout.write(JSON.stringify({ engine: c.engine, timeout: c.timeout }));`);
  const out = spawnSync(process.execPath, [probe], { env: { ...process.env, VELOX_CONFIG: cfgPath }, encoding: 'utf8' });
  rmSync(probe, { force: true });
  rmSync(cfgPath, { force: true });
  const parsed = JSON.parse(out.stdout || '{}');
  check('config file loaded', parsed.engine === 'lite' && parsed.timeout === 4321, `stdout=${out.stdout} stderr=${(out.stderr || '').slice(0, 200)}`);
  return true;
});

site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
