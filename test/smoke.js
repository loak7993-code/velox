// velox :: smoke test — exercises the full CDP stack against the local test site
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const EXE = '/tmp/opencode/velox/.browsers/chrome-headless-shell-linux64/chrome-headless-shell';
const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond, extra]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};

const { url: SITE } = await startSite();

const b = await velox.launch({ executablePath: EXE, headless: true });
const page = await b.newPage({ ads: true, blockUrls: ['*://*/api/pixel.json'] });

// 1. basic navigation
const nav = await page.goto(SITE, { waitUntil: 'interactive' });
check('goto returns status 200', nav.status === 200, `got ${nav.status}`);
check('title()', (await page.title()) === 'Velox Test Site');

// 2. selectors
check('css selector text', (await page.text('h1')) === 'Welcome to Velox');
check('id= selector', (await page.text('id=main-title')) === 'Welcome to Velox');
check('text= selector', (await page.exists('text=Late content')) === false);
check('count()', (await page.count('li.item')) === 3);
check('extract batch', (await page.extract('li.item', { text: true })).map((x) => x.text).join(',') === 'alpha,beta,gamma');
check('attr()', (await page.attr('a', 'href')) === '/page2.html');

// 3. auto-wait (content appears after 700ms)
const t0 = Date.now();
await page.waitForSelector('#late', { timeout: 5000 });
check('waitForSelector (delayed node)', await page.text('#late') === 'Late content has arrived', `waited ${Date.now() - t0}ms`);

// 4. shadow DOM piercing
check('shadow pierce (>>)', (await page.text('#host >> .cta')) === 'Shadow Button');
await page.click('#host >> .cta');
await page.waitForSelector('#shadow-result', { timeout: 3000 });
check('click through shadow root', (await page.text('#shadow-result')) === 'clicked through shadow root');

// 5. typing (trusted keyboard events)
await page.type('#user', 'velox', { delay: 5 });
await page.click('#go');
await page.waitForFunction(`document.title.startsWith('submitted:')`, { timeout: 3000 });
check('type + submit', (await page.title()) === 'submitted:velox', await page.title());

// 6. fill fast path
await page.fill('#pass', 'secret123');
check('fill()', (await page.val('#pass')) === 'secret123');

// 7. same-origin iframe
const framed = page.inFrame('#frame');
check('iframe scoping', (await framed.text('#in-frame')) === 'inside the iframe');

// 8. structured extraction
check('tables()', (await page.tables())[0].rows.length === 2);
check('forms()', (await page.forms())[0].fields.length >= 3);
check('meta()', (await page.meta()).description === 'a page built to exercise velox');
check('jsonld()', (await page.jsonld())[0]['@type'] === 'WebSite');
check('links()', (await page.links()).some((l) => l.href.endsWith('page2.html')));

// 9. network capture + blocked urls
const reqs = page.requests();
check('network capture', reqs.length > 3, `${reqs.length} requests`);
const pixel = reqs.find((r) => r.url.includes('/api/pixel.json'));
check('url blocked (BlockedByClient)', !!pixel && !pixel.response && !!pixel.failed, JSON.stringify({ failed: pixel?.failed, hasResponse: !!pixel?.response }));
const apiReq = reqs.find((r) => r.url.includes('/api/data.json'));
check('api body fetch', apiReq && (await page.body(apiReq)) === '{"hello":"world"}');
check('api rendered in page', (await page.text('#api-target')) === 'api:world');

// 10. screenshot + pdf
const shot = await page.screenshot({ path: '/tmp/opencode/velox/out/shot.png', full: true });
check('screenshot', shot.length > 5000, `${shot.length} bytes`);
const pdf = await page.pdf({ path: '/tmp/opencode/velox/out/shot.pdf' });
check('pdf', pdf.length > 1000, `${pdf.length} bytes`);

// 11. route mocking
await page.route('**/api/data.json', (req) => req.fulfill({ status: 200, body: '{"hello":"mocked"}', contentType: 'application/json' }));
await page.reload();
await page.waitForSelector('#api-target', { timeout: 5000 });
await page.waitForFunction(`document.getElementById('api-target').textContent.includes(':')`, { timeout: 3000 });
check('route mock fulfill', (await page.text('#api-target')) === 'api:mocked', await page.text('#api-target'));

// 12. dialog auto-handling
await page.goto(`data:text/html,<script>confirm("ok?")</script><p id=after>dialogs survived</p>`, { waitUntil: 'interactive' });
check('dialog auto-accept', (await page.text('#after')) === 'dialogs survived');

// 13. expose binding
await page.expose('addNumbers', (a, b) => a + b);
const sum = await page.eval('window.addNumbers(19, 23)');
check('expose binding', sum === 42, `got ${sum}`);

// back to a real origin for cookie/storage tests
await page.goto(SITE, { waitUntil: 'interactive' });

// 14. cookies
await page.setCookies([{ name: 'flavor', value: 'mint', url: SITE }]);
check('cookies', (await page.cookies()).some((c) => c.name === 'flavor' && c.value === 'mint'));

// 15. session save/load
const sess = await page.saveSession('/tmp/opencode/velox/out/session.json');
check('saveSession', sess.cookies.length > 0);

// 16. localStorage
await page.eval('localStorage.setItem("k","v")');
check('localStorage', (await page.localStorage()).local.k === 'v');

// 17. emulation
await page.emulate('iphone_15');
check('device emulation', (await page.eval('navigator.userAgent')).includes('iPhone'));
await page.emulate('desktop');

// 18. stealth
const page2 = await b.newPage({ stealth: true });
await page2.goto(`${SITE}/`, { waitUntil: 'interactive' });
check('stealth: webdriver undefined', (await page2.eval('navigator.webdriver')) === undefined);
check('stealth: languages', JSON.stringify(await page2.eval('navigator.languages')) === '["en-US","en"]');
check('stealth: plugins length', (await page2.eval('navigator.plugins.length')) === 5);
await page2.close();

// 19. popups
// (link with target=_blank)
await page.setContent(`<a id="pop" href="${SITE}/page2.html" target="_blank">open</a>`);
const popupPromise = new Promise((resolve) => b.once('popup', resolve));
await page.click('#pop');
const popup = await popupPromise;
await popup.waitForSelector('#history-check', { timeout: 8000 }).catch(() => {});
check('popup captured', (await popup.title()) === 'Page Two', await popup.title().catch?.(() => '?') || '');

// 20. HAR
const har = await page.har({ withBodies: false });
check('har export', har.log.entries.length > 3, `${har.log.entries.length} entries`);

await b.close();

const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
