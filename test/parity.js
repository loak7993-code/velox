// velox :: parity.js — everything-Playwright-can feature suite
import velox from '../src/index.js';
import { expect } from '../src/assert.js';
import { startSite } from './site/serve.js';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/?$/, '/');
const DEFAULT_EXE = ROOT + '.browsers/chrome-headless-shell-linux64/chrome-headless-shell';


const EXE = process.env.VLOX_EXE || process.env.VELOX_BROWSER;
const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const soft = async (name, fn) => {
  try { const v = await fn(); check(name, v === undefined || v === true || !!v); }
  catch (e) { check(name, false, e.message.slice(0, 120)); }
};

velox.config({ navRetries: 1, retryDelay: 250 });   // CI runners are noisy: retry transient navigation failures
const site = await startSite();
const S = site.url;

/* ---------------- browser contexts ---------------- */
const b = await velox.launch({ executablePath: EXE });

await soft('newContext isolation', async () => {
  const ctxA = await b.newContext();
  const ctxB = await b.newContext();
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  const navA = await pa.goto(`${S}/setcookie`);
  await pb.goto(`${S}/page2.html`);
  const cookiesA = await ctxA.cookies();
  const cookiesB = await ctxB.cookies();
  check('context cookie isolation', cookiesA.some((c) => c.name === 'fromserver') && !cookiesB.some((c) => c.name === 'fromserver'), JSON.stringify([cookiesA.length, cookiesB.length]));
  await ctxA.close(); await ctxB.close();
});

await soft('storageState save/load', async () => {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(`${S}/setcookie`);
  await p.eval('localStorage.setItem("persisted", "yes")');
  const state = await ctx.storageState();
  check('storageState captures cookies', state.cookies.some((c) => c.name === 'fromserver'));
  await ctx.close();
  const ctx2 = await b.newContext({ storageState: state });
  const p2 = await ctx2.newPage();
  await p2.goto(`${S}/`);
  const cookies2 = await ctx2.cookies();
  check('storageState restores cookies', cookies2.some((c) => c.name === 'fromserver' && c.value === 'yes'));
  await ctx2.close();
});

await soft('context route applies to all pages', async () => {
  const ctx = await b.newContext();
  ctx.route('**/api/data.json', (req) => req.fulfill({ status: 200, body: '{"hello":"ctx"}', contentType: 'application/json' }));
  const p = await ctx.newPage();
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.waitForFunction(`document.getElementById('api-target').textContent.includes(':')`, { timeout: 5000 }).catch(() => {});
  check('context-level route', (await p.text('#api-target')) === 'api:ctx', await p.text('#api-target'));
  await ctx.close();
});

await soft('baseURL', async () => {
  const ctx = await b.newContext({ baseURL: S });
  const p = await ctx.newPage();
  await p.goto('/page2.html');
  check('baseURL resolution', (await p.title()) === 'Page Two');
  await ctx.close();
});

/* ---------------- getBy* + locator ops ---------------- */
const p = await b.newPage();
await p.goto(`${S}/aria.html`, { waitUntil: 'interactive' });

await soft('getByRole + click', async () => {
  await p.getByRole('button', { name: 'Subscribe' }).click();
  await p.waitForSelector('#role-out');
  return (await p.text('#role-out')) === 'clicked:';
});
await soft('getByLabel + fill', async () => {
  await p.getByLabel('Email address').fill('a@b.c');
  await p.getByRole('button', { name: 'Subscribe' }).click();
  return (await p.text('#role-out')) === 'clicked:a@b.c';
});
await soft('getByPlaceholder', async () => {
  const n = await p.getByPlaceholder('you@example.com').count();
  return n === 1;
});
await soft('getByAltText', async () => {
  const n = await p.getByAltText('Velox logo').count();
  return n === 1;
});
await soft('getByRole heading', async () => {
  const t = await p.getByRole('heading', { name: 'Form test' }).text();
  return t === 'Form test';
});
await soft('getByText', async () => {
  const t = await p.getByText('Email address').count();
  return t >= 1;
});
await soft('testid + testIdAttribute', async () => {
  const n1 = await p.getByTestId('nothing-here').count();
  return n1 === 0;
});
await soft('locator nth/first/last/filter', async () => {
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const items = p.locator('li.item');
  check('nth()', (await items.nth(1).text()) === 'beta');
  check('first()', (await items.first().text()) === 'alpha');
  check('last()', (await items.last().text()) === 'gamma');
  return (await items.count()) === 3;
});
await soft('locator states (check/uncheck)', async () => {
  await p.setContent(`<form>
    <input type="checkbox" id="cb" />
    <input type="text" id="ti" value="x" disabled />
    <select id="sel"><option value="a">A</option><option value="b">B</option></select>
  </form>`);
  const cb = p.locator('#cb');
  await cb.check();
  check('isChecked after check', (await cb.isChecked()) === true);
  await cb.uncheck();
  check('isChecked after uncheck', (await cb.isChecked()) === false);
  check('isDisabled', (await p.locator('#ti').isDisabled()) === true);
  check('selectOption', (await p.locator('#sel').selectOption('b'))[0] === 'b');
  return true;
});
await soft('ariaSnapshot', async () => {
  await p.goto(`${S}/aria.html`, { waitUntil: 'interactive' });
  const snap = await p.getByRole('button').ariaSnapshot();
  check('ariaSnapshot content', String(snap).includes('button "Subscribe"'), JSON.stringify(snap).slice(0, 80));
  const tree = await p.accessibility.snapshot();
  check('accessibility.snapshot tree', !!tree && JSON.stringify(tree).includes('Subscribe'));
  const yaml = await p.accessibility.yaml();
  check('accessibility.yaml', yaml.includes('- button "Subscribe"'));
  return true;
});

/* ---------------- evaluate forms ---------------- */
await soft('evaluate(fn, arg)', async () => {
  const v = await p.evaluate((x) => x.n + 1, { n: 41 });
  return v === 42;
});
await soft('$eval / $$eval', async () => {
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const one = await p.$eval('li.item', (el) => el.textContent);
  const all = await p.$$eval('li.item', (els) => els.map((e) => e.textContent).join(''));
  return one === 'alpha' && all === 'alphabetagamma';
});
await soft('elementHandle', async () => {
  const h = await p.elementHandle('#main-title');
  check('handle text', (await h.text()) === 'Welcome to Velox');
  const box = await h.boundingBox();
  check('handle boundingBox', box && box.width > 10);
  const kids = await p.elementHandles('li.item');
  check('elementHandles count', kids.length === 3);
  await h.dispose();
  return true;
});
await soft('evaluateHandle + jsonValue', async () => {
  const h = await p.evaluateHandle(() => ({ a: 1, b: [2, 3] }));
  const v = await h.jsonValue();
  await h.dispose();
  return v && v.a === 1 && v.b[1] === 3;
});

/* ---------------- network ---------------- */
await soft('waitForRequest/waitForResponse', async () => {
  const reqP = p.waitForRequest('**/api/data.json', { timeout: 8000 });
  const resP = p.waitForResponse('**/api/data.json', { timeout: 8000 });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  const req = await reqP; const rres = await resP;
  check('waitForRequest', req.url.includes('/api/data.json'));
  check('waitForResponse status', rres.response?.status === 200);
  return true;
});
await soft('route.fetch passthrough', async () => {
  await p.route('**/api/data.json', async (req) => {
    const real = await req.fetch();
    await req.fulfill({ status: 200, body: real.body.replace('world', 'proxied'), contentType: 'application/json' });
  });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.waitForFunction(`document.getElementById('api-target').textContent.includes(':')`, { timeout: 5000 }).catch(() => {});
  await p.wait(1000);
  const finalText = await p.text('#api-target');
  check('route.fetch modify', finalText === 'api:proxied', `text=${JSON.stringify(finalText)} requests=${p.requests().filter(r => r.url.includes('api/data')).length}`);
  await p.unroute('**/api/data.json');
  return true;
});
await soft('setOffline', async () => {
  await p.setOffline(true);
  const nav = await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' }).catch((e) => null);
  const failed = nav === null || nav.status === null;
  await p.setOffline(false);
  const back = await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  check('offline blocks navigation', failed);
  check('back online', back.status === 200);
  return true;
});
await soft('httpCredentials (basic auth)', async () => {
  const ctx = await b.newContext({ httpCredentials: { username: 'user', password: 'pass' } });
  const pa = await ctx.newPage();
  await pa.goto(`${S}/auth.html`, { waitUntil: 'interactive' });
  const t = await pa.text('#authed');
  await ctx.close();
  return t === 'Authenticated!';
});
await soft('APIRequestContext shares cookies', async () => {
  const ctx = await b.newContext();
  const pp = await ctx.newPage();
  await pp.goto(`${S}/setcookie`);
  const r = await ctx.request.get(`${S}/api/data.json`);
  check('api request 200', r.status === 200);
  const echo = await ctx.request.post(`${S}/api/echo`, { data: { hello: 'api' } });
  const echoed = await echo.json();
  check('api post json round-trip', echoed.got.includes('hello'));
  await ctx.close();
  return true;
});
await soft('websocket tracking', async () => {
  // local page triggers no WS; use a synthetic one against a closed port — event still fires on attempt
  const wsP = p.waitForEvent('websocket', { timeout: 8000 }).catch(() => null);
  await p.eval(`new WebSocket('ws://127.0.0.1:9/echo'); undefined`).catch(() => {});
  const ws = await wsP;
  return ws && ws.url.includes('ws://');
});

/* ---------------- workers & SW ---------------- */
await soft('worker events', async () => {
  const workerP = b.waitForEvent('worker', { timeout: 8000 }).catch(() => null);
  await p.goto(`${S}/workers.html`, { waitUntil: 'load' });
  await p.waitForFunction(`document.getElementById('w-out').textContent !== 'none'`, { timeout: 8000 }).catch(() => {});
  const worker = await workerP;
  check('worker event emitted', !!worker && worker.url.includes('/worker.js'), JSON.stringify(worker?.url));
  check('worker ran', (await p.text('#w-out')) === 'worker:ping-pong', await p.text('#w-out'));
  return true;
});
await soft('serviceWorkers block', async () => {
  const ctx = await b.newContext({ serviceWorkers: 'block' });
  const pp = await ctx.newPage();
  const reg = await pp.goto(`${S}/`, { waitUntil: 'interactive' }).then(() =>
    pp.eval(`navigator.serviceWorker.register('/sw.js').then(r => 'ok').catch(e => 'blocked:' + e.message)`)
  ).catch((e) => 'error');
  await ctx.close();
  return String(reg).includes('blocked');
});

/* ---------------- scripts, tags, CSP ---------------- */
await soft('addInitScript / removeInitScript', async () => {
  const id = await p.addInitScript(() => { window.__injected = 'by-velox'; });
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const v1 = await p.eval('window.__injected');
  await p.removeInitScript(id);
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const v2 = await p.eval('window.__injected');
  check('init script applied', v1 === 'by-velox');
  check('init script removed', v2 === undefined);
  return true;
});
await soft('addScriptTag / addStyleTag', async () => {
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  await p.addScriptTag({ content: 'window.tagged = 42' });
  await p.addStyleTag({ content: '#history-check { color: rgb(1,2,3) }' });
  const v = await p.eval('window.tagged');
  const color = await p.eval('getComputedStyle(document.getElementById("history-check")).color');
  check('script tag executed', v === 42);
  check('style tag applied', color === 'rgb(1, 2, 3)', color);
  return true;
});
await soft('bypassCSP', async () => {
  const ctx = await b.newContext({ bypassCSP: true });
  const pp = await ctx.newPage();
  await pp.goto(`${S}/csp.html`, { waitUntil: 'interactive' });
  await pp.addScriptTag({ content: 'window.bypassed = true' });
  const v = await pp.eval('window.bypassed');
  await ctx.close();
  return v === true;
});

/* ---------------- interactions ---------------- */
await soft('dragAndDrop', async () => {
  await p.goto(`${S}/drag.html`, { waitUntil: 'interactive' });
  await p.dragAndDrop('#draggable', '#dropzone');
  await p.wait(300);
  const r = await p.text('#drag-result');
  return r === 'dropped:mouse' || r === 'dropped:payload', r;
});
await soft('keyboard.insertText', async () => {
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.focus('#user');
  await p.keyboard.insertText('fast!');
  return (await p.val('#user')) === 'fast!';
});
await soft('screenshot mask + animations', async () => {
  const buf = await p.screenshot({ mask: ['h1'], animations: 'disabled', full: true });
  return buf.length > 3000;
});

/* ---------------- downloads ---------------- */
await soft('download object + saveAs', async () => {
  const dlP = p.waitForEvent('download', { timeout: 10000, predicate: (d) => d.suggestedFilename });
  await p.eval(`var a=document.createElement('a');a.href='${S}/download.bin';a.download='payload.bin';document.body.appendChild(a);a.click();undefined`);
  const dl = await dlP;
  const saved = await dl.saveAs(ROOT + 'out/dl-payload.bin');
  const { statSync } = await import('node:fs');
  const size = statSync(saved).size;
  check('download saved size', size === 2048, String(size));
  check('download filename', dl.suggestedFilename === 'payload.bin');
  return true;
});

/* ---------------- clock ---------------- */
await soft('clock fastForward', async () => {
  const ctx = await b.newContext({ clock: true });
  const pp = await ctx.newPage();
  await pp.clock.install({ time: '2024-06-01T10:00:00Z' });
  await pp.goto(`${S}/clock.html`, { waitUntil: 'interactive' });
  const fixed = await pp.text('#clock');
  check('clock fixed time', fixed.startsWith('2024-06-01'), fixed);
  await pp.clock.fastForward(35000);
  const timer = await pp.text('#timer');
  check('clock fastForward fires timers', timer === 'fired', timer);
  await ctx.close();
  return true;
});

/* ---------------- video + coverage + tracing ---------------- */
await soft('video recording (gif)', async () => {
  const pp = await b.newPage();
  await pp.goto(`${S}/`, { waitUntil: 'interactive' });
  await pp.video.start({ path: ROOT + 'out/video.gif', width: 480 });
  await pp.eval('document.body.innerHTML += "<div style=height:900px;background:#369>x</div><div id=vt>done</div>"');
  await pp.scrollBy(0, 400);
  await pp.wait(400);
  await pp.scrollBy(0, 400);
  await pp.wait(400);
  const path = await pp.video.stop();
  const { readFileSync } = await import('node:fs');
  const head = readFileSync(path).subarray(0, 6).toString('latin1');
  check('gif magic', head === 'GIF89a', head);
  const size = readFileSync(path).length;
  check('gif has frames', size > 2000, `${size} bytes`);
  await pp.close();
  return true;
});
await soft('JS coverage', async () => {
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await p.coverage.startJSCoverage();
  await p.reload();
  await p.wait(500);
  const cov = await p.coverage.stopJSCoverage();
  check('coverage entries', cov.length >= 1 && cov[0].functions.length >= 1, JSON.stringify(cov.map((c) => c.url.slice(-20))));
  return true;
});
await soft('tracing', async () => {
  const ctx = b.defaultContext();
  await ctx.startTracing({ screenshots: true });
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  const trace = await ctx.stopTracing(ROOT + 'out/trace.json');
  check('trace events', trace.traceEvents.length > 10, String(trace.traceEvents.length));
  const { readFileSync } = await import('node:fs');
  check('trace file', readFileSync(ROOT + 'out/trace.json').length > 1000);
  return true;
});

/* ---------------- expect assertions ---------------- */
await soft('expect(locator) assertions', async () => {
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await expect(p.locator('#main-title')).toBeVisible();
  await expect(p.locator('#main-title')).toHaveText('Welcome to Velox');
  await expect(p.locator('li.item')).toHaveCount(3);
  await expect(p).not.toHaveTitle('Wrong');
  check('expect assertions pass', true);
  let threw = false;
  await expect(p.locator('#main-title')).toHaveText('Nope', { timeout: 400 }).catch(() => threw = true);
  check('expect failure throws', threw);
  return true;
});

/* ---------------- persistent context ---------------- */
await soft('launchPersistentContext', async () => {
  const dir = ROOT + 'out/profile';
  const ctx = await velox.launchPersistentContext(dir, { executablePath: EXE, headless: true });
  const pp = await ctx.newPage();
  await pp.goto(`${S}/setcookie`);
  const c1 = await ctx.cookies();
  await pp.wait(800); // let the profile flush to disk
  await ctx.browser.close();
  const ctx2 = await velox.launchPersistentContext(dir, { executablePath: EXE, headless: true });
  const pp2 = await ctx2.newPage();
  await pp2.goto(`${S}/`);
  const c2 = await ctx2.cookies();
  check('persistent profile keeps cookies', c1.some((c) => c.name === 'fromserver') && c2.some((c) => c.name === 'fromserver'), JSON.stringify([c1.length, c2.length]));
  await ctx2.browser.close();
  return true;
});

await b.close();
site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
