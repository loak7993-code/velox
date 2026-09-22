// velox :: cdp/context.js — BrowserContext: isolated cookie/profile worlds per browser
import { Emitter } from '../util.js';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { APIRequestContext } from './request.js';

let ctxSeq = 1;

export class BrowserContext extends Emitter {
  constructor(browser, browserContextId, opts = {}) {
    super();
    this.browser = browser;
    this.id = browserContextId;         // null → the default context
    this._opts = opts;
    this._pages = new Set();
    this._routes = [];                  // context-level routes
    this._initScripts = [];             // applied to future pages
    this._exposed = new Map();          // name -> fn, applied to future pages
    this._extraHeaders = null;
    this._testIdAttr = opts.testIdAttribute || 'data-testid';
    this._downloads = new Map();        // guid → Download
    this._closed = false;
    this._request = null;
    this._tracing = null;
    this.cid = 'ctx-' + ctxSeq++;
  }

  pages() { return [...this._pages].filter((p) => !p.isClosed); }

  /** Page defaults merged from context opts. */
  pageDefaults(extra = {}) {
    const o = {
      ...this._opts,
      ...extra,
      routes: { ...Object.fromEntries(this._routes.map((r) => [r.pattern, r.handler])), ...(extra.routes || {}) },
      initScripts: [...(this._opts.initScripts || []), ...this._initScripts, ...(extra.initScripts || [])],
    };
    if (this._extraHeaders) o.headers = { ...this._extraHeaders, ...(o.headers || {}) };
    if (this._testIdAttr) o.testIdAttribute = this._testIdAttr;
    if (this._opts.serviceWorkers) o.serviceWorkers = this._opts.serviceWorkers;
    if (this._opts.httpCredentials) o.httpCredentials = this._opts.httpCredentials;
    if (this._opts.bypassCSP) o.bypassCSP = true;
    if (this._opts.recordVideo) o.recordVideo = this._opts.recordVideo;
    o.context = this;
    return o;
  }

  async newPage(opts = {}) {
    const page = await this.browser._createPage(this.pageDefaults(opts), this.id);
    page.context = this;
    this._pages.add(page);
    page.once('close', () => this._pages.delete(page));
    this.emit('page', page);
    // register context-exposed bindings on this page
    for (const [name, fn] of this._exposed) await page.expose(name, fn).catch(() => {});
    if (this._opts.recordVideo) page.video.start({ dir: this._opts.recordVideo.dir }).catch(() => {});
    return page;
  }

  /* ---------------- routing (applies to all pages) ---------------- */
  route(pattern, handler) {
    this._routes.push({ pattern, handler, match: globToRe(String(pattern)) });
    // re-arm routes on existing pages (their Fetch already runs; add to their lists)
    for (const p of this.pages()) p.route(pattern, handler);
    return this;
  }
  unroute(pattern) {
    const re = globToRe(String(pattern));
    this._routes = this._routes.filter((r) => String(r.match) !== String(re));
    for (const p of this.pages()) p.unroute(pattern);
    return this;
  }

  /* ---------------- scripts & bindings for future pages ---------------- */
  addInitScript(fnOrSrc) {
    const src = typeof fnOrSrc === 'function' ? `(${fnOrSrc.toString()})()` : fnOrSrc;
    this._initScripts.push(src);
    return this;
  }
  async expose(name, fn) { this._exposed.set(name, fn); for (const p of this.pages()) await p.expose(name, fn).catch(() => {}); }
  async exposeBinding(name, fn) { return this.expose(name, fn); }
  async setExtraHTTPHeaders(headers) {
    this._extraHeaders = headers;
    for (const p of this.pages()) await p.setHeaders(headers);
    return this;
  }

  /* ---------------- cookies & storage ---------------- */
  async cookies(urls) {
    const page = this.pages()[0];
    if (page) return page.cookies(urls);
    const tmp = await this.newPage();
    const c = await tmp.cookies(urls);
    await tmp.close();
    return c;
  }
  async setCookies(cookies) {
    let page = this.pages()[0];
    const owns = !page;
    if (!page) page = await this.newPage();
    await page.setCookies(cookies);
    if (owns) await page.close();
    return this;
  }
  async clearCookies() {
    let page = this.pages()[0];
    const owns = !page;
    if (!page) page = await this.newPage();
    await page.clearCookies();
    if (owns) await page.close();
    return this;
  }

  /** Playwright-format storage state: {cookies, origins:[{origin, localStorage:[{name,value}]}]} */
  async storageState(path) {
    const cookies = await this.cookies();
    const origins = [];
    const seen = new Set();
    for (const p of this.pages()) {
      let origin;
      try { origin = new URL(p._url).origin; } catch { continue; }
      if (seen.has(origin)) continue;
      seen.add(origin);
      let st = { local: {} };
      try { st = await p.localStorage(); } catch {}
      const localStorage = Object.entries(st.local || {}).map(([name, value]) => ({ name, value }));
      if (localStorage.length) origins.push({ origin, localStorage });
    }
    const state = { cookies, origins };
    if (path) { mkdirSync(dirnameOf(path), { recursive: true }); writeFileSync(path, JSON.stringify(state, null, 2)); }
    return state;
  }
  async setStorageState(stateOrPath) {
    const state = typeof stateOrPath === 'string' ? JSON.parse(readFileSync(stateOrPath, 'utf8')) : stateOrPath;
    if (state.cookies?.length) await this.setCookies(state.cookies);
    this._pendingStorageState = state.origins || [];
    return this;
  }

  /* ---------------- environment ---------------- */
  async grantPermissions(perms, { origin } = {}) {
    await this.browser.conn.send('Browser.grantPermissions', { permissions: [].concat(perms), ...(origin ? { origin } : {}) }).catch(() => {});
    return this;
  }
  async clearPermissions() { await this.browser.conn.send('Browser.resetPermissions', {}).catch(() => {}); return this; }

  async setOffline(offline = true) {
    for (const p of this.pages()) await p.setOffline(offline);
    this._opts._offline = offline;
    return this;
  }
  async setGeolocation(g) { this._opts.geolocation = g; for (const p of this.pages()) await p.setGeolocation(g); return this; }
  async setColorScheme(s) { this._opts.colorScheme = s; for (const p of this.pages()) await p.colorScheme(s); return this; }

  /** Raw CDP session bound to a page (power users). */
  async newCDPSession(page) { return page.session; }

  /** APIRequestContext sharing this context's cookie jar. */
  get request() {
    if (!this._request) this._request = new APIRequestContext(this);
    return this._request;
  }

  /* ---------------- tracing (chrome://tracing loadable) ---------------- */
  async startTracing({ screenshots = true, categories } = {}) {
    const cats = categories || [
      'devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline',
      ...(screenshots ? ['disabled-by-default-devtools.screenshot'] : []),
    ];
    this._tracing = { events: [] };
    const conn = this.browser.conn;
    conn.on('Tracing.dataCollected', ({ value }) => { if (this._tracing) this._tracing.events.push(...value); });
    await conn.send('Tracing.start', { categories: cats.join(','), options: 'sampling-frequency=10000', transferMode: 'ReportEvents' });
    return this;
  }
  async stopTracing(path = 'trace.json') {
    const conn = this.browser.conn;
    const done = conn.waitForEvent('Tracing.tracingComplete', { timeout: 15000 }).catch(() => null);
    await conn.send('Tracing.end').catch(() => {});
    await done;
    const events = this._tracing ? this._tracing.events : [];
    this._tracing = null;
    const trace = { traceEvents: events };
    if (path) { mkdirSync(dirnameOf(path), { recursive: true }); writeFileSync(path, JSON.stringify(trace)); }
    return trace;
  }

  /** Close all pages and (if isolated) dispose the context. */
  async close() {
    if (this._closed) return;
    this._closed = true;
    await Promise.allSettled(this.pages().map((p) => p.close()));
    if (this.id) await this.browser.conn.send('Target.disposeBrowserContext', { browserContextId: this.id }).catch(() => {});
    this.emit('close');
  }
}

function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^]*').replace(/\u0000/g, '[^]*').replace(/\?/g, '.') + '$');
}
function dirnameOf(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '.' : p.slice(0, i);
}
