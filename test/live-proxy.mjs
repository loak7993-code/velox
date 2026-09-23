// live test of velox's proxy support against a real residential proxy
import velox, { checkProxy, ProxyPool } from '/tmp/opencode/velox/src/index.js';

const RAW = process.env.PX;
const LABEL = RAW.replace(/\/\/[^@]*@/, '//***:***@');
const t = (ms) => `${ms}ms`;
const line = (ok, name, extra = '') => console.log(`${ok ? '✓' : '✗'}  ${name}${extra ? '  — ' + extra : ''}`);

console.log(`proxy: ${LABEL}\n`);

/* 1. checkProxy — plain http target through the proxy */
let r = await checkProxy(RAW, { url: 'http://example.com', timeout: 30000 });
line(r.ok, 'checkProxy http', `status=${r.status} ${t(r.ms)}${r.error ? ' ' + r.error : ''}`);

/* 2. checkProxy — https target (exercises CONNECT tunnelling + TLS) */
r = await checkProxy(RAW, { url: 'https://example.com', timeout: 30000 });
line(r.ok, 'checkProxy https (CONNECT)', `status=${r.status} ${t(r.ms)}${r.error ? ' ' + r.error : ''}`);

/* 3. exit IP as seen by the world (url + ipUrl both through the proxy) */
r = await checkProxy(RAW, { url: 'https://example.com', ipUrl: 'https://api.ipify.org', timeout: 30000 });
line(r.ok && !!r.ip, 'exit IP via https', `ip=${r.ip} ${t(r.ms)}${r.error ? ' ' + r.error : ''}`);
const EXIT_IP = r.ip;

/* 4. lite engine fetch through the proxy (no browser) */
let t0 = Date.now();
const page = await velox.fetch('https://example.com', { proxy: RAW, timeout: 30000 });
line(page.status === 200, 'velox.fetch through proxy', `status=${page.status} title="${page.title()}" ${t(Date.now() - t0)}`);

/* 5. parallel lite fetches through the proxy */
t0 = Date.now();
const many = await velox.fetchAll(['https://example.com', 'https://example.com/?a=1', 'https://example.com/?a=2'], { proxy: RAW, concurrency: 3, timeout: 30000 });
line(many.every((m) => m.status === 200), 'velox.fetchAll through proxy', `${many.filter((m) => m.status === 200).length}/3 ok ${t(Date.now() - t0)}`);

/* 6. a real browser through the proxy — verify the page's own egress IP */
const b = await velox.launch({ executablePath: process.env.VELOX_BROWSER, proxy: { server: RAW } });
t0 = Date.now();
const p = await b.newPage();
await p.goto('https://example.com', { waitUntil: 'load', timeout: 45000 });
const browserIp = await p.eval(`fetch('https://api.ipify.org').then(r => r.text()).catch(e => 'ERR:' + e.message)`);
line((await p.title()) === 'Example Domain', 'browser through proxy', `title="${await p.title()}" ${t(Date.now() - t0)}`);
line(!!browserIp && !String(browserIp).startsWith('ERR'), 'browser egress IP (rotating residential)', `${browserIp}${EXIT_IP ? ' (earlier: ' + EXIT_IP + ')' : ''}`);

/* 7. per-context proxy isolation: proxied context + direct context side by side */
const ctx = await b.newContext({ proxy: { server: RAW } });
const pProxy = await ctx.newPage();
await pProxy.goto('https://api.ipify.org', { waitUntil: 'load', timeout: 45000 });
const ctxIp = await pProxy.text('body');
const directBrowser = await velox.launch({ executablePath: process.env.VELOX_BROWSER });
const pDirect = await directBrowser.newPage();
await pDirect.goto('https://api.ipify.org', { waitUntil: 'load', timeout: 45000 });
const directIp = await pDirect.text('body');
line(ctxIp === browserIp && directIp !== ctxIp, 'per-context proxy vs direct', `proxied=${ctxIp} direct=${directIp}`);
await ctx.close();
await directBrowser.close();
await b.close();

/* 8. ProxyPool with a real proxy + a dead one */
const pool = new ProxyPool([RAW, 'http://127.0.0.1:9'], { strategy: 'least-latency', maxFailures: 1, healthCheckUrl: 'https://example.com', healthCheckTimeout: 30000 });
t0 = Date.now();
const report = await pool.healthCheck({ url: 'https://example.com' });
line(report.some((x) => x.ok), 'ProxyPool.healthCheck', report.map((x) => `${x.id.replace(/\/\/[^@]*@/, '//***@')}=${x.ok ? t(x.ms) : 'fail'}`).join(' ') + ` (${t(Date.now() - t0)})`);
const live = pool.available();
line(live.length === 1 && live[0].server.includes('iproyal'), 'dead proxy ejected', `${live.length} live`);
const got = await pool.withProxy((px) => velox.fetch('https://example.com', { proxy: px, timeout: 30000 }));
line(got.status === 200, 'ProxyPool.withProxy routed a scrape', `status=${got.status}`);
console.log('\npool stats:');
for (const s of pool.stats()) console.log(`  ${s.id.replace(/\/\/[^@]*@/, '//***@')}  uses=${s.uses} failures=${s.failures} latency=${s.latency ?? '-'}ms ejected=${s.ejected}`);
process.exit(0);
