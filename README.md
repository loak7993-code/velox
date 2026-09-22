<div align="center">

# ⚡ velox

**Browser automation at terminal velocity.**

Zero dependencies · Any Chromium-family browser · Or no browser at all

`npm i velox` *(Node ≥ 20 — no postinstall, no downloads, nothing bundled)*

</div>

---

## Why

Every mainstream automation tool drags a browser into your process whether the
page needs one or not. Velox takes the other road:

| | playwright | puppeteer | **velox** |
|---|---|---|---|
| dependencies | 50+ (incl. bundled browser download) | 10+ | **0** |
| browser required | always | always | **only when the page needs JS** |
| default transport | pipe | ws | **pipe** (+ ws for remote) |
| selector round-trips per action | 1–3 | 1–3 | **exactly 1** |
| batch extract (3 els), median | 27 ms | — | **1 ms** |
| works with installed browsers | its own only | its own only | **Chrome, Chromium, Edge, Brave, Vivaldi, Opera, chrome-headless-shell…** |

Measured on the same binary, same machine, 12 runs — run `npm run bench` yourself.

## Install

```bash
npm i velox          # that's it. no browser download, no postinstall
```

Velox drives whatever Chromium-family browser is already on the machine
(`vlx detect` lists what it found), or any remote CDP endpoint, and for pages
that don't need JavaScript it doesn't start a browser at all.

## The 30-second tour

```js
import velox from 'velox';

// ── auto engine: pure HTTP for static pages, browser only when JS is needed
const page = await velox.open('https://example.com');
console.log(page.engine);              // 'lite'  ← no browser was launched
console.log(await page.text('h1'));    // "Example Domain"

// browser-only ops upgrade transparently (cookies carry over)
const png = await page.screenshot({ full: true });
console.log(page.engine);              // 'cdp'   ← browser spun up on demand
await page.close();

// ── full power mode: any installed browser
const browser = await velox.launch();            // finds Chrome/Edge/Brave/...
const p = await browser.newPage({ stealth: true, ads: true });

await p.goto('https://news.ycombinator.com');
const stories = await p.extract('tr.athing', {          // ONE round-trip
  text: true,
  attrs: ['id'],
});
const titles = await p.texts('.titleline > a');         // one more
await browser.close();
```

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                      velox.open()                      │
│                                                        │
│   engine: auto        engine: lite       engine: cdp   │
│   ┌───────────┐       ┌───────────┐     ┌───────────┐  │
│   │ fetch HTML│──static──▶ lite DOM │     │  browser  │  │
│   │ needs JS? │       │ (own parser)│    │ any CDP   │  │
│   └────┬──────┘       └───────────┘     │  binary   │  │
│        │ JS needed / browser op          └────▲──────┘  │
│        └──────────── escalate ────────────────┘         │
└────────────────────────────────────────────────────────┘
```

**Why it's fast**

1. **In-page engine.** A tiny selector/wait core is injected once per document.
   Finding, waiting, extracting, scrolling, and click-pointing all run *inside*
   the page — every action is a single pre-serialized `Runtime.evaluate`, not a
   protocol conversation.
2. **MutationObserver waits.** No polling over the wire; elements appear as the
   DOM mutates. Waiting for a node that shows up after 700 ms: **537 ms vs
   Playwright's 802 ms**.
3. **CDP over pipes** (`--remote-debugging-pipe`) by default — lower latency
   than WebSocket; falls back automatically; `connect()` uses WebSocket for
   remote endpoints.
4. **Sync evaluation** for all data reads (`awaitPromise: false` — the engine
   never returns promises), pipelined domain setup, lazy body fetching.
5. **The lite engine.** A from-scratch HTTP/1.1 client with keep-alive,
   gzip/brotli, redirects and a cookie jar, plus a from-scratch HTML parser with
   a CSS-subset selector engine. Static pages cost **~2 ms and zero
   megabytes**.
6. **Browser-native blocking.** `ads: true` maps to
   `Network.setBlockedURLs` — trackers die inside the network stack, your page
   loads faster and lighter.

## Feature map

**Engines** auto (fetch → escalate) · lite (never launches) · cdp (always browser) · remote `connect('ws://…' | 'host:port')` · browser auto-discovery (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Thorium, chrome-headless-shell, Linux/macOS/Windows) · `VELOX_BROWSER` env override

**Pages** `goto` with `none / interactive / load / networkidle / settle` · history back/forward · `setContent` · popups (`browser.on('popup')`) · multi-tab · isolated browser contexts · frame tree · same-origin iframe scoping (`page.inFrame('#comments')`) · OOPIF auto-attach

**Selectors** `css` · `text=` `text*=` `text^=` `text$=` (case-insensitive) · `xpath=` · `id=` · `tag=` · `nth=` · `:visible` · `:has-text("…")` · chaining with `>>` pierces **shadow roots and same-origin iframes** · zero-handle Locators (always fresh, never stale) · `extract()` batch: N elements × M fields in **one** round-trip

**Waiting** `waitForSelector` (MutationObserver, navigation-proof) · `waitForFunction` · `waitForUrl` · `waitForLoad` · network-idle with 500 ms quiet window

**Input** trusted mouse (click/dblclick/right/modifiers/wheel) · `humanMove` bezier cursor paths · trusted keyboard with per-char timing and `human` jitter · `fill` fast-path (value + input/change events) · touch tap/swipe · drag via mouse down/move/up · file upload · dialog auto-handling (`accept`/`dismiss`/`promptText`) with listener override

**Network** full request/response capture (headers, POST bodies, timing, IPs, protocol, redirect chains) · lazy body fetch · HAR 1.2 export · `route()` interception with fulfill/abort/continue+override · `mock()` one-liner · `block()` browser-native URL blocking · built-in ad/tracker blocklist (`ads: true`) · extra headers · per-page routes from launch options

**Sessions & storage** cookies get/set/serialize · localStorage + sessionStorage snapshot/restore · `saveSession()/loadSession()` portable JSON sessions · lite→browser cookie hand-off on escalation

**Capture** viewport / full-page / element screenshots (png/jpeg, `fast` mode) · PDF (paper sizes, margins, headers/footers, CSS page size) · `readable()` markdown-ish text extraction · console + page-error logs

**Stealth** (best-effort, injected before page scripts) `navigator.webdriver` · languages · plugins/mimeTypes · `window.chrome.runtime/app/csi/loadTimes` · permissions · WebGL vendor/renderer · hardwareConcurrency/deviceMemory/platform · iframe contentWindow · battery · connection

**Emulation** device presets (`iphone_13/15/se`, `ipad`, `pixel_8`, `galaxy_s24`, `desktop`, `mac`, `bot`) · viewport/DPR/mobile · UA + platform · locale · timezone · geolocation (with permission grant) · color scheme · reduced motion · touch

**Scale** `Pool` — pre-warmed browser/page pool with `use()` and `map(items, fn, {concurrency})` · parallel lite fetches need no pool at all

**Misc** `expose(name, fn)` Node→page bindings · downloads with progress (`allowAndName`) · retries/timeouts/AbortSignal-friendly · TypeScript definitions · ESM

## CLI

```bash
vlx detect                                # browsers found on this machine
vlx open  https://example.com             # readable text (auto engine)
vlx open  example.com --sel 'h2'          # specific elements
vlx open  example.com --json              # structured
vlx shot  example.com --full -o page.png  # full-page screenshot
vlx shot  example.com --sel '#chart' -o c.png
vlx pdf   example.com -o page.pdf
vlx links example.com --json
vlx scrape example.com --recipe tables --json
vlx eval  example.com "document.title"
vlx save-session example.com s.json       # cookies + storage
vlx load-session example.com s.json
vlx bench example.com                     # lite vs browser timings

# flags: --engine auto|lite|cdp · --js · --browser PATH · --stealth · --ads
#        --device iphone_15 · --ua · --proxy socks5://… · --header "K: V"
#        --cookie "a=b" · --viewport 1920x1080 · --wait SEL · --timeout ms
```

## API cheat-sheet

```js
const browser = await velox.launch({ headless: true, browser: 'auto', proxy: { server, username, password } });
const page    = await browser.newPage({ stealth, ads, device, ua, locale, timezone, viewport, headers, blockUrls, routes, initScripts, dialogs, geolocation, colorScheme, isolated });
await page.goto(url, { waitUntil: 'interactive', timeout: 30000, referer });

// data — every call is one round-trip
page.title() / page.url() / page.content()
page.text(sel) / page.attr(sel, name) / page.html(sel) / page.count(sel)
page.extract(sel, { text, attrs: ['href'], html, tag, limit })   // ← workhorse
page.links() / page.images() / page.tables() / page.forms() / page.meta() / page.jsonld()
page.readable()                    // markdown-ish main content

// locators — zero-handle, always live
const h1 = page.$('h1');
await h1.waitFor({ timeout: 5000 });
await h1.click(); await h1.type('hi', { human: true });

// actions
await page.click(sel, { clicks: 2, modifiers: ['ctrl'] });
await page.type(sel, text, { delay: 20, human: true });
await page.fill(sel, value);           // fast untrusted fill
await page.press('Enter'); await page.mouse.humanMove(x, y);

// network
page.on('response', (e) => e.response.status);
page.route('**/api/**', (req) => req.fulfill({ body: '[]' }));
page.mock('**/stats', { status: 204 });
await page.block(['doubleclick.net', '*hotjar.com']);
const har = await page.har({ withBodies: true });

// sessions
await page.setCookies([{ name: 'a', value: 'b', url }]);
await page.saveSession('s.json'); await page.loadSession('s.json');

// frames & shadow dom
await page.text('#host >> button.cta');          // pierce shadow root
await page.inFrame('#comments').text('.c-body'); // same-origin iframe

// bindings & events
await page.expose('sum', (a, b) => a + b);       // page: await window.sum(1, 2)
page.on('console' | 'pageerror' | 'dialog' | 'download' | 'popup', fn);

// pool
const pool = new velox.Pool({ browsers: 4, pagesPerBrowser: 4, pageOpts: { ads: true } });
await pool.map(urls, (u, page) => page.goto(u).then(() => page.title()), { concurrency: 16 });
```

## Benchmarks

Same binary (chrome-headless-shell 154), same box, 12 runs, medians:

```
⚡ browser launch                  velox   66ms  |  playwright   71ms   1.08×
⚡ goto + DOMContentLoaded         velox   22ms  |  playwright   23ms   1.05×
⚡ 10× title()                     velox   18ms  |  playwright   26ms   1.44×
⚡ batch extract (3 els)           velox    1ms  |  playwright   27ms  27.00×
⚡ fill + click + submit           velox   48ms  |  playwright   80ms   1.67×
⚡ waitForSelector (700ms delay)   velox  632ms  |  playwright  788ms   1.25×
=  full-page screenshot            velox   51ms  |  playwright   48ms   0.94×
⚡ second navigation               velox   14ms  |  playwright   40ms   2.86×
⚡ browser close                   velox    4ms  |  playwright   33ms   8.25×
🚀 lite engine (no browser)        page fetch 1–2ms · extract ~1ms
```

Reproduce: `node test/bench.js 12` (needs `npm i --no-save playwright-core`).
Run the suite: `npm test`.

## Compatibility notes

- **Browsers:** anything speaking CDP — Chrome/Chromium 111+, Edge, Brave,
  Vivaldi, Opera, Thorium, chrome-headless-shell. `--headless=new` on full
  browsers; headless shells run natively headless. Firefox/Safari are not CDP
  browsers (Firefox dropped CDP; Safari has no CDP) — not supported.
- **Node:** ≥ 20 (native WebSocket; ≥ 22 recommended).
- **Stealth** is best-effort surface patching; dedicated detection stacks can
  still fingerprint headless environments. Combine with a full browser
  (`google-chrome`, not headless-shell) and a real profile for best results.
- **Windows/macOS:** discovery covers standard install paths; CI containers
  work out of the box (auto `--no-sandbox`/`--disable-dev-shm-usage` as root).

## License

MIT
