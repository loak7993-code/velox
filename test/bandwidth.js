// velox :: bandwidth.js (test) — measure and verify the byte savings
import velox from '../src/index.js';
import { startSite, siteStats } from './site/serve.js';

const EXE = process.env.VELOX_BROWSER || process.env.VLOX_EXE;
const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const soft = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`… ${name} `);
  try { const v = await fn(); process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, v === undefined || v === true || !!v); }
  catch (e) { process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, false, e.message.slice(0, 160)); }
};

const site = await startSite();
const S = site.url;
const F = velox.fmtBytes;

/* ── browser profiles: measure real transferred bytes ─────────────────────── */
async function measure(profile) {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage({ bandwidth: profile });
  await p.goto(`${S}/heavy.html`, { waitUntil: 'load' }).catch(() => {});
  await p.wait(700);
  const t = p.transferred();
  await b.close();
  return t;
}

const full = await measure('full');
const lean = await measure('lean');
const minimal = await measure('minimal');
const textOnly = await measure('text-only');

console.log('\nbandwidth profile        transferred   blocked reqs   vs full');
for (const [name, t] of [['full', full], ['lean', lean], ['minimal', minimal], ['text-only', textOnly]]) {
  const saved = full.total ? (1 - t.total / full.total) * 100 : 0;
  console.log(`  ${name.padEnd(20)} ${F(t.total).padStart(9)}   ${String(Object.values(t.blocked || {}).reduce((a, b) => a + b, 0)).padStart(10)}   ${name === 'full' ? '—' : saved.toFixed(0) + '% less'}`);
}

await soft('lean blocks images/fonts/media', async () => {
  check('lean transferred less than full', lean.total < full.total, `${F(lean.total)} vs ${F(full.total)}`);
  return Object.keys(lean.blocked).some((k) => k.startsWith('type:Image'));
});
await soft('minimal blocks harder than lean', async () => {
  check('minimal ≤ lean', minimal.total <= lean.total, `${F(minimal.total)} vs ${F(lean.total)}`);
  return true;
});
await soft('text-only is the cheapest profile', async () => {
  check('text-only < minimal', textOnly.total <= minimal.total, `${F(textOnly.total)} vs ${F(minimal.total)}`);
  check('text-only cut at least 90%', textOnly.total <= full.total * 0.1, `${F(textOnly.total)} vs ${F(full.total)}`);
  return true;
});
await soft('blockThirdParty drops off-site requests', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage({ bandwidth: { block: [], blockThirdParty: true } });
  const blocked = [];
  p.on('blocked', (e) => blocked.push(e));
  await p.goto(`${S}/heavy.html`, { waitUntil: 'load' }).catch(() => {});
  await p.wait(500);
  const third = blocked.filter((x) => x.reason.startsWith('third-party'));
  check('third-party request blocked', third.length >= 1, JSON.stringify(blocked.map((b) => b.reason)));
  check('block reason recorded', p.blockedRequests().some((r) => r.reason.startsWith('third-party')));
  await b.close();
  return true;
});
await soft('maxBytes aborts oversized responses', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage({ bandwidth: { maxBytes: 200_000 } });
  await p.goto(`${S}/big.bin?mb=2`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await p.wait(400);
  const t = p.transferred();
  check('oversize body aborted', t.blockedBytes >= 2_000_000 || t.transferred === 0 || t.total < 200_000, JSON.stringify({ blockedBytes: t.blockedBytes, total: t.total }));
  check('blocked reason recorded', JSON.stringify(t.blocked).includes('oversize'), JSON.stringify(t.blocked));
  await b.close();
  return true;
});
await soft('transferred() reports per-type bytes', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/heavy.html`, { waitUntil: 'load' }).catch(() => {});
  await p.wait(500);
  const t = p.transferred();
  check('total > 0', t.total > 0);
  check('has Document bytes', (t.byType.Document || 0) > 0, JSON.stringify(t.byType));
  check('has Image bytes', (t.byType.Image || 0) > 0, JSON.stringify(t.byType));
  check('human readable', /B|KB|MB/.test(t.human), t.human);
  await b.close();
  return true;
});
await soft('setBandwidth() switches profile at runtime', async () => {
  const b = await velox.launch({ executablePath: EXE });
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  await p.setBandwidth('text-only');
  const blocked = [];
  p.on('blocked', (e) => blocked.push(e.reason));
  await p.goto(`${S}/heavy.html`, { waitUntil: 'load' }).catch(() => {});
  await p.wait(400);
  check('runtime profile took effect', blocked.length > 0, JSON.stringify(blocked.slice(0, 3)));
  await b.close();
  return true;
});

/* ── lite engine: conditional cache + byte caps ───────────────────────────── */
await soft('lite conditional cache: 304 revalidation', async () => {
  const cache = velox.createCache();
  await velox.fetch(`${S}/page2.html`, { cache, maxRedirects: 1 });
  const before = siteStats.notModified;
  const second = await velox.fetch(`${S}/page2.html`, { cache });
  check('second fetch served from cache', second.fromCache === true, String(second.fromCache));
  check('304 was used', siteStats.notModified > before, `notModified=${siteStats.notModified}`);
  check('bytes saved reported', second.meta.bytesSaved > 0, JSON.stringify(second.meta));
  check('body still correct', second.title() === 'Page Two', second.title());
  check('cache served no new bytes', second.meta.bytes === 0, String(second.meta.bytes));
  return true;
});
await soft('lite cache survives a new instance (disk)', async () => {
  const dir = '/tmp/velox-cache-test';
  const c1 = velox.createCache({ dir }); c1.clear();
  await velox.fetch(`${S}/index.html`, { cache: c1 });
  const c2 = velox.createCache({ dir });              // fresh process would behave the same
  const r = await velox.fetch(`${S}/index.html`, { cache: c2 });
  check('disk cache reused (304)', r.fromCache === true, `fromCache=${r.fromCache}`);
  check('disk cache stats', c2.stats.revalidated >= 1, JSON.stringify(c2.stats));
  return true;
});
await soft('lite ttl cache skips the network entirely', async () => {
  const cache = velox.createCache({ ttl: 60_000 });
  await velox.fetch(`${S}/page2.html`, { cache });
  const before = siteStats.conditional;
  const r = await velox.fetch(`${S}/page2.html`, { cache });
  check('served without any request', siteStats.conditional === before, `conditional=${siteStats.conditional}`);
  check('fromCache marker', r.fromCache === true);
  return true;
});
await soft('lite maxBytes caps the body', async () => {
  const r = await velox.fetch(`${S}/big.bin?mb=1`, { maxBytes: 100_000 });
  check('truncated flag', r.meta.truncated === true, JSON.stringify(r.meta));
  check('body capped', r.body.length <= 100_000, String(r.body.length));
  return true;
});
await soft('fetchAll shares one cache', async () => {
  const cache = velox.createCache();
  const urls = [`${S}/page2.html`, `${S}/index.html`, `${S}/page2.html`];
  await velox.fetchAll(urls, { cache, concurrency: 3 });
  const again = await velox.fetchAll(urls, { cache, concurrency: 3 });
  check('all revalidated from cache', again.every((r) => r.fromCache === true), again.map((r) => r.fromCache).join(','));
  return true;
});

site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
