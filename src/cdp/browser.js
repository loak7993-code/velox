// velox :: cdp/browser.js — launch/connect any CDP browser, manage targets & contexts
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpConnection } from './connection.js';
import { findBrowser, discoverBrowsers } from './discovery.js';
import { VeloxPage } from './page.js';
import { BrowserContext } from './context.js';
import { proxyFlags, normalizeProxy } from '../proxy.js';
import { getConfig, applyLaunchOptions, runHook, hasHook } from '../plugins.js';
import { Emitter } from '../util.js';

const HEADLESS_OK = (p) => !/headless-shell/i.test(p);

/** Pre-launched browsers waiting to be handed out by launch(). */
const warmBrowsers = [];
const keyOf = (o = {}) => [o.executablePath || '', o.browser || 'auto', o.headless !== false ? 'h' : 'd', JSON.stringify(o.proxy || null), o.noSandbox ? 'ns' : ''].join('|');

export class Browser extends Emitter {
  constructor(conn, proc = null, opts = {}) {
    super();
    this.conn = conn;
    this.proc = proc;
    this.opts = opts;
    this._pages = new Set();
    this._knownTargets = new Map();   // targetId -> VeloxPage (we manage these explicitly)
    this._pendingAttaches = new Set();
    this._userDataDir = opts._userDataDir || null;
    this._closed = false;
    this.versionInfo = null;
    this._setupAutoAttach();
    conn.on('disconnect', (e) => this.emit('disconnect', e));
    // keep one blank renderer warm so newPage() skips renderer spin-up (~30ms → ~4ms)
    this._spares = [];
    this._spareTarget = opts.spare ?? 2;
    if (this._spareTarget > 0) setTimeout(() => this._topUpSpares(), 0);
  }

  get closed() { return this._closed || this.conn.closed; }

  async _setupAutoAttach() {
    try {
      await this.conn.send('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      });
    } catch {}
    if (!this._contexts) this._contexts = new Map(); // browserContextId -> BrowserContext
    // Auto-attached pages are initialised by whoever claims them (newPage), or by this
    // sweeper if nobody does (popups, OOPIFs). Sweeping beats per-page timers: a timer
    // could fire while newPage() was still awaiting createTarget and init with defaults.
    if (!this._sweeper) {
      this._deferredPages = [];
      this._sweeper = setInterval(() => {
        if (!this._deferredPages.length) return;
        for (const [page, opts] of this._deferredPages.splice(0, this._deferredPages.length)) {
          if (page._initialized || page._claiming || page.isClosed) continue;
          page._init(opts).catch(() => {});
        }
      }, 25);
      this._sweeper.unref?.();
    }

    this.conn.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
      if (waitingForDebugger) this.conn.fire('Runtime.runIfWaitingForDebugger', {}, { sessionId });
      // we attached to this one ourselves (newPage) — skip, it's already managed
      if (this._knownTargets.has(targetInfo.targetId) || this._pendingAttaches.has(targetInfo.targetId)) return;

      // workers: lightweight wrappers, not pages
      if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker' || targetInfo.type === 'shared_worker') {
        const worker = {
          type: targetInfo.type, url: targetInfo.url, sessionId, targetId: targetInfo.targetId,
          browser: this,
          close: () => this.conn.send('Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {}),
        };
        this.emit('worker', worker);
        this.emit(targetInfo.type === 'service_worker' ? 'serviceworker' : 'worker', worker);
        if (this.opts.serviceWorkers === 'block') {
          await worker.close(); // hard-block service workers
        }
        return;
      }

      // only real documents become pages — Chrome also attaches browser_ui/tab/other
      // chrome-internal targets (especially per browser context); those are not automatable pages
      const PAGE_TYPES = new Set(['page', 'iframe', 'webview', 'app']);
      if (!PAGE_TYPES.has(targetInfo.type)) {
        this.emit('target', { type: targetInfo.type, url: targetInfo.url, targetId: targetInfo.targetId });
        return;
      }

      const evName = targetInfo.type === 'page' && targetInfo.openerId ? 'popup' : 'target';
      const page = new VeloxPage(this, sessionId, targetInfo);
      this._knownTargets.set(targetInfo.targetId, page);
      this._pages.add(page);
      // route the target into its browser context (if any)
      const ctx = targetInfo.browserContextId ? this._contexts.get(targetInfo.browserContextId) : this.defaultContext();
      if (ctx) {
        page.context = ctx;
        ctx._pages.add(page);
        page.once('close', () => ctx._pages.delete(page));
        ctx.emit(evName === 'popup' ? 'page' : 'backgroundpage', page);
      }
      this.emit(evName, page);
      this.emit('targetCreated', page);
      page.once('close', () => { this._pages.delete(page); this._knownTargets.delete(targetInfo.targetId); });
      // Queue for the sweeper: if newPage() claims this target within the window it
      // initialises the page with the CALLER's options and this entry is skipped.
      this._deferredPages.push([page, ctx ? ctx.pageDefaults() : {}]);
    });
  }

  /** The implicit default context (no browserContextId) shared by bare newPage(). */
  defaultContext() {
    if (!this._defaultContext) {
      this._defaultContext = new BrowserContext(this, null, this.opts.contextOpts || {});
    }
    return this._defaultContext;
  }

  /** Isolated context: separate cookies/storage/world. */
  async newContext(opts = {}) {
    const px = opts.proxy ? normalizeProxy(opts.proxy) : null;
    const { browserContextId } = await this.conn.send('Target.createBrowserContext', {
      disposeOnDetach: true,
      ...(px ? { proxyServer: px.server } : {}),
      ...(px?.bypass ? { proxyBypassList: [].concat(px.bypass).join(',') } : {}),
    });
    const ctx = new BrowserContext(this, browserContextId, opts);
    this._contexts.set(browserContextId, ctx);
    if (opts.storageState) await ctx.setStorageState(opts.storageState);
    if (opts.offline) await ctx.setOffline(true);
    return ctx;
  }

  /** Internal: create + attach + init a page in a given context. */
  async _createPage(opts = {}, browserContextId = null, { timeout } = {}) {
    const sendOpts = timeout ? { timeout } : {};
    const { targetId } = await this.conn.send('Target.createTarget', {
      url: 'about:blank', ...(browserContextId ? { browserContextId } : {}),
    }, sendOpts);
    // auto-attach can beat the createTarget response and already manage this
    // target — reuse that page (its _init is idempotent) instead of double-attaching
    const raced = this._knownTargets.get(targetId);
    if (raced) {
      raced._claiming = true;            // synchronous: the sweeper will stand down
      try { await raced._init(opts); } finally { raced._claiming = false; }
      return raced;
    }
    this._pendingAttaches.add(targetId);
    let sessionId;
    try {
      ({ sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true }, sendOpts));
    } finally {
      this._pendingAttaches.delete(targetId);
    }
    const page = new VeloxPage(this, sessionId, { targetId, type: 'page', url: 'about:blank' }, { browserContextId });
    this._knownTargets.set(targetId, page);
    this._pages.add(page);
    page.once('close', () => { this._pages.delete(page); this._knownTargets.delete(targetId); });
    await page._init(opts);
    return page;
  }

  /** Launch with a persistent profile (extensions, logins survive restarts). */
  static async launchPersistentContext(userDataDir, opts = {}) {
    const b = await Browser.launch({ ...opts, userDataDir });
    b._persistDir = userDataDir;       // keep the profile on close
    const ctx = b.defaultContext();
    ctx._opts = { ...ctx._opts, ...(opts.contextOpts || opts), baseURL: opts.baseURL };
    // adopt any pages the profile auto-opened (e.g. restored tabs)
    for (const p of b.pages()) {
      p.context = ctx; ctx._pages.add(p);
      p.once('close', () => ctx._pages.delete(p));
      await p._init(ctx.pageDefaults()).catch(() => {});
    }
    return ctx;
  }

  /** Launch a local browser. Uses any installed Chromium-family binary. */
  /**
   * Launch browsers (and optionally pages) ahead of time so later launch()/open()
   * calls are instant.
   *   await velox.prewarm({ browsers: 1, pagesPerBrowser: 6 })
   */
  static async prewarm(opts = {}) {
    const { browsers = 1, pagesPerBrowser = 0, topUp = false, ...launchOpts } = opts;
    const made = [];
    for (let i = 0; i < browsers; i++) {
      const b = await Browser.launch(launchOpts);
      b._warmKey = keyOf(launchOpts);
      if (pagesPerBrowser) await b.prewarm(pagesPerBrowser, launchOpts.pageOpts || {});
      warmBrowsers.push(b);
      made.push(b);
    }
    if (topUp) Browser._topUp(opts);
    return made;
  }

  /** Keep the warm queue stocked in the background (best effort). */
  static _topUp(opts) {
    const want = opts.browsers ?? 1;
    const have = warmBrowsers.length;
    for (let i = have; i < want; i++) {
      Browser.prewarm({ ...opts, browsers: 1, topUp: false }).catch(() => {});
    }
  }

  /** Take a matching warm browser, if one is ready. */
  static _takeWarm(opts) {
    const key = keyOf(opts);
    const idx = warmBrowsers.findIndex((b) => b._warmKey === key && !b.closed);
    if (idx === -1) return null;
    const b = warmBrowsers.splice(idx, 1)[0];
    if (Browser._warmTarget) Browser._topUp({ browsers: Browser._warmTarget });
    return b;
  }

  static async launch(opts = {}) {
    const cfg = getConfig();
    opts = applyLaunchOptions({
      ...(cfg.headless !== undefined ? { headless: cfg.headless } : {}),
      ...(cfg.transport ? { transport: cfg.transport } : {}),
      ...(cfg.proxy ? { proxy: cfg.proxy } : {}),
      ...(cfg.noSandbox !== undefined ? { noSandbox: cfg.noSandbox } : {}),
      ...opts,
    });
    // a pre-warmed browser (same executable/headless/proxy) is instant
    const warm = Browser._takeWarm(opts);
    if (warm) { runHook('onBrowser', warm); return warm; }
    let browser;
    try {
      browser = await Browser._launchOnce(opts);
    } catch (e) {
      // Ubuntu 23.10+/containers/WSL restrict the unprivileged sandbox. If Chrome
      // says it can't sandbox, relaunch with --no-sandbox instead of failing.
      if (!opts.noSandbox && /usable sandbox|zygote_host|new namespace|sandbox/i.test(e.message)) {
        browser = await Browser._launchOnce({ ...opts, noSandbox: true });
      } else {
        runHook('onError', e, { phase: 'launch' });
        throw e;
      }
    }
    runHook('onBrowser', browser);
    return browser;
  }

  static async _launchOnce(opts = {}) {
    const {
      // VELOX_BROWSER is a true default: an explicit opts.browser/executablePath still wins
      browser = process.env.VELOX_BROWSER || 'auto', headless = true, executablePath,
      args = [], userDataDir, proxy, userAgent, timeout = 20000,
      env = {}, stealth = false, defaultContext,
    } = opts;

    const exe = executablePath || findBrowser(browser);
    const isShell = /headless-shell/i.test(exe);
    const root = typeof process.getuid === 'function' && process.getuid() === 0;
    const dir = userDataDir || mkdtempSync(join(tmpdir(), 'velox-'));
    const usePipe = opts.transport !== 'socket';
    const sandboxless = root || opts.noSandbox === true || !!process.env.VELOX_NO_SANDBOX;
    const cli = [...new Set([
      `--user-data-dir=${dir}`,
      usePipe ? '--remote-debugging-pipe' : '--remote-debugging-port=0',
      '--no-first-run', '--no-default-browser-check',
      // headless never needs a GPU: skipping it saves renderer setup time on every launch
      ...(headless ? ['--disable-gpu'] : []),
      ...(sandboxless ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      '--disable-background-networking', '--disable-sync', '--mute-audio',
      '--disable-component-update', '--disable-default-apps',
      '--disable-extensions', '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
      '--disable-hang-monitor', '--disable-prompt-on-repost', '--disable-domain-reliability',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling', '--disable-breakpad',
      '--disable-client-side-phishing-detection', '--disable-ipc-flooding-protection',
      '--metrics-recording-interval=2147483647', '--no-service-autorun',
      ...(HEADLESS_OK(exe) && headless ? ['--headless=new'] : []),
      ...(opts.windowSize ? [`--window-size=${opts.windowSize[0]},${opts.windowSize[1]}`] : []),
      ...(proxy ? proxyFlags(proxy) : []),
      ...args,
    ])];

    const stdio = usePipe ? ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const proc = spawn(exe, cli, { stdio, env: { ...process.env, ...env } });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdout?.on('data', (d) => { const s = d.toString(); if (s.includes('DevTools listening on')) proc.emit('devtools', s); });

    let conn;
    if (usePipe && proc.stdio.length >= 5 && proc.stdio[3] && proc.stdio[4]) {
      conn = CdpConnection.pipe(proc);
      const alive = await conn.send('Browser.getVersion', {}, { timeout }).then(() => true, () => false);
      if (!alive) {
        // pipe unavailable in this environment (wrapper/constrained spawn) → fall back to port
        try { proc.kill('SIGKILL'); } catch {}
        return await Browser._launchOnce({ ...opts, transport: 'socket' });
      }
    } else {
      const wsUrl = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Browser didn't expose CDP in ${timeout}ms.\n${stderr.slice(-800)}`)), timeout);
        const onData = (chunk) => {
          const m = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);
          if (m) { clearTimeout(t); resolve(m[1]); }
        };
        proc.stderr.on('data', onData);
        proc.on('devtools', onData);
        proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`Browser exited with code ${code}.\n${stderr.slice(-800)}`)); });
      });
      conn = await CdpConnection.connect(wsUrl);
    }
    const b = new Browser(conn, proc, { ...opts, _userDataDir: userDataDir ? null : dir });
    try { b.versionInfo = await conn.send('Browser.getVersion'); } catch {}
    // proxy credentials live on the browser so every page can answer 407 challenges
    if (proxy) b.proxy = normalizeProxy(proxy);
    if (stealth || defaultContext) { /* handled per-page */ }
    proc.once('exit', () => { b._closed = true; b.emit('disconnect'); });
    return b;
  }

  /** Connect to an already-running browser or remote endpoint (browserless, your own box...). */
  static async connect(endpoint, opts = {}) {
    let wsUrl = endpoint;
    if (!endpoint.startsWith('ws://') && !endpoint.startsWith('wss://')) {
      const base = endpoint.startsWith('http') ? endpoint : `http://${endpoint}`;
      const ver = await (await fetch(`${base.replace(/\/$/, '')}/json/version`)).json();
      wsUrl = ver.webSocketDebuggerUrl;
    }
    const conn = await CdpConnection.connect(wsUrl);
    const b = new Browser(conn, null, opts);
    try { b.versionInfo = await conn.send('Browser.getVersion'); } catch {}
    if (opts.proxy) b.proxy = normalizeProxy(opts.proxy);
    // remote browsers drop connections; keep the session alive by default
    b._autoReconnect = opts.autoReconnect !== false;
    if (b._autoReconnect) {
      conn.on('disconnect', () => {
        if (b._reconnecting || b._closingRemote) return;
        b._reconnecting = true;
        b.reconnect({ attempts: opts.reconnectAttempts ?? 5, delay: opts.reconnectDelay ?? 400 })
          .catch(() => {})
          .finally(() => { b._reconnecting = false; });
      });
    }
    runHook('onBrowser', b);
    return b;
  }

  /**
   * Pre-create blank pages so later newPage() calls only attach + init.
   *   await browser.prewarm(4)     // 4 ready pages in the pool
   */
  async prewarm(count = 2, opts = {}) {
    this._pool = this._pool || [];
    this._spares = this._spares || [];
    await Promise.all(Array.from({ length: count }, async () => {
      try { this._pool.push(await this._createPage({ capture: false, ...opts }, null)); } catch {}
    }));
    return this._pool.length;
  }

  /**
   * Create blank pages in the background (never exposed in pages()).
   * Returns the in-flight promise so newPage() can await a nearly-ready spare
   * instead of paying a cold renderer start.
   */
  _topUpSpares() {
    if (this.closed || this._sparePromise) return this._sparePromise;
    const need = (this._spareTarget || 0) - this._spares.length;
    if (need <= 0) return null;
    const one = async () => {
      const p = await this._createPage({ capture: false }, null, { timeout: this.opts.spareTimeout ?? 10000 });
      if (this.closed) { await p.close().catch(() => {}); return; }
      p._spare = true; p._spareAt = Date.now();
      this._spares.push(p);
    };
    this._sparePromise = Promise.all(Array.from({ length: need }, () => one().catch(() => {})))
      .finally(() => {
        this._sparePromise = null;
        // keep the pool topped up continuously: the scrape loop (create → read → close)
        // drains faster than a single refill round-trips
        if (!this.closed && this._spares.length < (this._spareTarget || 0)) setTimeout(() => this._topUpSpares(), 0);
      });
    return this._sparePromise;
  }

  /** New page in the default context. Everything optional: { stealth, ads, device, viewport, ua, locale, timezone, geolocation, headers, blockUrls, routes } */
  async newPage(opts = {}) {
    const ctx = this.defaultContext();
    // adopt a warm spare (or an explicitly pre-warmed pool page): attach-only path
    // drop spares that have gone stale (a browser under load can take arbitrarily long)
    if (this._spares?.length) {
      const maxAge = this.opts.spareMaxAge ?? 120000;
      this._spares = this._spares.filter((p) => !p.isClosed && Date.now() - (p._spareAt || 0) < maxAge);
    }
    let warm = (this._pool?.length ? this._pool.pop() : null) || (opts.spare === 0 ? null : this._spares.pop());
    if (!warm && opts.spare !== 0 && (this._sparePromise || this._spares.length < (this._spareTarget || 0))) {
      // Behind target: start (or join) a refill and wait for it — a spare lands faster
      // than building a page cold, and page creation must never block indefinitely.
      const refill = this._sparePromise || this._topUpSpares();
      if (refill) await Promise.race([refill.catch(() => {}), new Promise((r) => setTimeout(r, opts.spareWait ?? 80))]);
      warm = this._spares.pop() || null;
    }
    if (warm) {
      // A background-created page must prove it is responsive before we hand it over:
      // under load a renderer can be slow or wedged, and a one-round-trip probe is far
      // cheaper than the caller discovering it. Failing the probe falls back to a
      // normal (cold) page, so correctness never depends on the spare being good.
      const healthy = await Promise.race([
        warm.session.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: 2500 }).then(() => true, () => false),
        new Promise((r) => setTimeout(() => r(false), 3000)),
      ]);
      if (!healthy) {
        warm.close().catch(() => {});
        warm = null;
      }
    }
    if (warm) {
      warm._spare = false;
      ctx._pages.add(warm);
      warm.context = ctx;
      warm.once('close', () => ctx._pages.delete(warm));
      await warm._init(ctx.pageDefaults(opts), { force: true });
      if (this._spareTarget > 0) setTimeout(() => this._topUpSpares(), 0);
      return warm;
    }
    const page = await this._createPage(ctx.pageDefaults(opts), null);
    page.context = ctx;
    ctx._pages.add(page);
    page.once('close', () => {
      ctx._pages.delete(page);
      // closing a page frees a renderer slot — refill immediately so the next
      // newPage() in a scrape loop stays on the fast path
      if (this._spareTarget > 0) this._topUpSpares();
    });
    if (this._spareTarget > 0) setTimeout(() => this._topUpSpares(), 0);
    return page;
  }

  pages() { return [...this._pages].filter((p) => !p.isClosed); }

  /** Cheap liveness probe. */
  async healthy({ timeout = 5000 } = {}) {
    if (this.closed) return false;
    try { await this.conn.send('Browser.getVersion', {}, { timeout }); return true; }
    catch { return false; }
  }

  /**
   * Re-establish a dropped connection (remote/connected browsers) and re-attach to
   * every page we already manage, so existing objects keep working.
   */
  async reconnect({ attempts = 3, delay = 500 } = {}) {
    if (this.conn.transport === 'pipe') {
      throw new Error('reconnect() needs a socket connection — a launched browser owns its pipe; use velox.connect()/a remote endpoint');
    }
    const url = this.conn.wsUrl;
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      try {
        const conn = await CdpConnection.connect(url, { timeout: 10000 });
        this.conn = conn;
        this._closed = false;
        await this._setupAutoAttach();
        for (const [targetId, page] of this._knownTargets) {
          try {
            const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
            page.conn = conn;
            page.session = conn.session(sessionId);
            page._wired = false;                  // rewire event handlers onto the new session
            page._initScriptSources = new Set();   // init scripts are per-session in CDP
            page._fetchOn = false; page._fetchReady = null;
            page._closed = false;
            page._initialized = false;
            await page._init(page._opts || {}, { force: true });
            if (page._routes?.length) {
              page._fetchOn = true;
              await page.session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }], ...(page._httpCredentials || page._proxyCredentials ? { handleAuthRequests: true } : {}) }).catch(() => {});
            }
          } catch { /* target disappeared while we were away */ }
        }
        this.emit('reconnected', { attempt: i });
        return this;
      } catch (e) {
        lastErr = e;
        if (i < attempts) await new Promise((r) => setTimeout(r, delay * i));
      }
    }
    this.emit('reconnectFailed', lastErr);
    throw lastErr;
  }

  async contexts() { return (await this.conn.send('Target.getBrowserContexts')).browserContextIds; }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._closingRemote = true;   // a deliberate close must not trigger auto-reconnect
    this._spares = [];
    try { await Promise.race([this.conn.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]); } catch {}
    this.conn.close();
    // give the process a moment to exit gracefully (profile/cookie flush) before SIGKILL
    if (this.proc) {
      await new Promise((resolve) => {
        const t = setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch {} resolve(); }, 1500);
        this.proc.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    if (this._userDataDir && !this._persistDir) { try { rmSync(this._userDataDir, { recursive: true, force: true }); } catch {} }
    this.emit('close');
  }
}

export const detect = discoverBrowsers;
export const launch = (o) => Browser.launch(o);
export const launchPersistentContext = (dir, o) => Browser.launchPersistentContext(dir, o);
export const connect = (e, o) => Browser.connect(e, o);
