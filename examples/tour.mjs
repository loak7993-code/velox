// velox :: examples — every feature in one runnable tour
// node examples/tour.mjs
import velox from '../src/index.js';

const EXE = process.env.VELOX_BROWSER; // any Chromium-family browser; omit to auto-detect
const DEMO = 'https://example.com';

// ── 1. the auto engine: no browser unless the page needs JS ─────────────────
const s = await velox.open(DEMO, { executablePath: EXE });
console.log('engine used:', s.engine);                 // 'lite' — example.com is static
console.log('title:', await s.title());
console.log('h1:', await s.text('h1'));
console.log('links:', (await s.links()).length);

// ── 2. transparent escalation: browser-only ops upgrade automatically ───────
const shot = await s.screenshot({ full: true });       // spins a browser here
console.log('after screenshot, engine:', s.engine);    // 'cdp'
await s.close();

// ── 3. launch any installed browser ──────────────────────────────────────────
const b = await velox.launch({ executablePath: EXE, headless: true });
const p = await b.newPage({
  stealth: true,          // anti-fingerprint patches
  ads: true,              // block ad/tracker domains at the browser level
  device: 'iphone_15',    // device emulation
  blockUrls: ['*hotjar.com', '*doubleclick.net'],
});

// ── 4. network: capture, mock, route, HAR ───────────────────────────────────
p.route('**/api/**', (req) => req.fulfill({ status: 200, body: '{"n":42}', contentType: 'application/json' }));
p.on('response', (e) => { if (e.response) console.log('   net:', e.response.status, e.url.slice(0, 60)); });

await p.goto(DEMO, { waitUntil: 'load' });
console.log('ua:', await p.eval('navigator.userAgent'));
console.log('webdriver:', await p.eval('navigator.webdriver'));

// ── 5. selectors: css / text= / xpath= / id= / tag= / >> shadow pierce ──────
console.log('h1:', await p.text('h1'));
console.log('by text:', await p.text('text=More information'));
console.log('batch:', await p.extract('a', { text: true, attrs: ['href'] }));

// ── 6. human-like input ──────────────────────────────────────────────────────
await p.mouse.humanMove(400, 300);
await p.keyboard.type('hello', { human: true });

// ── 7. expose Node functions to the page ────────────────────────────────────
await p.expose('sum', (a, b) => a + b);
console.log('binding:', await p.eval('window.sum(20, 22)'));

// ── 8. session persistence ───────────────────────────────────────────────────
await p.setCookies([{ name: 'seen', value: 'yes', url: DEMO }]);
await p.saveSession('examples/session.json');

// ── 9. pdf + screenshots ─────────────────────────────────────────────────────
await p.screenshot({ path: 'examples/full.png', full: true });
await p.pdf({ path: 'examples/page.pdf' });
console.log('artifacts written');

// ── 10. parallel pool ────────────────────────────────────────────────────────
const pool = new velox.Pool({ browsers: 2, pagesPerBrowser: 2, launch: { executablePath: EXE } });
const pages = ['https://example.com', 'https://example.com/?a=1', 'https://example.com/?a=2', 'https://example.com/?a=3'];
const results = await pool.map(pages, async (url, page) => {
  await page.goto(url, { waitUntil: 'interactive' });
  return page.title();
}, { concurrency: 4 });
console.log('pool results:', results);
await pool.close();

await b.close();
console.log('\ntour complete ✦');
