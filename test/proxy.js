// velox :: proxy.js (test) — verifies real proxying through HTTP + SOCKS5 servers
import velox, { checkProxy, ProxyPool } from '../src/index.js';
import { startSite } from './site/serve.js';
import { startHttpProxy, startSocks5Proxy } from './site/proxy.js';

const EXE = process.env.VELOX_BROWSER;
const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const T0 = Date.now();
const soft = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`… ${name} `);
  try { const v = await fn(); process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, v === undefined || v === true || !!v); }
  catch (e) { process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, false, e.message.slice(0, 140)); }
};

const site = await startSite();
const S = site.url;
const proxy = await startHttpProxy({ id: 'p-alpha' });
const socks = await startSocks5Proxy({ id: 's-alpha' });
const authProxy = await startHttpProxy({ id: 'p-auth', username: 'pxuser', password: 'pxpass' });
const authSocks = await startSocks5Proxy({ id: 's-auth', username: 'suser', password: 'spass' });
const deadProxy = await startHttpProxy({ id: 'p-dead', fail: true });

/* ── lite engine through proxies (no browser) ─────────────────────────────── */
await soft('lite fetch through HTTP proxy', async () => {
  const r = await velox.fetch(`${S}/page2.html`, { proxy: proxy.url });
  return r.status === 200 && r.headers['x-vx-proxy-id'] === 'p-alpha' && proxy.stats.requests >= 1;
});
await soft('lite fetch through SOCKS5 proxy', async () => {
  const before = socks.stats.connects;
  const r = await velox.fetch(`${S}/page2.html`, { proxy: socks.url });
  return r.status === 200 && socks.stats.connects > before;
});
await soft('lite proxy auth (http + socks5)', async () => {
  const a = await velox.fetch(`${S}/page2.html`, { proxy: `http://pxuser:pxpass@127.0.0.1:${authProxy.port}` });
  const b = await velox.fetch(`${S}/page2.html`, { proxy: `socks5://suser:spass@127.0.0.1:${authSocks.port}` });
  return a.status === 200 && b.status === 200;
});
await soft('unauthenticated proxy is refused', async () => {
  try { await velox.fetch(`${S}/page2.html`, { proxy: authProxy.url }); return false; }
  catch { return authProxy.stats.denied > 0; }
});
await soft('fetchAll respects a proxy', async () => {
  const before = proxy.stats.requests;
  const out = await velox.fetchAll([1, 2, 3, 4, 5, 6].map((i) => `${S}/page2.html?i=${i}`), { proxy: proxy.url, concurrency: 3 });
  return out.every((r) => r.status === 200) && proxy.stats.requests - before >= 6;
});

/* ── checkProxy + ProxyPool ───────────────────────────────────────────────── */
await soft('checkProxy reports ok + latency', async () => {
  const r = await checkProxy(proxy.url, { url: `${S}/page2.html` });
  return r.ok === true && r.status === 200 && r.ms >= 0 && r.via === 'p-alpha';
});
await soft('checkProxy reports failure', async () => {
  const r = await checkProxy(deadProxy.url, { url: `${S}/page2.html`, timeout: 4000 });
  return r.ok === false && !!r.error;
});
await soft('ProxyPool rotation + sticky', async () => {
  const pool = new ProxyPool([proxy.url, socks.url]);
  const a = pool.next(), b = pool.next();
  check('rotates between proxies', a.id !== b.id, `${a.id} vs ${b.id}`);
  const s1 = pool.sticky('account-1'), s2 = pool.sticky('account-1');
  check('sticky returns the same proxy', s1.id === s2.id);
  return true;
});
await soft('ProxyPool health check + ejection', async () => {
  const pool = new ProxyPool([proxy.url, deadProxy.url], { maxFailures: 1, cooldownMs: 60000, healthCheckUrl: `${S}/page2.html`, healthCheckTimeout: 4000 });
  const report = await pool.healthCheck();
  const dead = report.find((r) => r.id.includes(String(deadProxy.port)));
  check('health check flags the dead proxy', !!dead && dead.ok === false);
  const stats = pool.stats();
  check('dead proxy ejected', stats.some((s) => s.ejected === true));
  const live = pool.available();
  check('only live proxies offered', live.every((p) => !p.id.includes(String(deadProxy.port))), JSON.stringify(live.map((l) => l.id)));
  return true;
});
await soft('ProxyPool.withProxy retries another exit', async () => {
  const pool = new ProxyPool([deadProxy.url, proxy.url], { maxFailures: 5 });
  const r = await pool.withProxy((p) => velox.fetch(`${S}/page2.html`, { proxy: p.server, timeout: 4000 }), { attempts: 2 });
  return r.status === 200;
});

/* ── browsers through proxies ─────────────────────────────────────────────── */
let b;
await soft('launch with launch-level HTTP proxy', async () => {
  const before = proxy.stats.requests;
  b = await velox.launch({ executablePath: EXE, proxy: { server: proxy.url, bypass: ['<-loopback>'] } });
  const p = await b.newPage();
  const nav = await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const via = p.requests().find((r) => r.url.includes('/'))?.response?.headers?.['x-vx-proxy-id'];
  check('navigation went through the proxy', proxy.stats.requests > before, `requests=${proxy.stats.requests}`);
  check('proxy header visible to the page', via === 'p-alpha', String(via));
  await b.close();
  return nav.status === 200;
});
await soft('launch with SOCKS5 proxy', async () => {
  const before = socks.stats.connects;
  const b2 = await velox.launch({ executablePath: EXE, proxy: { server: socks.url, bypass: ['<-loopback>'] } });
  const p = await b2.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const ok = socks.stats.connects > before && (await p.title()) === 'Page Two';
  await b2.close();
  return ok;
});
await soft('proxy authentication via launch credentials', async () => {
  const before = authProxy.stats.requests;
  const b3 = await velox.launch({ executablePath: EXE, proxy: { server: authProxy.url, username: 'pxuser', password: 'pxpass', bypass: ['<-loopback>'] } });
  const p = await b3.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const ok = (await p.text('h1')) === 'Welcome to Velox' && authProxy.stats.requests > before;
  await b3.close();
  return ok;
});
await soft('wrong proxy credentials fail to load', async () => {
  const b4 = await velox.launch({ executablePath: EXE, proxy: { server: authProxy.url, username: 'nope', password: 'nope', bypass: ['<-loopback>'] } });
  const p = await b4.newPage();
  const nav = await p.goto(`${S}/`, { waitUntil: 'interactive', timeout: 8000 }).catch(() => null);
  const loaded = !!(nav && (await p.text('h1').catch(() => null)) === 'Welcome to Velox');
  await b4.close();
  return loaded === false;
});
await soft('per-context proxy (isolated + bypass list)', async () => {
  const b5 = await velox.launch({ executablePath: EXE });
  const before = proxy.stats.requests;
  const ctx = await b5.newContext({ proxy: { server: proxy.url, bypass: ['<-loopback>'] } });
  const pProxy = await ctx.newPage();
  await pProxy.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const via = pProxy.requests()[0]?.response?.headers?.['x-vx-proxy-id'];
  const plain = await b5.newPage();              // default context: direct
  await plain.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const plainVia = plain.requests()[0]?.response?.headers?.['x-vx-proxy-id'];
  check('context page routed through proxy', via === 'p-alpha', String(via));
  check('default context stays direct', plainVia === undefined, String(plainVia));
  await b5.close();
  return proxy.stats.requests > before;
});
await soft('per-context proxy with credentials', async () => {
  const b6 = await velox.launch({ executablePath: EXE });
  const ctx = await b6.newContext({ proxy: { server: authProxy.url, username: 'pxuser', password: 'pxpass', bypass: ['<-loopback>'] } });
  const p = await ctx.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const ok = (await p.text('h1')) === 'Welcome to Velox';
  await b6.close();
  return ok;
});

/* ── plumbing units ───────────────────────────────────────────────────────── */
await soft('proxy string normalisation', async () => {
  const { normalizeProxy, proxyFlags } = await import('../src/proxy.js');
  const bare = normalizeProxy('1.2.3.4:8080');
  const auth = normalizeProxy('socks5://u:p@1.2.3.4:1080');
  const obj = normalizeProxy({ server: 'http://x:1', username: 'u' });
  check('bare host:port → http url', bare.server === 'http://1.2.3.4:8080', bare.server);
  check('creds parsed from URL', auth.username === 'u' && auth.password === 'p' && auth.scheme === 'socks5');
  check('object form passes through', obj.server === 'http://x:1' && obj.username === 'u');
  const flags = proxyFlags({ server: 'http://x:1', bypass: ['<local>', '*.internal'] });
  check('launch flags include bypass list', flags.some((f) => f.startsWith('--proxy-bypass-list=')), JSON.stringify(flags));
  return true;
});

await proxy.close(); await socks.close(); await authProxy.close(); await authSocks.close(); await deadProxy.close();
site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed in ${((Date.now() - T0) / 1000).toFixed(1)}s`);
process.exit(fails.length ? 1 : 0);
