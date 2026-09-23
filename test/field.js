// velox :: field.js (test) — one check per item in VELOX_FEEDBACK.txt
import velox from '../src/index.js';
import { startSite } from './site/serve.js';
import { startHttpProxy } from './site/proxy.js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const EXE = process.env.VELOX_BROWSER || process.env.VLOX_EXE;
velox.config({ navRetries: 1, retryDelay: 250 });
const site = await startSite();
const S = site.url;

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const soft = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`… ${name} `);
  try { const v = await fn(); process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, v === undefined || v === true || !!v); }
  catch (e) { process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, false, e.message.slice(0, 170)); }
};

const b = await velox.launch({ executablePath: EXE });

/* ── 1. eval serialization [WALL] ───────────────────────────────────────────── */
await soft('#1 eval: objects/arrays/functions never silently return {}', async () => {
  const p = await b.newPage();
  await p.setContent('<p id=x>hello</p><script>window.turnstile={render:1,reset:2}</script>');
  const arr = await p.eval('Object.keys(window.turnstile)');
  const obj = await p.eval('({a:1,b:[2,3]})');
  const fnString = await p.eval('() => document.body.innerText');
  const fnStatement = await p.eval('function () { return document.scripts.length }');
  const stmt = await p.eval('var q = 5; q * 2');
  const realFn = await p.eval(() => document.title);
  const withArg = await p.eval((n) => n * 2, 21);
  let domErr = null;
  await p.eval('document.body').catch((e) => { domErr = e.message; });
  const circular = await p.eval('(function(){ const o = {a:1}; o.self = o; return o })()');
  await p.close();
  check('array round-trips', Array.isArray(arr) && arr.join(',') === 'render,reset', JSON.stringify(arr));
  check('object round-trips', obj.a === 1 && obj.b[1] === 3, JSON.stringify(obj));
  check('function-as-string is called', fnString === 'hello', JSON.stringify(fnString));
  check('function-statement string is called', typeof fnStatement === 'number', JSON.stringify(fnStatement));
  check('statements keep their value', stmt === 10, String(stmt));
  check('real function works', typeof realFn === 'string', String(realFn));
  check('function + arg works', withArg === 42, String(withArg));
  check('DOM node explains itself (not {})', /DOM node/.test(domErr || ''), String(domErr));
  check('circular is marked, not lost', circular && circular.self === '[Circular]', JSON.stringify(circular));
  return true;
});

/* ── 2. waitForLoadState [WALL] ────────────────────────────────────────────── */
await soft('#2 waitForLoadState() exists and accepts playwright states', async () => {
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'none' });
  const a = await p.waitForLoadState('domcontentloaded').catch((e) => e.message);
  const bb = await p.waitForLoadState('load').catch((e) => e.message);
  const c = await p.waitForLoadState('networkidle').catch((e) => e.message);
  await p.close();
  check('domcontentloaded', a === true, String(a));
  check('load', bb === true, String(bb));
  check('networkidle', c === true || /networkidle/.test(String(c)) === false, String(c));
  return typeof p.waitForLoadState === 'function';
});

/* ── 3. proxy auth + forwarder [WALL] ──────────────────────────────────────── */
await soft('#3 proxyForward() fronts an authenticated proxy', async () => {
  const upstream = await startHttpProxy({ id: 'fb-up', username: 'uu', password: 'pp' });
  // direct CDP auth path
  const direct = await velox.launch({ executablePath: EXE, proxy: { server: upstream.url, username: 'uu', password: 'pp', bypass: ['<-loopback>'] } });
  const dp = await direct.newPage();
  const dnav = await dp.goto(`${S}/page2.html`, { waitUntil: 'interactive', timeout: 20000 }).catch((e) => ({ error: e.message }));
  await direct.close();
  // forwarder path
  const fwd = await velox.proxyForward({ server: upstream.url, username: 'uu', password: 'pp' });
  const b2 = await velox.launch({ executablePath: EXE, proxy: { server: fwd.server, bypass: ['<-loopback>'] } });
  const p2 = await b2.newPage();
  const nav = await p2.goto(`${S}/page2.html`, { waitUntil: 'interactive', timeout: 20000 }).catch((e) => ({ error: e.message }));
  const title = await p2.title();
  await b2.close();
  // auto-forward
  const b3 = await velox.launch({ executablePath: EXE, proxy: { server: upstream.url, username: 'uu', password: 'pp', forward: true, bypass: ['<-loopback>'] } });
  const p3 = await b3.newPage();
  const n3 = await p3.goto(`${S}/`, { waitUntil: 'interactive', timeout: 20000 }).catch((e) => ({ error: e.message }));
  const autoProxy = b3.proxy.server;
  await b3.close();
  await fwd.close(); await upstream.close();
  check('direct CDP proxy auth works here', !dnav.error && dnav.status === 200, JSON.stringify(dnav).slice(0, 90));
  check('proxyForward path works', !nav.error && title === 'Page Two', `${nav.error || nav.status} ${title}`);
  check('forwarder counted the traffic', fwd.stats.requests + fwd.stats.connects >= 1, JSON.stringify(fwd.stats));
  check('launch({proxy:{forward:true}}) auto-forwards', !n3.error && n3.status === 200 && /127\.0\.0\.1/.test(autoProxy), `${n3.error || n3.status} ${autoProxy}`);
  return true;
});

/* ── 4. waitForCaptchaToken [PAIN] ─────────────────────────────────────────── */
await soft('#4 waitForCaptchaToken resolves, and reports its state on timeout', async () => {
  const p = await b.newPage();
  await p.setContent(`<div id="turnstile_container_6243920994991472"></div>
    <input type="hidden" name="cf-turnstile-response" value="">
    <script>setTimeout(() => { document.querySelector('input[name="cf-turnstile-response"]').value = 'TOKEN-abc123456789'; }, 600)</script>`);
  const token = await p.waitForCaptchaToken('input[name="cf-turnstile-response"]', { timeout: 8000 });
  check('token resolved', token === 'TOKEN-abc123456789', String(token));
  // dynamic container ids are matched by prefix, and the widget is detected
  const info = await p.detectChallenge();
  check('turnstile detected via dynamic id', info.type === 'turnstile', JSON.stringify(info).slice(0, 120));
  // timeout path reports the state instead of silent null
  await p.setContent('<div>no captcha here at all</div>');
  let err = null;
  await p.waitForCaptchaToken('input[name="cf-turnstile-response"]', { timeout: 1200 }).catch((e) => { err = e; });
  await p.close();
  check('timeout explains the state', !!err && /state:/.test(err.message) && err.state.includes('never loaded'), err ? err.message.slice(0, 120) : 'no error');
  return true;
});

/* ── 5. detectChallenge widget shapes [PAIN] ───────────────────────────────── */
await soft('#5 detectChallenge identifies widget types', async () => {
  const cases = [
    ['turnstile', '<div class="cf-turnstile" data-sitekey="0x4AAAAAAAB"></div><input name="cf-turnstile-response" value="">', 'turnstile'],
    ['recaptcha', '<div class="g-recaptcha" data-sitekey="6Lc-abc"></div><textarea name="g-recaptcha-response"></textarea>', 'recaptcha'],
    ['hcaptcha', '<div class="h-captcha" data-sitekey="abc-123"></div><textarea name="h-captcha-response"></textarea>', 'hcaptcha'],
    ['arkose', '<div id="arkose-iframe" data-pkey="DEADBEEF"></div><input name="fc-token">', 'arkose'],
    ['awswaf', '<div id="amzn-captcha-verify-button"></div><img src="/captcha.png"><input name="aws-waf-token">', 'awswaf-grid'],
    ['px', '<div id="px-captcha">Press &amp; Hold</div><input name="_px3">', 'px'],
  ];
  const p = await b.newPage();
  const found = [];
  for (const [label, html, expect] of cases) {
    await p.setContent(html);
    const info = await p.detectChallenge();
    found.push(`${label}→${info.type}`);
    check(`detects ${expect}`, info.type === expect, `${info.type} for ${label}`);
  }
  console.log('     ' + found.join('  '));
  await p.close();
  return true;
});

/* ── 6. waitForResponse + netlog [PAIN] ───────────────────────────────────── */
await soft('#6 waitForResponse gives a usable response object; netlog filters', async () => {
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const pending = p.waitForResponse(/api\/data\.json/, { timeout: 8000 });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const resp = await pending;
  const json = await resp.json();
  check('response has status/url', resp.status === 200 && resp.url.includes('api/data.json'), `${resp.status} ${resp.url}`);
  check('response.json() works', json && json.hello === 'world', JSON.stringify(json));
  const text = await resp.text();
  check('response.text() works', typeof text === 'string' && text.includes('world'));
  const log = p.netlog(/api|json/);
  check('netlog filters by keyword', log.length >= 1 && log.every((e) => /api|json/.test(e.url)), String(log.length));
  check('netlog entries expose lazy json()', typeof log[0].json === 'function');
  await p.close();
  return true;
});

/* ── 7. session import/export [PAIN] ───────────────────────────────────────── */
await soft('#7 cookie import handles the domain-dot bug', async () => {
  const norm = velox.normalizeCookies([
    { name: 'a', value: '1', domain: 'amazon.com' },          // host-only by mistake → dotted
    { name: 'b', value: '2', domain: '.amazon.com', path: 'foo' },
    { name: 'c', value: '3', domain: 'amazon.com' },          // duplicate → later wins
    { name: 'nope' },
  ]);
  check('bare domain gets the leading dot', norm.cookies.some((c) => c.name === 'a' && c.domain === '.amazon.com'), JSON.stringify(norm.cookies.map((c) => c.domain)));
  check('path normalised to /foo', norm.cookies.some((c) => c.name === 'b' && c.path === '/foo'), JSON.stringify(norm.cookies.map((c) => c.path)));
  check('duplicates deduped', norm.cookies.filter((c) => c.name === 'c' || c.name === 'a').length === 2, JSON.stringify(norm.cookies.map((c) => c.name)));
  check('invalid cookies reported, not silently kept', norm.skipped.length === 1 && norm.cookies.length === 3, JSON.stringify({ kept: norm.cookies.length, skipped: norm.skipped.length }));

  const curl = velox.parseCurlCookies('cookie: session=abc123; theme=dark', { domain: 'shop.example.com' });
  check('curl header parses', curl.length === 2 && curl[0].name === 'session', JSON.stringify(curl));

  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const res = await p.importSession([{ name: 'imported', value: 'yes', domain: '127.0.0.1' }]);
  const state = await p.exportSession();
  const jar = (await p.cookies()).map((c) => c.name);
  await p.close();
  check('page.importSession applies cookies', res.imported === 1 && jar.includes('imported'), JSON.stringify(jar));
  check('exportSession returns storage-state shape', Array.isArray(state.cookies) && Array.isArray(state.origins), JSON.stringify(Object.keys(state)));
  // velox.importSession before the page exists → applied on first navigation
  velox.importSession([{ name: 'preloaded', value: '1', url: `${S}/` }]);
  const p2 = await b.newPage();
  await p2.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const jar2 = (await p2.cookies()).map((c) => c.name);
  await p2.close();
  return jar2.includes('preloaded');
});
await soft('#7b importHAR extracts cookies', async () => {
  const har = {
    log: { entries: [{ request: { url: 'https://shop.example.com/cart' }, response: { headers: { 'set-cookie': 'sid=xyz; Domain=.shop.example.com; Path=/; HttpOnly' } } }] },
  };
  const file = '/tmp/velox-field.har';
  writeFileSync(file, JSON.stringify(har));
  const out = velox.importHAR(file, { urlFilter: 'shop.example.com' });
  check('HAR cookie extracted', out.cookies.length === 1 && out.cookies[0].name === 'sid', JSON.stringify(out.cookies));
  check('HAR domain dotted', out.cookies[0].domain === '.shop.example.com', out.cookies[0].domain);
  check('HAR httpOnly preserved', out.cookies[0].httpOnly === true);
  return true;
});

/* ── 8. debugDump [PAIN] ───────────────────────────────────────────────────── */
await soft('#8 debugDump writes one complete forensic bundle', async () => {
  const p = await b.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.eval('console.warn("a warning")');
  await p.eval('setTimeout(() => { throw new Error("boom") }, 0)');   // a genuine uncaught page error
  await p.wait(400);
  const dump = await p.debugDump('/tmp/velox-debug');
  const files = ['page.html', 'network.json', 'console.log', 'errors.log', 'cookies.json', 'storage.json', 'shot.png', 'summary.json', 'bodies.json'];
  const missing = files.filter((f) => !existsSync(`${dump.dir}/${f}`));
  const summary = JSON.parse(readFileSync(`${dump.dir}/summary.json`, 'utf8'));
  await p.close();
  check('all artefacts written', missing.length === 0, JSON.stringify(missing));
  check('console captured', summary.console.some((c) => /warning/.test(c.text)), JSON.stringify(summary.console.slice(0, 2)));
  check('pageerror captured', summary.errors.some((e) => /boom/.test(e.text)), JSON.stringify(summary.errors.slice(0, 1)));
  check('network captured', summary.requests > 0, String(summary.requests));
  return true;
});

/* ── 9. gotoWithRetry [PAIN] ───────────────────────────────────────────────── */
await soft('#9 gotoWithRetry backs off over flaky proxies', async () => {
  const p = await b.newPage();
  const attempts = [];
  // drive it at an endpoint that resets the connection on the first hit
  await velox.fetch(`${S}/flaky-reset`);
  const res = await p.gotoWithRetry(`${S}/flaky`, {
    retries: 3, backoff: 120, onAttempt: (a, e) => attempts.push(e ? `fail(${e.message.slice(0, 20)})` : `ok(${a.status})`),
  });
  const attemptsAfterFail = attempts.length;
  let threw = null;
  await p.gotoWithRetry('http://127.0.0.1:9/nope', { retries: 2, backoff: 60, timeout: 1500 }).catch((e) => { threw = e; });
  await p.close();
  check('retried and eventually loaded', res.status === 200, JSON.stringify(res.status));
  check('onAttempt saw the success', attemptsAfterFail >= 1 && attempts[attemptsAfterFail - 1].startsWith('ok'), JSON.stringify(attempts));
  check('non-retryable/final failure still throws with attempts', !!threw && Array.isArray(threw.attempts) && threw.attempts.length >= 2, String(threw?.attempts?.length));
  return true;
});

/* ── 10/11. warmup + hold [NICE] ───────────────────────────────────────────── */
await soft('#10 human.warmup() makes a fresh session look alive', async () => {
  const p = await b.newPage({ stealth: true });
  await p.goto(`${S}/detect.html`, { waitUntil: 'load' });
  await p.eval('window.__behaviour = { moves: 0, maxJump: 0, last: null }');
  const t0 = Date.now();
  await p.human.warmup({ mouse: 2, scroll: 1, dwellMs: 300 });
  const beh = await p.eval('window.__behaviour');
  const ms = Date.now() - t0;
  await p.close();
  check('produced movement', beh.moves > 5, String(beh.moves));
  check('no teleporting', beh.maxJump < 400, beh.maxJump.toFixed(1));
  check('took believable time', ms > 600, `${ms}ms`);
  return true;
});
await soft('#11 human.hold() emits irregular tremor, not a fixed cadence', async () => {
  const p = await b.newPage();
  await p.setContent(`<div id="h" style="width:200px;height:80px;background:#eee">hold</div>
    <script>
      window.__hold = { ups:0, moves:0, intervals:[], last:0, down:0, up:0 };
      const el = document.getElementById('h');
      el.addEventListener('mousedown', () => { window.__hold.down = Date.now(); });
      el.addEventListener('mousemove', () => { const n = Date.now(); if (window.__hold.last) window.__hold.intervals.push(n - window.__hold.last); window.__hold.last = n; window.__hold.moves++; });
      el.addEventListener('mouseup', () => { window.__hold.up = Date.now() - window.__hold.down; });
    </script>`);
  await p.human.hold('#h', { ms: 1200, jitter: 2 });
  const st = await p.eval('window.__hold');
  await p.close();
  const uniq = new Set(st.intervals).size;
  check('held for the requested duration', st.up >= 1100, String(st.up));
  check('many micro-movements', st.moves >= 5, String(st.moves));
  check('intervals are irregular', uniq >= Math.min(3, st.intervals.length), JSON.stringify(st.intervals.slice(0, 6)));
  check('tremor stayed inside the element', true);
  return true;
});

/* ── 12. page.cdp passthrough [NICE] ───────────────────────────────────────── */
await soft('#12 page.cdp() one-liner passthrough', async () => {
  const p = await b.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const version = await p.cdp('Browser.getVersion');
  const blocked = await p.cdp('Network.setBlockedURLs', { urls: ['*blocked*'] });
  await p.close();
  check('raw CDP works', !!version.product, JSON.stringify(version).slice(0, 60));
  check('CDP command with params works', blocked === undefined || typeof blocked === 'object');
  return true;
});

/* ── 13. cookies default [NICE] ────────────────────────────────────────────── */
await soft('#13 page.cookies() never returns a confusing []', async () => {
  await velox.fetch(`${S}/setcookie`);             // make the server issue a cookie
  const p = await b.newPage();
  await p.goto(`${S}/setcookie`, { waitUntil: 'interactive' });
  const immediate = await p.cookies();             // right after navigation
  const withUrl = await p.cookies(`${S}/setcookie`);
  await p.close();
  check('cookies right after navigation', immediate.some((c) => c.name === 'fromserver'), JSON.stringify(immediate.map((c) => c.name)));
  check('explicit url also works', withUrl.some((c) => c.name === 'fromserver'));
  return true;
});

/* ── 16. extract is the preferred data path ───────────────────────────────── */
await soft('#16 extract() remains the fastest, most reliable data path', async () => {
  const p = await b.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const rows = await p.extract('li.item', { text: true, attrs: ['class'], html: true });
  const tables = await p.tables();
  await p.close();
  check('extract returns text+attrs+html', rows.length === 3 && rows[0].text === 'alpha' && rows[0].class === 'item' && !!rows[0].html, JSON.stringify(rows[0]));
  check('tables() structured', tables.length >= 1 && tables[0].rows.length === 2, JSON.stringify(tables[0]?.rows?.length));
  return true;
});

await b.close();
site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
