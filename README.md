<div align="center">

<img src="https://raw.githubusercontent.com/loak7993-code/velox/main/assets/banner.png" alt="velox — browser automation at terminal velocity" width="900">

[![npm](https://img.shields.io/npm/v/velox-automation?label=npm&color=cb3837)](https://www.npmjs.com/package/velox-automation)
[![tests](https://img.shields.io/badge/tests-250%2F250-brightgreen)](https://github.com/loak7993-code/velox/actions)
[![tests](https://img.shields.io/badge/tests-146%2F146-brightgreen)](#testing)
[![dependencies](https://img.shields.io/badge/dependencies-0-blue)](#why-velox-exists)
[![node](https://img.shields.io/badge/node-%E2%89%A520-green)](#installation)
[![license](https://img.shields.io/badge/license-MIT-black)](LICENSE)

**Works with Chrome, Chromium, Edge, Brave, Vivaldi, Opera, chrome-headless-shell —
or skips the browser entirely when a page doesn't need one.**

</div>

---

## Why velox exists

Every mainstream automation stack makes the same two mistakes: it downloads its
own browser whether you need one or not, and it drags dozens of dependencies
along for the ride. Velox is a from-scratch rethink (no Playwright/Puppeteer
code, zero npm dependencies, ~6.5k lines):

| | playwright | puppeteer | **velox** |
|---|:---:|:---:|:---:|
| npm dependencies | 50+ | 10+ | **0** |
| downloads a browser on install | ~300 MB | ~150 MB | **never** |
| static pages launch a browser | always | always | **no — pure HTTP (~2 ms)** |
| works with your installed browsers | its own build only | its own build only | **any CDP browser** |
| default transport | pipe | websocket | **pipe** (+ ws for remote) |
| round-trips per selector action | 1–3 | 1–3 | **exactly 1** |
| batch extract, 3 elements (median) | 26 ms | — | **1 ms** |
| bundle size | megabytes | megabytes | **~180 KB source** |

The speed comes from architecture, not micro-optimization — see
[how it works](#how-it-works).

---

## The 60-second tour

```js
import velox from 'velox-automation';

// ① Open a URL. No browser launches unless the page needs JavaScript.
const page = await velox.open('https://example.com');

console.log(page.engine);            // 'lite' — pure HTTP fetch + our own HTML parser
console.log(await page.text('h1'));  // "Example Domain"

// ② Browser-only operations escalate transparently (cookies carry over).
const png = await page.screenshot({ full: true });
console.log(page.engine);            // 'cdp' — a browser spun up on demand
await page.close();

// ③ Full power mode: your installed Chrome/Edge/Brave, full Playwright surface.
const browser = await velox.launch();            // auto-discovers any CDP browser
const p = await browser.newPage({ stealth: true, ads: true });

await p.goto('https://news.ycombinator.com');
const titles = await p.extract('.titleline > a', { text: true });  // ONE round-trip
await p.getByRole('link', { name: 'More' }).click();
await browser.close();
```

## Installation

```bash
npm i velox-automation          # https://www.npmjs.com/package/velox-automation
# or straight from the repo
npm i github:loak7993-code/velox
```

Published package: **[`velox-automation`](https://www.npmjs.com/package/velox-automation)** — 146 kB packed, no install scripts, no dependencies.

Node ≥ 20 (22+ recommended — uses the native `WebSocket`). No postinstall, no
browser download. Velox finds what's already on the machine:

```bash
npx vlx detect          # lists every Chromium-family browser it can drive
```

…or pin one with `VELOX_BROWSER=/path/to/chrome`, the `executablePath` option,
or connect remote: `velox.connect('ws://browser-host:3000')`.

---

## How it works

```
                        velox.open(url)
                              │
              ┌───────────────┴───────────────┐
              │        engine: 'auto'          │
              ▼                               ▼
     ┌─────────────────┐            ┌──────────────────┐
     │  fetch HTML     │  static?   │   CDP browser    │
     │  (own HTTP/1.1, │───────────▶│ any binary,      │
     │  keep-alive,br, │            │ pipe transport   │
     │  cookie jar)    │  needs JS? │ in-page engine   │
     └─────────────────┘───────────▶└──────────────────┘
              ▲                               ▲
      engine: 'lite'                  engine: 'cdp'
   (never a browser)          (or forced with --js)
```

1. **In-page engine.** A ~8 KB selector/wait core is injected once per document.
   Finding, waiting, extracting, click-pointing — all execute *inside the page*.
   Every action is exactly one pre-serialized `Runtime.evaluate`. No protocol
   conversations, no stale handles.
2. **MutationObserver waits.** Elements resolve the instant the DOM mutates —
   no polling over the wire. Waiting on a node that appears after 700 ms:
   **635 ms vs Playwright's 787 ms.**
3. **CDP over stdio pipes** (`--remote-debugging-pipe`) — lower per-command
   latency than WebSocket. Automatic fallback; `connect()` uses WebSocket.
4. **The lite engine.** A from-scratch HTTP client (keep-alive, gzip/brotli,
   redirects, cookie jar) plus a from-scratch HTML parser with CSS-subset
   selectors. Static pages cost **~2 ms and zero browser processes**.
5. **Browser-native blocking.** `ads: true` maps to `Network.setBlockedURLs` —
   trackers die inside the network stack, pages load lighter and faster.
6. **Zero handles, zero staleness.** Locators re-resolve on every call —
   elements are always current, never detached, never leaked.

### Benchmarks

Same binary (chrome-headless-shell 154), same box, 10 runs, medians —
reproduce with `node test/bench.js 10`:

| operation | velox | playwright-core | |
|---|---:|---:|:---:|
| batch extract (3 elements) | **1 ms** | 26 ms | **26×** |
| second navigation | **13 ms** | 39 ms | **3.0×** |
| fill + click + submit | **45 ms** | 74 ms | **1.64×** |
| 10× `title()` | **18 ms** | 24 ms | **1.33×** |
| waitForSelector (700 ms delay) | **635 ms** | 787 ms | **1.24×** |
| browser close | **26 ms** | 34 ms | **1.31×** |
| browser launch | **66 ms** | 70 ms | 1.06× |
| goto + DOMContentLoaded | **21 ms** | 22 ms | 1.05× |
| full-page screenshot | 56 ms | **49 ms** | 0.88× |
| **lite engine** (no browser at all) | **~2 ms/page** | — | — |

---

## Feature tour

### The auto engine

```js
velox.open(url);                       // auto: HTTP first, browser only if JS is needed
velox.open(url, { engine: 'lite' });   // never launches a browser
velox.open(url, { engine: 'cdp' });    // always a browser
velox.open(url, { js: true });         // force the browser path
```

Escalation heuristics: SPA shells (`<div id="root">` + scripts, no SSR state),
challenge pages, empty-body + heavy-script pages, meta-refresh loops. Calling a
browser-only op (`click`, `screenshot`, `eval`, …) on a lite session upgrades it
**transparently, with cookie state carried over**.

### Selectors

One syntax everywhere — `page`, locators, `block()`, the CLI:

| selector | matches |
|---|---|
| `div.card > a` | plain CSS (default) |
| `text=Sign in` · `text*=sign` · `text^=Sign` · `text$=in` · `text==Exact` | text (substring CI / anchored / exact) |
| `role=button` · `role=button@Sign in` · `role=button@=Exact` | ARIA role + accessible name |
| `label=Email` · `placeholder=Search` · `alt=Logo` · `title=Close` | form labeling semantics |
| `testid=submit` | `data-testid` (configurable via `testIdAttribute`) |
| `xpath=//a[@href]` · `id=main` · `tag=div` · `nth=3` | the classics |
| `#host >> button.cta` | **`>>` pierces shadow roots and same-origin iframes** |
| `button:visible` · `a:has-text("read more")` | filters |

### Locators — the full Playwright surface

```js
const btn = p.getByRole('button', { name: 'Subscribe' });
const row = p.getByTestId('row-7').filter({ hasText: 'velox' });

await btn.click();                       // trusted mouse input, auto-waited
await p.getByLabel('Email').fill('a@b.c');
await p.locator('#agree').check();
await p.locator('#country').selectOption({ label: 'Chile' });
await p.locator('li').nth(2).dragTo('#bin');

await row.isVisible();                   // …isChecked/isDisabled/isEditable/isHidden
await row.boundingBox();                 // …text/attr/html/val/count/allTextContents
await row.ariaSnapshot();                // '- button "Subscribe"'
```

`first() / last() / nth(i) / filter({hasText, has}) / all() / locator(sel)` —
every method is one fresh round-trip; nothing goes stale.

### Network

```js
// capture (headers, POST bodies, timing, IPs, redirect chains)
p.on('response', (e) => console.log(e.response.status, e.url));

// intercept & mock
p.route('**/api/**', (req) => req.fulfill({ body: '{"n":42}', contentType: 'application/json' }));
p.mock('**/stats', { status: 204 });

// inspect-then-modify through the real server
p.route('**/api/data', async (req) => {
  const real = await req.fetch();               // server-side fetch w/ page cookies
  req.fulfill({ body: real.body.replace('world', 'proxied') });
});

// block at the network stack + HAR export
await p.block(['doubleclick.net', '*hotjar.com']);
const har = await p.har({ withBodies: true });

// offline / throttling / basic auth
await p.setOffline(true);
await p.emulateNetwork({ latency: 200, downloadThroughput: 1.5 * 1024 * 1024 });
const ctx = await browser.newContext({ httpCredentials: { username, password } });

// wait for traffic
const [req] = await Promise.all([p.waitForRequest('**/api/x'), p.click('#go')]);
```

`page.on('websocket')` tracks WS frames/headers/close; `page.on('worker')` and
`browser.on('serviceworker')` cover web + service workers.

### Contexts & sessions

```js
const ctx = await browser.newContext({           // isolated cookie world
  baseURL: 'https://api.example.com',
  storageState: 'state.json',                    // Playwright-format state
  httpCredentials: { username: 'u', password: 'p' },
  serviceWorkers: 'block', bypassCSP: true,
  testIdAttribute: 'data-test',
});

await ctx.storageState('state.json');            // save cookies + localStorage
const r = await ctx.request.post('/login', { data: { user, pass } });  // shares the cookie jar
await ctx.close();

// persistent profile: logins & extensions survive restarts
const profile = await velox.launchPersistentContext('./my-profile');
```

### Emulation & stealth

```js
await p.emulate('iphone_15');                    // 10 device presets
await p.setGeolocation({ latitude: -33.86, longitude: 151.20 });
await p.emulateMedia({ colorScheme: 'dark', media: 'print' });
await p.clock.setFixedTime('2024-06-01T10:00:00Z');
await p.clock.fastForward(60_000);               // virtual timers fire instantly

const s = await b.newPage({ stealth: true });    // webdriver, WebGL, plugins,
                                                 // chrome.runtime, languages, …
```

### Capture

```js
await p.screenshot({ full: true, mask: ['#ad'], animations: 'disabled' });
await p.pdf({ format: 'A4', margin: { top: 0.5 } });
await p.video.start({ path: 'rec.gif' });  await p.wait(500);
const gif = await p.video.stop();                // animated GIF, own encoder
await p.accessibility.yaml();                    // aria tree
await p.coverage.startJSCoverage();  /* … */ await p.coverage.stopJSCoverage();
const ctx2 = b.defaultContext();
await ctx2.startTracing({ screenshots: true });  // chrome://tracing-loadable
await ctx2.stopTracing('trace.json');
```

Video uses a from-scratch pipeline — PNG decode → median-cut palette → LZW —
because a zero-dependency library shouldn't need ffmpeg.

### Scaling

```js
const pool = new velox.Pool({ browsers: 4, pagesPerBrowser: 4, pageOpts: { ads: true } });
const titles = await pool.map(urls, (u, page) =>
  page.goto(u, { waitUntil: 'interactive' }).then(() => page.title()),
  { concurrency: 16 });
await pool.close();
```

Static pages never touch the pool — the auto engine fetches them in-process.

### Assertions

```js
import { expect } from 'velox-automation';

await expect(p.getByRole('heading')).toHaveText('Example Domain');
await expect(p.locator('li')).toHaveCount(3);
await expect(p).not.toHaveTitle('Wrong');
// toBeVisible/Hidden/Enabled/Disabled/Checked/Editable,
// toContainText/toHaveValue/toHaveAttribute/toHaveURL/toHaveCookie
```

Polling assertions with `.not` — pair them with any test runner.

---

### Speed controls

```js
// independent actions over ONE pipelined flush instead of one round-trip each
await page.batch([['fill', '#user', 'a'], ['fill', '#pw', 'b'], ['click', '#go'], ['text', '.welcome']]);   // 4× faster

// static pages in parallel, no browser at all
const pages = await velox.fetchAll(urls, { concurrency: 16 });        // 11× faster than sequential

// pre-parse selectors the page will keep using (hot scraping loops)
await page.warm(['.product', '.product .price', 'a.next']);
```

| knob | effect |
|---|---|
| `page.batch(actions)` | 5 independent actions: **8 ms → 2 ms (4×)** |
| `velox.fetchAll(urls, {concurrency})` | 24 latency-bound pages: **987 ms → 90 ms (11×)** |
| `page.warm(selectors)` | in-page parse cache; long selector chains also went O(n²) → O(n) |
| `newPage({ capture: false })` | skips the Network domain entirely — lighter page + faster loads, no request log |
| `velox.config({ timeout })` | one default for every action; override per page with `page.setDefaultTimeout(ms)` |

### Bandwidth

Most automation bandwidth is spent on bytes you never read. velox makes that a
first-class, measurable knob — profiles, size caps, third-party filtering and a
conditional-GET cache.

```js
const page = await b.newPage({ bandwidth: 'text-only' });   // documents only
await b.newPage({ bandwidth: 'lean' });                    // also blocks images/fonts/media
await b.newPage({ bandwidth: { block: ['image', 'media'], maxBytes: 1_000_000, blockThirdParty: true } });
await page.setBandwidth('minimal');                        // switch at runtime

const bw = page.transferred();   // { total, byType, blocked, profile } — measured, not estimated
page.on('blocked', (e) => console.log(e.reason, e.url));   // "type:Image", "third-party:Script", "oversize:Media"
```

Measured on a 125-resource test page (`node test/bandwidth.js`):

| profile | transferred | requests blocked | vs full |
|---|---:|---:|---:|
| `full` | 473.8 KB | 0 | — |
| `lean` | **5.6 KB** | 121 | **99% less** |
| `minimal` | **5.6 KB** | 121 | **99% less** |
| `text-only` | **4.8 KB** | 122 | **99% less** |

The browser-free engine is even cheaper — it only ever downloads the document —
and now keeps a **conditional-GET cache** (`ETag`/`Last-Modified`), so re-fetching
an unchanged page costs a **304 round-trip instead of the whole body**:

```js
const cache = velox.createCache({ dir: '.velox-cache' });   // persists across runs
await velox.fetch(url, { cache });                          // 200 + stored
await velox.fetch(url, { cache });                          // 304 → served from disk
cache.stats;                                                // { revalidated, bytesSaved, ... }

await velox.fetch(url, { cache, ttl: 60_000 });             // skip revalidation entirely for 60 s
await velox.fetch(hugeUrl, { maxBytes: 500_000 });          // abort oversized bodies mid-stream
await velox.fetchAll(urls, { cache, concurrency: 16 });     // one cache, no browser
```

CLI: `vlx open <url> --bandwidth text-only --cache-dir .velox-cache`

### Proxies

Real proxy support at every layer — **including the browser-free lite engine**, so a
scrape can rotate exits without ever launching Chrome.

```js
// one-shot checks: status, latency, exit IP
await velox.checkProxy('socks5://user:pass@host:1080');        // → { ok, status, ms, ip }

// lite engine, no browser
await velox.fetch(url, { proxy: 'http://user:pass@host:8080' });
await velox.fetchAll(urls, { proxy: pool.next().toProxy(), concurrency: 10 });

// browsers: launch-level or per-context (isolated cookie jar + its own exit)
const browser = await velox.launch({ proxy: 'http://user:pass@host:8080' });
const ctx = await browser.newContext({ proxy: { server: 'socks5://host:1080', bypass: ['*.internal'] } });

// rotating pool: strategies, sticky sessions, health checks, automatic ejection
const pool = new velox.ProxyPool(proxies, { strategy: 'least-latency', maxFailures: 3, cooldownMs: 60_000 });
await pool.healthCheck({ url: 'https://example.com', ipUrl: 'https://api.ipify.org' });
const proxy = pool.sticky('account-42');                       // same exit for the same key
await pool.withProxy((p) => velox.fetch(url, { proxy: p }));   // retries the next healthy exit
pool.stats();                                                  // per-proxy uses/failures/latency/ejection
```

Supported: `http`, `https`, `socks4`, `socks5`, with inline or explicit credentials
(`user:pass@host`), bypass lists, and proxy auth handled through the CDP auth
challenge (`source: "proxy"`) for browsers plus direct `Proxy-Authorization` for lite.
Or rotate automatically across browsers:

```js
velox.use(velox.plugins.proxyRotate(pool));    // each launch() gets the next exit
```

Verified against a live residential proxy: HTTP + HTTPS (CONNECT/​TLS), rotating exit
IPs, browser + context-level routing, and pool ejection. A from-scratch HTTP+CONNECT
and SOCKS5 proxy server ships in `test/site/proxy.js` so proxying is tested offline too.

### Stability

```js
// retry transient failures (dropped sockets, timeouts)
const page = await velox.open(url, { retries: 2, retryDelay: 300 });

// long-running remote browsers: keep the connection alive across drops
const browser = await velox.connect('ws://remote:9222', { autoReconnect: true });
browser.on('reconnected', ({ attempt }) => console.log('back after', attempt));

await browser.healthy();            // cheap liveness probe
await browser.reconnect();          // manual: re-attaches every existing page object
```

A reconnected browser keeps **the same page objects working** — sessions are
re-attached, init scripts and route interception re-armed — instead of forcing you
to rebuild state. Also: `velox.open` retries only *transient* errors (never a 404),
a dropped CDP link raises a clear error instead of a silent hang, and a sandbox
failure self-heals (see the FAQ).

### Customisation

```js
// global defaults, also loadable from $VELOX_CONFIG (JSON) or VELOX_* env vars
velox.config({ timeout: 20000, engine: 'auto', proxy: 'socks5://host:1080', retries: 1, ads: true });

// plugins: hook any stage of the lifecycle
velox.use({
  name: 'my-plugin',
  pageOptions: (o) => ({ ...o, headers: { ...o.headers, 'x-team': 'scraping' } }),
  onPage: (page) => page.on('pageerror', (e) => console.error(e.text)),
});

// built-in plugins
velox.use(velox.plugins.stealth());
velox.use(velox.plugins.adblock());
velox.use(velox.plugins.blockImages());     // skip images/fonts/media — big speed win
velox.use(velox.plugins.humanize());        // human-ish typing + cursor paths
velox.use(velox.plugins.retry(2));
velox.use(velox.plugins.logger({ requests: true }));
velox.use(velox.plugins.proxyRotate(pool));

// your own selector syntax, evaluated inside the page
await page.addSelectorEngine('priceabove', (value, root) =>
  [...root.querySelectorAll('[data-price]')].filter((el) => +el.dataset.price > +value));
await page.count('priceabove=25');          // works with >> chains, waits and extract too
await page.text('section.box >> priceabove=25');

// your own device preset
velox.registerDevice('pixel_9', { width: 412, height: 915, dsf: 2.6, mobile: true, ua: '…' });
```

CLI:

```bash
vlx check-proxy 'http://user:pass@host:8080' --ip https://api.ipify.org
vlx open example.com --proxy socks5://127.0.0.1:1080 --retries 2
vlx open example.com --config ./velox.json
```

## Coming from Playwright

| Playwright | velox |
|---|---|
| `chromium.launch()` | `velox.launch()` — any installed CDP browser |
| `browser.newContext()` / options | `browser.newContext()` — same options, plus `engine` |
| `context.addInitScript`, `exposeBinding` | same names on context |
| `page.getByRole/Text/Label/…` | identical |
| `page.locator().click/check/selectOption/…` | identical |
| `page.route()` + `route.fulfill/abort/continue` | identical, plus `route.fetch()` |
| `page.request` | `context.request` (shared cookie jar) |
| `page.waitForRequest/Response/LoadState/URL/Function` | identical |
| `page.clock` (install/fastForward/…) | identical semantics |
| `context.storageState()` | identical JSON format — states are portable |
| `page.screenshot({ mask, animations })` | identical |
| `launchPersistentContext()` | `velox.launchPersistentContext(dir, opts)` |
| `page.pdf` / `video` / `coverage` / `accessibility` | identical (video = GIF) |
| `page.evaluateHandle` / `elementHandle` | identical, plus function-form `evaluate(fn, arg)` |
| `expect(locator).toBe…` | `velox.expect()` — same shape |
| Firefox / WebKit engines | ✗ not supported — they don't speak CDP |
| test runner / trace viewer UI / inspector | ✗ out of scope — use any runner |

Migration is mostly find-and-replace; the object model is deliberately aligned.

## CLI

```bash
vlx detect                                # browsers found on this machine
vlx open  https://example.com             # readable text (auto engine)
vlx open  example.com --sel 'h2' --json   # specific elements, structured
vlx shot  example.com --full -o page.png  # full-page screenshot
vlx shot  example.com --sel '#chart' -o c.png
vlx pdf   example.com -o page.pdf
vlx links example.com --json
vlx scrape example.com --recipe tables --json
vlx eval  example.com "document.title"
vlx save-session example.com s.json       # cookies + storage
vlx load-session example.com s.json
vlx bench  example.com                    # lite vs browser timings

# global flags
--engine auto|lite|cdp · --js · --browser PATH · --stealth · --ads
--device iphone_15 · --ua · --locale · --tz · --proxy socks5://…
--header "K: V" · --cookie "a=b" · --viewport 1920x1080
--wait SEL · --timeout ms · --headed
```

---

## API reference

<details>
<summary><b>velox</b> — top level</summary>

| export | |
|---|---|
| `velox.open(url, opts?)` | adaptive session (`engine`, `stealth`, `ads`, `device`, `ua`, `proxy`, `headers`, `routes`, `timeout`, …) |
| `velox.scrape(url, {recipe})` | one-shot scrape: `all, text, links, images, tables, meta, jsonld` |
| `velox.launch(opts?)` | any installed browser (`headless`, `proxy`, `args`, `userDataDir`, `transport`, `timeout`) |
| `velox.launchPersistentContext(dir, opts?)` | real profile |
| `velox.connect(endpoint)` | `ws://…` or `host:port` |
| `velox.detect()` | installed CDP browsers |
| `velox.Pool`, `velox.DEVICES`, `velox.expect`, `velox.parseHtml`, `velox.needsJS` | utilities |

</details>

<details>
<summary><b>Session / Page</b> — navigation, data, actions</summary>

| area | methods |
|---|---|
| navigation | `goto (waitUntil: none/interactive/load/networkidle/settle)`, `reload`, `back`, `forward`, `setContent`, `waitForUrl` |
| data (1 round-trip each) | `title`, `url`, `content`, `text(sel)`, `attr`, `html`, `val`, `count`, `extract` (the workhorse), `texts`, `links`, `images`, `tables`, `forms`, `meta`, `jsonld`, `readable` |
| actions | `click` (position/force/trial), `dblclick`, `hover`, `type` (human jitter), `fill`, `press`, `check/uncheck/setChecked`, `selectOption`, `selectText`, `dragAndDrop`, `scrollBy`, `scrollToBottom` |
| waits | `waitForSelector` (attached/visible/hidden), `waitForFunction`, `waitForLoad`, `waitForRequest/Response/RequestFinished`, `waitForEvent/Dialog/Popup/Download`, `wait` |
| input | `mouse.move/click/wheel/humanMove` (bezier paths), `keyboard.press/type/insertText`, `touch.tap/swipe` |
| network | `route/unroute/mock/block`, `requests()`, `body(entry)`, `har`, `setHeaders`, `setOffline`, `emulateNetwork`, `cookies/setCookies` |
| scripts | `eval` (`fn` or string), `evaluate`, `evaluateHandle`, `elementHandle(s)`, `$eval`, `$$eval`, `addInitScript/removeInitScript`, `addScriptTag/addStyleTag`, `expose(fn)` |
| frames | `frameLocator(sel)`, `frames()`, `inFrame(sel)`, `>> ` selector piercing |
| emulation | `emulate(device)`, `setViewport`, `setUA`, `setLocale`, `setTimezone`, `setGeolocation`, `emulateMedia`, `colorScheme` |
| capture | `screenshot`, `pdf`, `video`, `coverage`, `accessibility`, `clock` |
| sessions | `localStorage`, `saveSession/loadSession`, `cookies` |
| events | `console`, `pageerror`, `dialog`, `request`, `response`, `requestfinished`, `download`, `filechooser`, `websocket`, `worker`, `frame`, `crash`, `close` |

</details>

<details>
<summary><b>Browser & Context</b></summary>

| object | surface |
|---|---|
| `Browser` | `newPage`, `newContext`, `defaultContext`, `pages`, `close`, events `popup/worker/serviceworker/frame/target` |
| `BrowserContext` | `newPage`, `route`, `addInitScript`, `expose`, `cookies`, `storageState`, `grantPermissions`, `setOffline`, `setGeolocation`, `request`, `startTracing/stopTracing`, `newCDPSession`, `close` |
| `Download` | `url`, `suggestedFilename`, `finished()`, `path()`, `saveAs()`, `cancel()` |
| `JSHandle / ElementHandle` | `evaluate`, `jsonValue`, `getProperties`, `click`, `boundingBox`, `$(sel)`, `screenshot` |
| `Pool` | `acquire/release/use/map(items, fn, {concurrency})` |

</details>

<details>
<summary><b>Lite engine</b> — the no-browser path</summary>

| API | |
|---|---|
| `velox.fetch(url, opts?)` | keep-alive HTTP, gzip/brotli/deflate, redirects, cookie jar — returns `{status, headers, text(), json(), doc}` |
| `velox.parseHtml(html)` | from-scratch parser + CSS-subset DOM (`select`, `selectAll`, `text`, `links`, `tables`, `readable`, …) |
| `velox.needsJS(res)` | the escalation heuristics, usable standalone |

</details>

---

## Testing

146 checks across four suites, no CI browser downloads beyond a stock
chrome-headless-shell:

```bash
npm test          # smoke (37) · lite+auto (27) · pool · playwright parity (82)
npm run bench     # head-to-head vs playwright-core, same binary
node examples/tour.mjs
```

CI runs on every push — see the badge above and
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## Honest limitations

- **Firefox and WebKit are not supported.** They don't implement CDP (Firefox
  removed it; Safari never had it). Everything Chrome-family works.
- **Stealth is best-effort** surface patching — dedicated detection stacks can
  still fingerprint a headless environment. Use a full (non-shell) browser and
  a persistent profile for the most realistic footprint.
- **Video records GIF**, not mp4 — the deliberate price of zero dependencies.
- **The lite engine parses HTML, it doesn't run it** — no JS, no client-side
  rendering, no same-origin iframe DOM (the browser engine handles all of that).

## FAQ

<details>
<summary><b>Which browser will velox use?</b></summary>

`vlx detect` shows the candidates. Preference order: Chrome → Chromium → Edge →
Brave → Vivaldi → Opera → headless-shell. Snap-wrapped browsers are
deprioritized when a native binary exists (snap confinement breaks some /tmp
behavior). Pin with `VELOX_BROWSER`, `--browser`, or `executablePath`.
</details>

<details>
<summary><b>Does the auto engine decide wrong sometimes?</b></summary>

Heuristics can be fooled. Force the outcome when you know it:
`velox.open(url, { engine: 'lite' })`, `{ engine: 'cdp' }`, or upgrade any
session manually with `await session.upgrade()`.
</details>

<details>
<summary><b>Running as root, in Docker, on Ubuntu 24.04+ or WSL?</b></summary>

Velox auto-adds `--no-sandbox --disable-gpu --disable-dev-shm-usage` when the
UID is 0. As a normal user on distros that restrict unprivileged namespaces
(Ubuntu 23.10+, some containers), Chrome refuses to start with
`FATAL: No usable sandbox!` — velox detects that and **relaunches with
`--no-sandbox` automatically**. Force it up front with `VELOX_NO_SANDBOX=1`
(or `velox.launch({ noSandbox: true })`) to skip the failed first attempt.
</details>

<details>
<summary><b>How do I pin which browser it uses?</b></summary>

Precedence: `executablePath` option → `browser` option → `VELOX_BROWSER`
environment variable → auto-discovery. So `VELOX_BROWSER=/usr/bin/brave-browser`
works for every `velox.open`/`velox.launch()` call without touching your code.
</details>

<details>
<summary><b>Why is my first navigation status <code>null</code>?</b></summary>

`goto` resolves at `DOMContentLoaded` — the HTTP status arrives with the
response, usually before. With `waitUntil: 'none'` the navigation returns
before the response lands; read `page.status` after, or use `waitUntil: 'load'`.
</details>

<details>
<summary><b>My local proxy sees no traffic to localhost — why?</b></summary>

Chrome bypasses loopback addresses by default (same as Playwright/Puppeteer). To
force local targets through a proxy, add it to the bypass list the Chrome way:

```js
proxy: { server: 'http://127.0.0.1:8080', bypass: ['<-loopback>'] }
```

Remote proxies and remote targets are unaffected.
</details>

<details>
<summary><b>Can I use raw CDP?</b></summary>

Yes: `page.createCDPSession()` (or `context.newCDPSession(page)`) returns the
live session — `send`, `fire`, `waitForEvent`, all pipelined.
</details>

## License

[MIT](LICENSE)
