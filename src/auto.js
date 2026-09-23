// velox :: auto.js — adaptive engine. Fetch static pages with pure HTTP (no browser);
// transparently escalate to a real browser the moment a page needs one.
import { fetch as liteFetch, CookieJar, needsJS } from './lite/engine.js';
import { Browser } from './cdp/browser.js';
import { normHeaders, sleep } from './util.js';
import { getConfig, applyPageOptions } from './plugins.js';

/** Open a URL. engine: 'auto' (default) | 'lite' (never escalate) | 'cdp' (always browser). */
export async function open(url, opts = {}) {
  const cfg = getConfig();
  opts = applyPageOptions({ capture: cfg.capture, headers: cfg.headers, userAgent: cfg.userAgent, baseURL: cfg.baseURL, storageState: cfg.storageState, ...opts });
  const engine = opts.engine || cfg.engine || 'auto';
  const tries = Math.max(1, (opts.retries ?? cfg.retries ?? 0) + 1);
  const retryDelay = opts.retryDelay ?? cfg.retryDelay ?? 300;

  /** Retry transient failures (network hiccups, timeouts) up to `tries` times. */
  const withRetry = async (fn) => {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (i === tries || !/timeout|ERR_|ECONN|socket|closed|Target closed|Navigation/i.test(e.message || '')) throw e;
        await sleep(retryDelay * i);
      }
    }
    throw lastErr;
  };

  if (engine === 'cdp') {
    return withRetry(async () => {
      const page = await _browserPage(url, opts);
      const s = new BrowserSession(page, opts);
      await s.goto(url);
      return s;
    });
  }

  const jar = opts.jar || new CookieJar();
  const res = await withRetry(() => liteFetch(url, {
    jar, headers: opts.headers, timeout: opts.timeout || cfg.navTimeout, method: opts.method, body: opts.body,
    maxRedirects: opts.maxRedirects,
  }));

  if (engine === 'auto' && needsJS(res)) {
    return withRetry(async () => {
      const page = await _browserPage(url, opts, jar);
      const s = new BrowserSession(page, opts);
      await page.goto(url, { waitUntil: opts.waitUntil || 'interactive', timeout: opts.timeout || cfg.navTimeout });
      s._startedLite = true;
      return s;
    });
  }
  return new LiteSession(res, opts);
}

async function _browserPage(url, opts, jar) {
  const browser = opts.browser || await Browser.launch({
    browser: opts.browserName || 'auto',
    headless: opts.headless !== false,
    executablePath: opts.executablePath,
    proxy: opts.proxy,
    args: opts.args,
  });
  const page = await browser.newPage({
    stealth: opts.stealth, ads: opts.ads, blockUrls: opts.blockUrls, device: opts.device,
    viewport: opts.viewport, ua: opts.ua, locale: opts.locale, timezone: opts.timezone,
    geolocation: opts.geolocation, headers: opts.headers, routes: opts.routes,
    initScripts: opts.initScripts, dialogs: opts.dialogs,
  });
  if (jar) {
    const u = new URL(url);
    const cookies = jar.toJSON().filter((c) => u.hostname.endsWith(c.domain)).map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
    }));
    if (cookies.length) await page.setCookies(cookies).catch(() => {});
  }
  return page;
}

/* -------------------------------------------- unified facade -------------------------------------------- */

class LiteLocator {
  constructor(session, sel) { this.s = session; this.sel = sel; }
  text() { return Promise.resolve(this.s.doc.text(this.sel)); }
  attr(name) { return Promise.resolve(this.s.doc.attr(this.sel, name)); }
  html() { return Promise.resolve(this.s.doc.html(this.sel)); }
  exists() { return Promise.resolve(this.s.doc.select(this.sel) !== null); }
  count() { return Promise.resolve(this.s.doc.selectAll(this.sel).length); }
}

export class LiteSession {
  constructor(res, opts) {
    this.res = res; this.opts = opts || {};
    this.engine = 'lite';
    this._upgraded = null;
  }
  get doc() { return this.res.doc; }
  get url() { return this.res.url; }
  get status() { return this.res.status; }
  get headers() { return this.res.headers; }
  get ms() { return this.res.ms; }

  /** Escalate to a real browser at the current URL (cookie state transfers). */
  async upgrade() {
    if (this._upgraded) return this._upgraded;
    const page = await _browserPage(this.url, this.opts, this.res.jar);
    await page.goto(this.url, { waitUntil: this.opts.waitUntil || 'interactive' });
    this._upgraded = new BrowserSession(page, this.opts, this);
    this.engine = 'cdp';
    return this._upgraded;
  }
  // once upgraded, every data call reads the live DOM instead of the snapshot
  _live() { return this._upgraded; }
  title() { return this._live()?.title() ?? this.doc.title(); }
  html() { return this._live()?.html() ?? this.res.text(); }
  content() { return this.html(); }
  text(sel) { return this._live()?.text(sel) ?? (sel ? this.doc.text(sel) : this.doc.readable()); }
  readable() { return this._live()?.readable() ?? this.doc.readable(); }
  $(sel) { return this._live()?.$(sel) ?? new LiteLocator(this, sel); }
  $$(sel) { return this._live()?.$$(sel) ?? this.doc.selectAll(sel).map((n) => ({ tag: n.tag, text: n.textContent(), ...n.attrs })); }
  extract(sel, spec = { text: true }) {
    if (this._live()) return this._live().extract(sel, spec);
    return this.doc.selectAll(sel).map((n) => {
      const o = {};
      if (spec.text) o.text = n.textContent();
      if (spec.html) o.html = this.doc._serialize(n);
      if (spec.tag) o.tag = n.tag;
      if (spec.attrs) for (const a of spec.attrs) o[a] = n.attrs[a.toLowerCase()] ?? null;
      return o;
    });
  }
  texts(sel) { return this.extract(sel).map((o) => o.text); }
  links() { return this._live()?.links() ?? this.doc.links(this.url); }
  images() { return this._live()?.images() ?? this.doc.images(this.url); }
  tables() { return this._live()?.tables() ?? this.doc.tables(); }
  forms() { return this._live()?.forms() ?? this.doc.forms(); }
  meta() { return this._live()?.meta() ?? this.doc.meta(); }
  jsonld() { return this._live()?.jsonld() ?? this.doc.jsonld(); }
  cookies() { return this._live()?.cookies() ?? this.res.jar.toJSON(); }

  /** Browser-only ops: escalate transparently. */
  _op(name, ...args) {
    return this.upgrade().then((b) => b[name](...args));
  }
  click(...a) { return this._op('click', ...a); }
  hover(...a) { return this._op('hover', ...a); }
  type(...a) { return this._op('type', ...a); }
  fill(...a) { return this._op('fill', ...a); }
  press(...a) { return this._op('press', ...a); }
  screenshot(...a) { return this._op('screenshot', ...a); }
  pdf(...a) { return this._op('pdf', ...a); }
  eval(...a) { return this._op('eval', ...a); }
  waitForSelector(...a) { return this._op('waitForSelector', ...a); }
  saveSession(...a) { return this._op('saveSession', ...a); }
  loadSession(...a) { return this._op('loadSession', ...a); }
  setCookies(...a) { return this._op('setCookies', ...a); }
  async close() {
    if (this._upgraded) await this._upgraded.close().catch(() => {});
  }
}

export class BrowserSession {
  constructor(page, opts, fromLite = null) {
    this.page = page; this.opts = opts || {};
    this.engine = 'cdp';
    this._fromLite = fromLite;
  }
  get url() { return this.page._url; }
  async goto(url, o) { const r = await this.page.goto(url, o); this._lastNav = r; return r; }
  async title() { return this.page.title(); }
  async html() { return this.page.content(); }
  content() { return this.page.content(); }
  text(sel) { return sel ? this.page.text(sel) : this.page.readable(); }
  readable() { return this.page.readable(); }
  $(sel) { return this.page.$(sel); }
  $$(sel) { return this.page.$$(sel); }
  extract(sel, spec) { return this.page.extract(sel, spec); }
  texts(sel) { return this.page.texts(sel); }
  links() { return this.page.links(); }
  images() { return this.page.images(); }
  tables() { return this.page.tables(); }
  forms() { return this.page.forms(); }
  meta() { return this.page.meta(); }
  jsonld() { return this.page.jsonld(); }
  cookies() { return this.page.cookies(); }
  setCookies(...a) { return this.page.setCookies(...a); }
  saveSession(...a) { return this.page.saveSession(...a); }
  loadSession(...a) { return this.page.loadSession(...a); }
  count(sel) { return this.page.count(sel); }
  attr(sel, name) { return this.page.attr(sel, name); }
  val(sel) { return this.page.val(sel); }
  waitForFunction(...a) { return this.page.waitForFunction(...a); }
  waitForUrl(...a) { return this.page.waitForUrl(...a); }
  click(...a) { return this.page.click(...a); }
  hover(...a) { return this.page.hover(...a); }
  type(...a) { return this.page.type(...a); }
  fill(...a) { return this.page.fill(...a); }
  press(...a) { return this.page.press(...a); }
  screenshot(...a) { return this.page.screenshot(...a); }
  pdf(...a) { return this.page.pdf(...a); }
  eval(...a) { return this.page.eval(...a); }
  waitForSelector(...a) { return this.page.waitForSelector(...a); }
  waitForLoad(...a) { return this.page.waitForLoad(...a); }
  get status() { return this.page._docResponse?.status ?? this._lastNav?.status ?? null; }
  /** Underlying page for full API access. */
  get raw() { return this.page; }
  async close() { await this.page.browser.close(); }
}

/** One-shot structured scrape. Recipes: text | links | images | tables | meta | jsonld | all */
export async function scrape(url, { recipe = 'all', ...opts } = {}) {
  const s = await open(url, { ...opts, engine: opts.engine || 'auto' });
  const run = {
    text: () => s.text(),
    links: () => s.links(),
    images: () => s.images(),
    tables: () => s.tables(),
    meta: () => s.meta(),
    jsonld: () => s.jsonld(),
    all: () => ({ url: s.url, status: s.status, meta: s.meta(), text: s.text(), links: s.links(), images: s.images(), tables: s.tables(), jsonld: s.jsonld() }),
  };
  const out = await (run[recipe] || run.all)();
  if (s instanceof BrowserSession && !opts.browser) await s.close().catch(() => {});
  return out;
}
