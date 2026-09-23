// why does the browser + auth-proxy hang? log every auth challenge the page sees
import velox from '/tmp/opencode/velox/src/index.js';

const RAW = process.env.PX;
const b = await velox.launch({ executablePath: process.env.VELOX_BROWSER, proxy: { server: RAW } });
console.log('browser.proxy:', JSON.stringify({ ...b.proxy, password: b.proxy.password ? '***' : undefined }));

const p = await b.newPage();
p.session.on('Fetch.authRequired', (c) => {
  console.log('  [authRequired]', JSON.stringify({ source: c.authChallenge?.source, scheme: c.authChallenge?.scheme, realm: c.authChallenge?.realm, hasCreds: !!(p._proxyCredentials?.username) }));
});
p.session.on('Fetch.requestPaused', () => {});
console.log('page _proxyCredentials:', p._proxyCredentials ? 'yes' : 'NO', '| fetchOn:', p._fetchOn);

for (const url of ['http://example.com', 'https://example.com']) {
  const t0 = Date.now();
  const nav = await p.goto(url, { waitUntil: 'interactive', timeout: 25000 }).catch((e) => ({ error: e.message.slice(0, 60) }));
  console.log(`goto ${url.padEnd(22)} → ${nav.error ? 'ERR ' + nav.error : 'status ' + nav.status} ${Date.now() - t0}ms`, nav.error ? '' : `title="${await p.title()}"`);
}
await b.close();
process.exit(0);
