// velox :: cdp/page.js — the page: navigation, actions, network, capture, emulation
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Emitter, sleep, withTimeout, TimeoutError, randInt, humanDelay } from '../util.js';
import { ENGINE_SOURCE } from './inject.js';
import { STEALTH_SOURCE } from './stealth.js';
import { DEVICES } from './devices.js';
import { buildHar } from './har.js';
import { Locator, byRoleSel, byTextSel, byLabelSel, byPlaceholderSel, byAltTextSel, byTitleSel, byTestIdSel } from './locator.js';
import { JSHandle, ElementHandle, buildEvalExpr } from './handles.js';
import { videoApi } from './screencast.js';
import { Coverage } from './coverage.js';
import { Accessibility } from './accessibility.js';
import { Clock, CLOCK_SOURCE } from './clock.js';
import { getConfig, applyPageOptions, runHook, hasHook, registeredDevices } from '../plugins.js';
import { resolveBandwidth, sameSite, fmtBytes } from '../bandwidth.js';

const KEYMAP = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const globToRe = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^]*').replace(/\u0000/g, '[^]*').replace(/\?/g, '.') + '$');

export class VeloxPage extends Emitter {
  constructor(browser, sessionId, targetInfo, extra = {}) {
    super();
    this.browser = browser;
    this.conn = browser.conn;
    this.session = browser.conn.session(sessionId);
    this.targetInfo = targetInfo;
    this.isFrame = targetInfo.type === 'iframe';
    this.browserContextId = extra.browserContextId || null;
    this._opts = {};
    this._url = targetInfo.url || 'about:blank';
    this._mainFrameId = null;
    this._life = {};               // lifecycle flags for main frame
    this._lifeWaiters = new Map(); // name -> [resolve]
    this._requests = new Map();    // requestId -> entry
    this._reqOrder = [];
    this._inflight = 0;
    this._idleTimer = null;
    this._idleWaiters = [];
    this._routes = [];
    this._fetchOn = false;
    this._blocked = new Set();
    this._extraHeaders = null;
    this._dialogCfg = { action: 'accept', promptText: '' };
    this._downloads = null;
    this._consoleBuffer = [];
    this._errorBuffer = [];
    this._mouse = { x: 0, y: 0 };
    this._modifiers = 0;
    this._closed = false;
    this._docResponse = null;
    this._bindings = new Map();
    this._rootOverride = null;     // frame scoping (same-origin iframe)
    this._fileChooserEnabled = false;
    this._screenshotCount = 0;
    this.context = null;           // set by BrowserContext when scoped
    this._baseURL = null;
    this._httpCredentials = null;
    this._pendingStorageState = null;
    this._wsCounter = 0;
    this.clock = new Clock(this);
    this.video = videoApi(this);
    this.coverage = new Coverage(this);
    this.accessibility = new Accessibility(this);
  }

  get isClosed() { return this._closed; }

  /** Per-action default timeout (page → context → global config). */
  setDefaultTimeout(ms) { this._defaultTimeout = ms; return this; }
  _to(opts = {}) {
    const cfg = getConfig();
    return { timeout: this._defaultTimeout ?? this.context?._defaultTimeout ?? cfg.timeout, ...opts };
  }
  get targetId() { return this.targetInfo.targetId; }

  /* ------------------------------------------------ setup ----------------------------------------------- */

  async _init(opts = {}, { force = false } = {}) {
    // newPage() can race the auto-attach handler. Both used to run the whole setup
    // concurrently (double enables, double script injection, double engine payload).
    // The promise is memoized so only one batch ever flies, and `force` re-inits
    // (used when adopting a pre-warmed page or after a reconnect).
    if (force) { this._initPromise = null; this._initialized = false; }
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initOnce(opts).catch((e) => { this._initPromise = null; throw e; });
    return this._initPromise;
  }

  async _initOnce(opts = {}) {
    const cfg = getConfig();
    opts = applyPageOptions({ capture: cfg.capture, ...opts });
    this._opts = opts;
    const s = this.session;
    // wire events exactly once — _init may run again when auto-attach races an
    // explicit newPage, and duplicate handlers would double-count everything
    if (!this._wired) {
      this._wired = true;
      this._wireEvents();
    }
    // capture:false skips the Network domain — no request tracking, no per-request
    // event plumbing: lighter page creation and faster loads on request-heavy sites
    this._capture = opts.capture !== false;
    // bandwidth profile: block resource types, cap body sizes, drop third-party chatter
    this._bw = resolveBandwidth(opts.bandwidth);
    this._bytesBlocked = 0; this._blockedByType = {};
    // single pipelined batch — all domain enables fly at once
    const jobs = [
      s.send('Page.enable'),
      s.send('Runtime.enable'),
      ...(this._capture ? [s.send('Network.enable', { maxPostDataSize: 65536 })] : []),
      s.send('Page.setLifecycleEventsEnabled', { enabled: true }),
    ];
    await Promise.all(jobs).catch(() => {});
    // scripts apply to every future navigation (deduped per page — _init may run twice
    // when auto-attach races an explicit newPage, and that must stay harmless)
    this._initScriptSources = this._initScriptSources || new Set();
    const initScripts = [
      ENGINE_SOURCE,
      ...(opts.stealth ? [STEALTH_SOURCE] : []),
      ...(opts.clock ? [CLOCK_SOURCE] : []),
      ...(opts.serviceWorkers === 'block' ? ['(function(){try{if(navigator.serviceWorker)navigator.serviceWorker.register=function(){return Promise.reject(new Error("service workers blocked by velox"))}}catch(e){}})()'] : []),
      ...(opts.initScripts || []),
    ];
    const freshScripts = initScripts.filter((src) => !this._initScriptSources.has(src));
    for (const src of freshScripts) this._initScriptSources.add(src);
    // register for every future navigation; the CURRENT document (about:blank) is
    // armed lazily on first eval — eval() auto-heals, so nothing is lost
    await Promise.all(freshScripts.map((src) => s.send('Page.addScriptToEvaluateOnNewDocument', { source: src })));
    if (!this._eagerEngine) {
      // nothing to do — see DocumentedFastPath: waiting for the first navigation avoids
      // shipping the engine twice per page (measured ~25 KB + one round-trip per page)
    } else {
      await s.send('Runtime.evaluate', { expression: ENGINE_SOURCE }).catch(() => {});
      if (opts.stealth) await s.send('Runtime.evaluate', { expression: STEALTH_SOURCE }).catch(() => {});
      if (opts.clock) await s.send('Runtime.evaluate', { expression: CLOCK_SOURCE }).catch(() => {});
    }
    if (opts.testIdAttribute && opts.testIdAttribute !== 'data-testid') {
      await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `__vlx && (__vlx.testIdAttr = ${JSON.stringify(opts.testIdAttribute)})` }).catch(() => {});
      await s.send('Runtime.evaluate', { expression: `__vlx.testIdAttr = ${JSON.stringify(opts.testIdAttribute)}` }).catch(() => {});
    }
    if (opts.bypassCSP) await s.send('Page.setBypassCSP', { enabled: true }).catch(() => {});
    if (opts.httpCredentials) this._httpCredentials = opts.httpCredentials;
    // a launch-level proxy (browser.proxy) applies to every page — inherit its credentials
    const proxyCred = (opts.proxy?.username ? opts.proxy : null)
      || (this.browser?.proxy?.username ? this.browser.proxy : null);
    if (proxyCred) this._proxyCredentials = { username: proxyCred.username, password: proxyCred.password };
    if (opts.baseURL) this._baseURL = opts.baseURL;
    if (opts.storageState) this._pendingStorageState = opts.storageState;
    if (opts.context?._pendingStorageState) this._pendingStorageState = opts.context._pendingStorageState;

    // defaults
    this._dialogCfg = { action: opts.dialogs?.action || 'accept', promptText: opts.dialogs?.promptText || '' };
    if (opts.blockUrls || opts.ads) await this.block(opts.ads ? [...defaultBlocklist(), ...(opts.blockUrls || [])] : opts.blockUrls);
    if (this._bw.blockTypes.size || this._bw.maxBytes || this._bw.blockThirdParty) await this._armBandwidth();
    if (opts.routes) for (const [pat, h] of Object.entries(opts.routes)) this.route(pat, h);
    if (opts.httpCredentials || proxyCred) {
      // intercept auth challenges (site login and/or proxy login)
      await s.send('Fetch.enable', { handleAuthRequests: true }).catch(() => {});
      this._fetchOn = true;
    }
    if (opts.headers) await this.setHeaders(opts.headers);
    if (opts.device) await this.emulate(opts.device);
    else if (opts.viewport !== null) await this.setViewport(...(opts.viewport || [1280, 720]), opts.viewportMeta || {});
    if (opts.ua) await this.setUA(opts.ua, opts.platform);
    if (opts.locale) await this.setLocale(opts.locale);
    if (opts.timezone) await this.setTimezone(opts.timezone);
    if (opts.geolocation) await this.setGeolocation(opts.geolocation);
    if (opts.colorScheme) await this.colorScheme(opts.colorScheme);
    // download plumbing is armed on first use (see _ensureDownloads) — it costs a
    // round-trip per page that most runs never need. `downloads: true` forces it now.
    if (opts.downloads === true) await this._ensureDownloads();
    // plugin network hooks arm interception only when a plugin actually wants them
    if (hasHook('onRequest')) this.route('**/*', (req) => { runHook('onRequest', req); if (!req._handled) req.continue(); });
    if (hasHook('onResponse')) this.on('response', (entry) => runHook('onResponse', entry));
    if (!this._pluginsRan) { this._pluginsRan = true; runHook('onPage', this); }
    // unpause if this target was auto-attached with waitForDebuggerOnStart
    s.fire('Runtime.runIfWaitingForDebugger');
    this._initialized = true;
    return this;
  }

  _wireEvents() {
    const s = this.session;
    s.on('Page.frameNavigated', ({ frame }) => {
      if (!frame.parentId) {
        this._mainFrameId = frame.id;
        this._url = frame.url || '';
        this._life = {};
        // NOTE: don't wipe _docResponse here — responseReceived can arrive
        // before frameNavigated; goto() resets it before navigating instead.
      }
    });
    s.on('Page.navigatedWithinDocument', ({ frameId, url }) => { this._url = url; this._bumpLife('DOMContentLoaded'); this._bumpLife('load'); });
    s.on('Page.lifecycleEvent', ({ frameId, name }) => { if (frameId === this._mainFrameId || !this._mainFrameId) this._bumpLife(name); });
    s.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
      const text = (args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      const rec = { type, text, page: this };
      this._consoleBuffer.push(rec); if (this._consoleBuffer.length > 1000) this._consoleBuffer.shift();
      this.emit('console', rec);
    });
    s.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      const d = exceptionDetails || {};
      const rec = { text: (d.exception?.description || d.text || 'error'), url: d.url, line: d.lineNumber, page: this };
      this._errorBuffer.push(rec);
      this.emit('pageerror', rec);
    });
    s.on('Page.javascriptDialogOpening', (info) => this._onDialog(info));
    s.on('Network.requestWillBeSent', (p) => { if (this._capture) this._onRequest(p); });
    s.on('Network.responseReceived', (p) => { if (this._capture) this._onResponse(p); });
    s.on('Network.loadingFinished', ({ requestId, timestamp, encodedDataLength }) => { if (this._capture) this._onDone(requestId, timestamp, encodedDataLength); });
    s.on('Network.loadingFailed', ({ requestId, errorText, canceled, blockedReason }) => { if (this._capture) this._onDone(requestId, undefined, 0, { errorText, canceled, blockedReason }); });
    s.on('Page.downloadWillBegin', ({ guid, url, suggestedFilename }) => {
      const dl = new Download(this, guid, url, suggestedFilename);
      this._dlMap = this._dlMap || new Map();
      this._dlMap.set(guid, dl);
      this.emit('download', dl);
    });
    s.on('Page.downloadProgress', (p) => {
      const dl = this._dlMap?.get(p.guid);
      if (dl) dl._update(p);
      else this.emit('download', { ...p, page: this });
    });
    s.on('Page.fileChooserOpened', ({ mode, backendNodeId }) => this.emit('filechooser', { mode, backendNodeId, page: this, setFiles: (files) => s.send('DOM.setFileInputFiles', { files, backendNodeId }) }));
    s.on('Fetch.requestPaused', (p) => this._onPaused(p));
    // workers + nested targets attach through the PAGE session
    s.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => {});
    s.on('Target.attachedToTarget', ({ sessionId: childSid, targetInfo, waitingForDebugger }) => {
      if (waitingForDebugger) this.conn.fire('Runtime.runIfWaitingForDebugger', {}, { sessionId: childSid });
      if (!targetInfo) return;
      if (targetInfo.type === 'worker' || targetInfo.type === 'service_worker' || targetInfo.type === 'shared_worker') {
        const worker = {
          type: targetInfo.type, url: targetInfo.url, sessionId: childSid,
          targetId: targetInfo.targetId, page: this, browser: this.browser,
          close: () => this.conn.send('Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {}),
        };
        this.emit('worker', worker);
        this.browser.emit('worker', worker);
        this.browser.emit(targetInfo.type === 'service_worker' ? 'serviceworker' : 'worker', worker);
        if (this.browser.opts.serviceWorkers === 'block') worker.close();
        return;
      }
      // OOPIF / other nested targets → usable child pages
      if (targetInfo.type === 'iframe' || targetInfo.type === 'webview') {
        const child = new VeloxPage(this.browser, childSid, targetInfo);
        child.isFrame = true;
        child.context = this.context;
        this.browser._knownTargets.set(targetInfo.targetId, child);
        this.browser._pages.add(child);
        child.once('close', () => { this.browser._pages.delete(child); this.browser._knownTargets.delete(targetInfo.targetId); });
        this.emit('frame', child);
        this.browser.emit('frame', child);
        child._init(this.context ? this.context.pageDefaults() : {}).catch(() => {});
      }
    });
    s.on('Fetch.authRequired', (challenge) => {
      // two different challenges share this event: the proxy login and the site login
      const isProxy = String(challenge.authChallenge?.source || '').toLowerCase() === 'proxy';
      const cred = isProxy
        ? (this._proxyCredentials || this.browser?.proxy || null)
        : this._httpCredentials;
      this.session.send('Fetch.continueWithAuth', {
        requestId: challenge.requestId,
        authChallengeResponse: cred?.username
          ? { response: 'ProvideCredentials', username: cred.username, password: cred.password }
          : { response: 'DefaultAuthCredentials' },
      }).catch(() => {});
    });
    // websocket tracking
    s.on('Network.webSocketCreated', ({ requestId, url, initiator }) => {
      const ws = new WebSocketTracker(this, requestId, url);
      this._ws = this._ws || new Map();
      this._ws.set(requestId, ws);
      this.emit('websocket', ws);
    });
    s.on('Network.webSocketFrameSent', ({ requestId, response, timestamp }) => this._ws?.get(requestId)?.frame('sent', response, timestamp));
    s.on('Network.webSocketFrameReceived', ({ requestId, response, timestamp }) => this._ws?.get(requestId)?.frame('received', response, timestamp));
    s.on('Network.webSocketClosed', ({ requestId, timestamp }) => this._ws?.get(requestId)?.closed(timestamp));
    s.on('Network.webSocketHandshakeResponseOccurred', ({ requestId, response }) => this._ws?.get(requestId)?.handshake(response));
    s.on('Inspector.detached', () => { this._closed = true; this.emit('close'); });
    s.on('Page.crashed', () => this.emit('crash'));
    this.conn.on('Target.detachedFromTarget', ({ sessionId, targetId }) => {
      if (sessionId === this.session.sessionId || targetId === this.targetId) { this._closed = true; this.emit('close'); }
    });
  }

  _bumpLife(name) {
    this._life[name] = true;
    const ws = this._lifeWaiters.get(name);
    if (ws) { this._lifeWaiters.delete(name); for (const w of ws) w(); }
    if (name === 'load') { this._bumpLife('DOMContentLoaded'); }
  }

  _waitForLife(name, timeout) {
    if (this._life[name]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this._rmWaiter(name, w); reject(new TimeoutError(`lifecycle ${name}`, timeout)); }, timeout);
      const w = () => { clearTimeout(t); resolve(); };
      if (!this._lifeWaiters.has(name)) this._lifeWaiters.set(name, []);
      this._lifeWaiters.get(name).push(w);
    });
  }

  _rmWaiter(name, w) { const a = this._lifeWaiters.get(name) || []; const i = a.indexOf(w); if (i >= 0) a.splice(i, 1); }

  /* ---------------------------------------------- navigation --------------------------------------------- */

  async goto(url, { waitUntil = 'interactive', timeout, referer } = {}) {
    timeout = timeout ?? getConfig().navTimeout;
    if (this._baseURL && !/^(https?|file|data|about|blob|chrome-error):/i.test(url)) url = new URL(url, this._baseURL).href;
    else if (!/^(https?|file|data|about|blob|chrome-error):/i.test(url)) url = 'https://' + url;
    if (this._fetchReady) await this._fetchReady;   // let Fetch.enable land before navigating
    const t0 = Date.now();
    // apply a pending Playwright-format storage state (cookies + localStorage) on first real navigation
    if (this._pendingStorageState && /^https?:/i.test(url)) {
      const state = this._pendingStorageState;
      this._pendingStorageState = null;
      if (state.cookies?.length) await this.setCookies(state.cookies).catch(() => {});
      const origin = new URL(url).origin;
      const forOrigin = (state.origins || []).find((o) => o.origin === origin);
      if (forOrigin?.localStorage?.length) {
        await this.session.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `(function(){try{${forOrigin.localStorage.map((kv) => `localStorage.setItem(${JSON.stringify(kv.name)}, ${JSON.stringify(kv.value)})`).join(';')}}catch(e){}})()`,
        }).catch(() => {});
      }
    }
    // drop stale lifecycle state (e.g. about:blank's DOMContentLoaded) so the
    // wait below can only be satisfied by THIS navigation's events
    this._life = {};
    this._docResponse = null;
    this._idleDone = false;
    const nav = await this.session.send('Page.navigate', { url, referrer: referer }).catch((e) => { throw new Error(`Navigation failed: ${e.message}`); });
    if (nav.errorText) throw new Error(`Navigation error: ${nav.errorText} (${url})`);
    this._url = url;
    if (waitUntil === 'none') return { url, status: null, ms: Date.now() - t0 };
    const map = { interactive: 'DOMContentLoaded', interactive2: 'domcontentinteractive', load: 'load', networkidle: 'networkIdle2', settle: 'settle' };
    if (waitUntil === 'networkidle' || waitUntil === 'settle') {
      await this._waitForLife('DOMContentLoaded', Math.max(1, timeout - (Date.now() - t0)));
      await this._waitForLife('load', Math.max(1, timeout - (Date.now() - t0)));
      if (waitUntil === 'settle' || !this._capture) await sleep(300);
      else await this._networkIdle(Math.max(1, timeout - (Date.now() - t0)));
    } else {
      await withTimeout(this._waitForLife(map[waitUntil] || 'DOMContentLoaded', timeout * 2), timeout, `goto ${waitUntil}`).catch((e) => { if (!(e instanceof TimeoutError)) throw e; });
    }
    return { url: this._url, status: this._docResponse?.status ?? null, ms: Date.now() - t0 };
  }

  _networkIdle(timeout) {
    if (this._inflight === 0 && this._idleDone) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { clearTimeout(t); reject(new TimeoutError('networkidle', timeout)); }, timeout);
      this._idleWaiters.push(() => { clearTimeout(t); resolve(); });
    });
  }

  _checkIdle() {
    if (this._inflight > 0) return;
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => {
      if (this._inflight === 0) {
        this._bumpLife('networkIdle2'); this._idleDone = true;
        const ws = this._idleWaiters.splice(0); for (const w of ws) w();
      }
    }, 500);
  }

  async reload({ waitUntil = 'interactive', timeout = 30000 } = {}) {
    await this.session.send('Page.reload', { ignoreCache: false }).catch(() => {});
    if (waitUntil !== 'none') await withTimeout(this._waitForLife(waitUntil === 'load' ? 'load' : 'DOMContentLoaded', timeout * 2), timeout, 'reload').catch(() => {});
    return this;
  }
  async _historyGo(delta) {
    const { currentIndex, entries } = await this.session.send('Page.getNavigationHistory');
    const next = entries[currentIndex + delta];
    if (!next) return false;
    await this.session.send('Page.navigateToHistoryEntry', { entryId: next.id });
    return true;
  }
  back() { return this._historyGo(-1); }
  forward() { return this._historyGo(1); }
  wait(ms_) { return sleep(ms_); }
  async waitForLoad(state = 'load', timeout = 30000) {
    const ev = state === 'networkidle' ? null : (state === 'interactive' ? 'DOMContentLoaded' : state);
    if (ev) { await withTimeout(this._waitForLife(ev, timeout * 2), timeout, `waitForLoad ${state}`).catch((e) => { if (!(e instanceof TimeoutError)) throw e; }); return true; }
    try { await this._networkIdle(timeout); return true; } catch { return false; }
  }
  async waitForUrl(match, timeout = 30000) {
    const re = match instanceof RegExp ? match : globToRe(String(match));
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        if (re.test(this._url)) { clearInterval(iv); resolve(this._url); }
        else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new TimeoutError(`waitForUrl ${match}`, timeout)); }
      }, 60);
    });
  }

  /* ----------------------------------------------- evaluate ---------------------------------------------- */

  async eval(jsOrFn, arg, { awaitPromise = true, timeout } = {}) {
    const js = typeof jsOrFn === 'function' ? buildEvalExpr(jsOrFn, arg) : jsOrFn;
    try {
      const { result, exceptionDetails } = await this.session.send('Runtime.evaluate', {
        expression: js, returnByValue: true, awaitPromise,
      }, ...(timeout ? [{ timeout }] : []));
      if (exceptionDetails) throw new Error(`Eval error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result?.value;
    } catch (e) {
      // auto-heal: page raced past engine injection — install it and retry once
      if (/__vlx/.test(js) && /is not defined|Can't find variable/.test(e.message)) {
        await this.session.send('Runtime.evaluate', { expression: ENGINE_SOURCE }).catch(() => {});
        const { result, exceptionDetails } = await this.session.send('Runtime.evaluate', {
          expression: js, returnByValue: true, awaitPromise,
        });
        if (exceptionDetails) throw new Error(`Eval error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
        return result?.value;
      }
      throw e;
    }
  }
  /** Alias matching Playwright's name. */
  evaluate(jsOrFn, arg, opts) { return this.eval(jsOrFn, arg, opts); }

  /** Sync evaluation — every __vlx data function is synchronous, so skip promise awaiting. */
  evalSync(js) { return this.eval(js, undefined, { awaitPromise: false }); }

  /** Evaluate and return a remote-object handle instead of a value. */
  async evaluateHandle(jsOrFn, arg) {
    const js = typeof jsOrFn === 'function' ? buildEvalExpr(jsOrFn, arg) : jsOrFn;
    const { result, exceptionDetails } = await this.session.send('Runtime.evaluate', {
      expression: js, returnByValue: false, awaitPromise: false,
    });
    if (exceptionDetails) throw new Error(`Eval error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    if (!result?.objectId) return new JSHandle(this, null, String(result?.value)); // primitives
    const kind = (await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function(){ return (this && this.nodeType === 1) ? "element" : "object" }',
      objectId: result.objectId, returnByValue: true,
    }).catch(() => ({ result: { value: 'object' } }))).result?.value;
    return kind === 'element' ? new ElementHandle(this, result.objectId, result.description) : new JSHandle(this, result.objectId, result.description);
  }

  /** Element handle for the first match of a selector. */
  async elementHandle(sel) {
    return this.evaluateHandle(`(function(){ if (typeof __vlx !== 'object') { ${ENGINE_SOURCE} } return __vlx.one(${JSON.stringify(sel)}) })()`);
  }
  async elementHandles(sel) {
    return this.evaluateHandle(`(function(){ if (typeof __vlx !== 'object') { ${ENGINE_SOURCE} } return __vlx.match(${JSON.stringify(sel)}) })()`)
      .then(async (arr) => {
        const props = await arr.getProperties();
        await arr.dispose();
        return Object.values(props).filter((h) => h instanceof JSHandle).map((h) => new ElementHandle(this, h.objectId, h._preview));
      });
  }

  /** $eval(sel, fn, arg) — run fn(element, arg) in the page on the first match. */
  async $eval(sel, fn, arg, filters) {
    return this.eval(String.raw`(function(){var el=__vlx.pick(${JSON.stringify(sel)}${filters && Object.keys(filters).length ? ',' + JSON.stringify(filters) : ''});if(!el)throw new Error('no element for ${String(sel).replace(/'/g, "\\'")}');return (${fn.toString()})(el,${JSON.stringify(arg ?? null)})})()`);
  }
  /** $$eval(sel, fn, arg) — run fn(elements, arg) over all matches. */
  async $$eval(sel, fn, arg) {
    return this.eval(String.raw`(function(){var els=__vlx.match(${JSON.stringify(sel)});if(!els.length)throw new Error('no elements for ${String(sel).replace(/'/g, "\\'")}');return (${fn.toString()})(els,${JSON.stringify(arg ?? null)})})()`);
  }

  _root() {
    return this._rootOverride
      ? `__vlx.one(${JSON.stringify(this._rootOverride)})?.contentDocument || (()=>{throw new Error('iframe not found: ' + ${JSON.stringify(this._rootOverride)})})()`
      : 'undefined';
  }
  _x(fn, ...args) { return `__vlx.${fn}(${args.map((a) => JSON.stringify(a)).join(',')}${this._rootOverride ? `,${this._root()}` : ''})`; }

  /** True when the engine is live in the current document (re-injects if a page wiped it). */
  async _ensureEngine() {
    const ok = await this.session.send('Runtime.evaluate', { expression: 'typeof __vlx === "object" && !!__vlx.match' })
      .then((r) => r.result?.value).catch(() => false);
    if (!ok) await this.session.send('Runtime.evaluate', { expression: ENGINE_SOURCE }).catch(() => {});
  }

  /* ------------------------------------------- speed: batching ------------------------------------------- */

  /**
   * Run several actions over one pipelined flush. Each entry is [method, ...args]
   * or a function receiving the page. Independent actions then fly together instead
   * of paying a full round-trip each.
   *   await page.batch([['click','#a'], ['fill','#b','x'], ['text','h1']]);
   */
  async batch(actions, { concurrency = 0 } = {}) {
    const run = (a) => (typeof a === 'function' ? a(this) : this[a[0]].apply(this, a.slice(1)));
    const list = actions.map((a, i) => ({ a, i }));
    if (!concurrency || concurrency >= list.length) return Promise.all(list.map(({ a }) => run(a)));
    const out = new Array(actions.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= actions.length) return;
        out[idx] = await run(actions[idx]);
      }
    }));
    return out;
  }

  /**
   * Register a custom in-page selector engine: use it as `name=value`.
   *   await page.addSelectorEngine('belowfold', (value, root) =>
   *     [...root.querySelectorAll(value)].filter(el => el.getBoundingClientRect().top > 0));
   */
  async addSelectorEngine(name, fn) {
    const src = typeof fn === 'function' ? fn.toString() : fn;
    await this.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){ var e = (window.__vlx = window.__vlx || {}); var c = e.custom = e.custom || {}; c[${JSON.stringify(name)}] = (0, eval)('(' + ${JSON.stringify(src)} + ')'); })()`,
    }).catch(() => {});
    return this.eval(`(function(){ var e = window.__vlx || {}; var c = e.custom || (e.custom = {}); c[${JSON.stringify(name)}] = ${src}; return true })()`);
  }

  /** Pre-parse selectors inside the page so subsequent actions skip parsing. */
  async warm(selectors) {
    const list = [].concat(selectors);
    return this.evalSync(`__vlx.warm(${JSON.stringify(list)})`);
  }


  /* ---------------------------------------------- selectors ---------------------------------------------- */

  $(sel) { return new Locator(this, sel); }
  locator(sel) { return new Locator(this, sel); }

  // Playwright-style locator factories
  getByRole(role, opts = {}) { return new Locator(this, byRoleSel(role, opts)); }
  getByText(text, opts = {}) { return new Locator(this, byTextSel(text, opts.exact)); }
  getByLabel(text, opts = {}) { return new Locator(this, byLabelSel(text, opts.exact)); }
  getByPlaceholder(text, opts = {}) { return new Locator(this, byPlaceholderSel(text, opts.exact)); }
  getByAltText(text, opts = {}) { return new Locator(this, byAltTextSel(text, opts.exact)); }
  getByTitle(text, opts = {}) { return new Locator(this, byTitleSel(text, opts.exact)); }
  getByTestId(id) { return new Locator(this, byTestIdSel(id)); }

  $$(sel) { return this.extract(sel, { tag: true }); }

  text(sel) { return this.evalSync(this._x('text', sel)); }
  attr(sel, name) { return this.evalSync(this._x('attr', sel, name)); }
  html(sel) { return this.evalSync(this._x('html', sel)); }
  count(sel) { return this.evalSync(this._x('count', sel)); }
  async exists(sel) { return (await this.count(sel)) > 0; }
  val(sel) { return this.evalSync(this._x('val', sel)); }

  /** Batch extraction — one round-trip for N elements × M fields. The workhorse. */
  extract(sel, spec = { text: true }) { return this.evalSync(this._x('extract', sel, spec)); }
  texts(sel, limit) { return this.evalSync(this._x('texts', sel, limit || 0)); }
  attrs(sel, name, limit) { return this.evalSync(this._x('attrs', sel, name, limit || 0)); }

  async waitForSelector(sel, opts = {}) {
    const { state = 'visible', _filters } = opts;
    const { timeout } = this._to(opts);
    const deadline = Date.now() + timeout;
    const expr = (_filters && Object.keys(_filters).length)
      ? `__vlx.waitPick(${JSON.stringify(sel)}, ${JSON.stringify(_filters)}, SLICE, ${JSON.stringify(state)})`
      : `__vlx.wait(${JSON.stringify(sel)}, SLICE, ${JSON.stringify(state)}${this._rootOverride ? ', ' + this._root() : ''})`;
    for (;;) {
      const slice = Math.max(300, Math.min(1500, deadline - Date.now()));
      const finalExpr = expr.replace(/SLICE/g, String(slice));
      try {
        const ok = await withTimeout(this.eval(finalExpr, undefined, { awaitPromise: true }), slice + 1500, 'wait-slice');
        if (ok === true) return this.$(sel);
        if (ok === 'timeout') {
          if (Date.now() >= deadline) throw new TimeoutError(`selector ${sel} (${state})`, timeout);
          continue;
        }
      } catch (e) {
        // navigation destroyed the context mid-wait — retry until the deadline
        if ((e instanceof TimeoutError && e.message.includes('wait-slice')) ||
            /Execution context|cannot find default|not of type/i.test(e.message)) {
          if (Date.now() >= deadline) throw new TimeoutError(`selector ${sel} (${state})`, timeout);
          await sleep(60);
          continue;
        }
        throw e;
      }
    }
  }
  async waitForFunction(js, { timeout = 10000, message } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const slice = Math.max(300, Math.min(1500, deadline - Date.now()));
      try {
        return await withTimeout(
          this.eval(`__vlx.waitExpr(${JSON.stringify(js)}, ${slice})`, undefined, { awaitPromise: true }),
          slice + 1500, 'waitfn-slice'
        );
      } catch (e) {
        if ((e instanceof TimeoutError && e.message.includes('waitfn-slice')) ||
            /Execution context|cannot find default|is not defined/i.test(e.message)) {
          if (Date.now() >= deadline) throw new TimeoutError(message || js, timeout);
          await sleep(60);
          continue;
        }
        throw e;
      }
    }
  }

  /* ------------------------------------------------ actions --------------------------------------------- */

  async click(sel, opts = {}) {
    const { button = 'left', clicks = 1, modifiers = [], delay = 0, inPage = false, _filters } = opts;
    const { timeout } = this._to(opts);
    await withTimeout(this.waitForSelector(sel, { timeout, state: 'visible', _filters }), timeout, `click ${sel}`).catch((e) => { if (e instanceof TimeoutError && timeout <= 0) {} else throw e; });
    if (inPage) { await this.eval(this._x('clickInPage', sel)); return; }
    const p = await this.evalSync(_filters && Object.keys(_filters).length
      ? `__vlx.point(__vlx.pick(${JSON.stringify(sel)},${JSON.stringify(_filters)}))`
      : this._x('point', sel));
    if (!p) throw new Error(`Not clickable: ${sel}`);
    await this.mouse.click(p.x, p.y, { button, clicks, modifiers, delay });
    return this;
  }

  async hover(sel, { timeout = 10000 } = {}) {
    await withTimeout(this.waitForSelector(sel, { timeout, state: 'visible' }), timeout, `hover ${sel}`);
    const p = await this.evalSync(this._x('point', sel));
    if (p) await this.mouse.move(p.x, p.y, { steps: 3 });
    return this;
  }
  async focus(sel) { return this.eval(this._x('focus', sel)); }

  /** Fast untrusted fill: sets value + fires input/change events. One round-trip. */
  async fill(sel, value, opts = {}) {
    const { _filters } = opts;
    const { timeout } = this._to(opts);
    await withTimeout(this.waitForSelector(sel, { timeout, _filters }), timeout, `fill ${sel}`);
    const ok = await this.evalSync(_filters && Object.keys(_filters).length
      ? `__vlx.fill(__vlx.pick(${JSON.stringify(sel)},${JSON.stringify(_filters)}), ${JSON.stringify(value)})`
      : this._x('fill', sel, value));
    if (!ok) throw new Error(`Cannot fill: ${sel}`);
    return this;
  }

  /** Trusted per-key typing. human=true adds jittered delays. */
  async type(sel, text, opts = {}) {
    const { delay = 0, human = false, _filters } = opts;
    const { timeout } = this._to(opts);
    await withTimeout(this.waitForSelector(sel, { timeout, state: 'visible', _filters }), timeout, `type ${sel}`);
    await this.evalSync(_filters && Object.keys(_filters).length
      ? `__vlx.focus(__vlx.pick(${JSON.stringify(sel)},${JSON.stringify(_filters)}))`
      : this._x('focus', sel));
    for (const ch of String(text)) {
      await this.keyboard.sendChar(ch);
      if (human) await humanDelay(delay || 70);
      else if (delay) await sleep(delay);
    }
    return this;
  }

  /** Mouse-based drag & drop between two selectors (HTML5 and mouse-driven UIs). */
  async dragAndDrop(source, target, { steps = 12, _srcFilters, _dstFilters } = {}) {
    const srcExpr = _srcFilters && Object.keys(_srcFilters).length
      ? `__vlx.point(__vlx.pick(${JSON.stringify(source)},${JSON.stringify(_srcFilters)}))`
      : this._x('point', source);
    const dstExpr = _dstFilters && Object.keys(_dstFilters).length
      ? `__vlx.point(__vlx.pick(${JSON.stringify(target)},${JSON.stringify(_dstFilters)}))`
      : this._x('point', target);
    await withTimeout(this.waitForSelector(source, { timeout: 10000, state: 'visible', _filters: _srcFilters }), 10000, `drag ${source}`);
    await withTimeout(this.waitForSelector(target, { timeout: 10000, state: 'attached', _filters: _dstFilters }), 10000, `drop ${target}`);
    const [a, b] = await Promise.all([this.evalSync(srcExpr), this.evalSync(dstExpr)]);
    if (!a || !b) throw new Error(`Cannot drag: ${source} → ${target}`);
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none' });
    await this.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
    // nudge to kick off HTML5 drag, then travel to the target
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left',
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      });
      await sleep(16);
    }
    await this.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    return this;
  }

  async press(key, { modifiers = [] } = {}) {
    for (const m of modifiers) await this.keyboard.down(m);
    await this.keyboard.press(key);
    for (const m of modifiers.reverse()) await this.keyboard.up(m);
    return this;
  }

  async scrollBy(dx, dy) { return this.eval(`__vlx.scrollBy(${dx},${dy})`); }
  async scrollToBottom() {
    for (;;) {
      const [x, y, h, more] = await this.evalSync('__vlx.scrollTop()');
      if (!more || y + innerHeight >= h - 2) break;
      await this.eval(`__vlx.scrollBy(0, ${Math.min(1200, h - y)})`);
      await sleep(120);
    }
  }

  get keyboard() {
    const self = this;
    return {
      async down(k) { self._modifiers |= 0; return self.session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...normKey(k, 'down') }); },
      async up(k) { return self.session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...normKey(k, 'up') }); },
      async press(k) {
        await self.session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...normKey(k, 'down') });
        if (KEYMAP[String(k).toLowerCase()]?.text) await self.session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...normKey(k, 'down'), text: KEYMAP[String(k).toLowerCase()].text });
        await self.session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...normKey(k, 'up') });
      },
      async sendChar(ch) {
        const code = /[a-z0-9]/i.test(ch) ? 'Key' + ch.toUpperCase() : undefined;
        await self.session.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: ch, text: ch, unmodifiedText: ch,
          windowsVirtualKeyCode: ch.length === 1 ? ch.toUpperCase().charCodeAt(0) : undefined, ...(code ? { code } : {}),
        });
        await self.session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, ...(code ? { code } : {}) });
      },
      async type(text, { delay = 0, human = false } = {}) {
        for (const ch of String(text)) { await this.sendChar(ch); if (human) await humanDelay(delay || 60); else if (delay) await sleep(delay); }
      },
      async insertText(text) { return self.session.send('Input.insertText', { text: String(text) }); },
    };
  }

  get mouse() {
    const self = this;
    const BTN = { left: 1, middle: 4, right: 2, none: 0 };
    return {
      async move(x, y, { steps = 1 } = {}) {
        const from = { ...self._mouse };
        for (let i = 1; i <= steps; i++) {
          const nx = from.x + (x - from.x) * (i / steps), ny = from.y + (y - from.y) * (i / steps);
          await self.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny, button: 'none' });
        }
        self._mouse = { x, y };
      },
      async click(x, y, { button = 'left', clicks = 1, modifiers = [], delay = 10 } = {}) {
        const mod = modifiers.reduce((m, k) => m | ({ alt: 1, ctrl: 2, meta: 4, shift: 8 }[k] || 0), 0);
        await this.move(x, y, { steps: 2 });
        for (let c = 0; c < clicks; c++) {
          await self.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, modifiers: mod });
          if (delay) await sleep(delay);
          await self.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, modifiers: mod });
          if (c < clicks - 1 && delay) await sleep(delay * 2);
        }
      },
      async dblclick(x, y, o = {}) { return this.click(x, y, { ...o, clicks: 2 }); },
      async down(button = 'left') { return self.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: self._mouse.x, y: self._mouse.y, button, clickCount: 1 }); },
      async up(button = 'left') { return self.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: self._mouse.x, y: self._mouse.y, button, clickCount: 1 }); },
      async wheel(dx, dy) { return self.session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: self._mouse.x, y: self._mouse.y, deltaX: dx, deltaY: dy }); },
      async humanMove(x, y, { steps } = {}) {
        // bezier-ish human cursor path
        const n = steps || randInt(15, 30);
        const from = { ...self._mouse };
        const cx = (from.x + x) / 2 + randInt(-80, 80), cy = (from.y + y) / 2 + randInt(-80, 80);
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          const nx = u * u * from.x + 2 * u * t * cx + t * t * x;
          const ny = u * u * from.y + 2 * u * t * cy + t * t * y;
          await self.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny, button: 'none' });
          await sleep(randInt(4, 14));
        }
        self._mouse = { x, y };
      },
    };
  }

  get touch() {
    const self = this;
    return {
      async tap(x, y) {
        const points = [{ x, y }];
        await self.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
        await self.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async swipe(x1, y1, x2, y2, { steps = 12 } = {}) {
        await self.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
        for (let i = 1; i <= steps; i++) {
          await self.session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }],
          });
          await sleep(16);
        }
        await self.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
    };
  }

  /* ----------------------------------------------- document --------------------------------------------- */

  url() { return this.eval('location.href'); }
  title() { return this.eval('document.title'); }
  content() { return this.eval('document.documentElement.outerHTML'); }
  async setContent(html, { timeout = 10000 } = {}) {
    await this.session.send('Page.navigate', { url: 'about:blank' });
    await this.eval(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
    await this._waitForLife('DOMContentLoaded', timeout).catch(() => {});
    return this;
  }
  /** plain-text markdown-ish rendering of the page */
  async readable() {
    return this.eval(String.raw`(function(){
      var clone = document.body.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,svg,template').forEach(function(e){e.remove()});
      var out=[]; var walk=function(el,depth){
        for (var n of el.childNodes){
          if (n.nodeType===3){ var t=n.textContent.trim(); if(t) out.push(t); }
          else if (n.nodeType===1){
            var tag=n.tagName.toLowerCase();
            if (/^(h[1-6])$/.test(tag)) out.push('\n'+'#'.repeat(+tag[1])+' '+n.textContent.trim()+'\n');
            else if (tag==='p'||tag==='li') { out.push('\n'); walk(n, depth+1); out.push('\n'); }
            else if (tag==='br') out.push('\n');
            else if (tag==='img') { var alt=n.getAttribute('alt'); if(alt) out.push('[img: '+alt+']'); }
            else walk(n, depth+1);
          }
        }
      };
      walk(clone,0);
      return out.join(' ').replace(/\n\s*\n\s*\n+/g,'\n\n').replace(/[ \t]+/g,' ');
    })()`);
  }
  links() { return this.extract('a[href]', { text: true, attrs: ['href'], tag: true }); }
  images() { return this.extract('img', { attrs: ['src', 'alt', 'loading'], tag: true }); }
  tables() {
    return this.eval(`(function(){return Array.from(document.querySelectorAll('table')).map(function(t){
      return {headers:Array.from(t.querySelectorAll('th')).map(function(h){return h.textContent.trim()}),
        rows:Array.from(t.querySelectorAll('tr')).map(function(tr){return Array.from(tr.querySelectorAll('td')).map(function(td){return td.textContent.trim()})}).filter(function(r){return r.length})};
    })})()`);
  }
  forms() {
    return this.eval(`(function(){return Array.from(document.forms).map(function(f){return {
      action:f.action, method:f.method,
      fields:Array.from(f.elements).map(function(e){return {name:e.name,type:e.type,value:e.value,required:e.required}})
    }})})()`);
  }
  meta() {
    return this.eval(`(function(){var o={title:document.title};
      Array.from(document.querySelectorAll('meta')).forEach(function(m){var k=m.getAttribute('name')||m.getAttribute('property'); if(k) o[k]=m.getAttribute('content')});
      Array.from(document.querySelectorAll('link[rel]')).forEach(function(l){var r=l.getAttribute('rel'); if(/canonical|alternate|icon/.test(r)) o['link_'+r]=l.getAttribute('href')});
      return o;})()`);
  }
  jsonld() { return this.eval(`(function(){try{return Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){return JSON.parse(s.textContent)})}catch(e){return []}})()`); }

  /* ------------------------------------------- frames (same-origin) -------------------------------------- */

  /** Scope all selector calls inside an iframe: page.inFrame('#comments').$('div') */
  inFrame(sel) {
    const scoped = Object.create(this);
    scoped._rootOverride = sel;
    scoped.$ = (s) => new Locator(scoped, s);
    return scoped;
  }
  async frameTree() {
    const { frameTree } = await this.session.send('Page.getFrameTree');
    const flat = [];
    (function walk(node, depth) {
      flat.push({ id: node.frame.id, url: node.frame.url, name: node.frame.name, parentId: node.frame.parentId, depth });
      (node.childFrames || []).forEach((c) => walk(c, depth + 1));
    })(frameTree, 0);
    return flat;
  }

  /* ---------------------------------------------- screenshots -------------------------------------------- */

  async screenshot({ path, full = false, selector, type = 'png', quality = 80, fast = false, clip, mask, animations } = {}) {
    let maskId = null, froze = false;
    try {
      if (animations === 'disabled') { froze = true; await this.evalSync('__vlx.freezeAnimations()'); }
      if (mask?.length) { maskId = await this.evalSync(`__vlx.mask(${JSON.stringify(mask)})`); }
      let clipArg = clip || undefined;
      if (selector) {
        const r = await this.evalSync(this._x('rect', selector));
        if (!r) throw new Error(`No element for screenshot: ${selector}`);
        const [sx, sy] = await this.evalSync('[scrollX, scrollY]');
        clipArg = { x: r.x + sx, y: r.y + sy, width: r.width, height: r.height, scale: 1 };
      } else if (full) {
        let cs = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const m = await this.session.send('Page.getLayoutMetrics');
          cs = m.cssContentSize || m.contentSize;
          if (cs && cs.width > 0 && cs.height > 0) break;
          await sleep(120); // layout not ready yet (page just navigated)
        }
        if (!cs || cs.width <= 0 || cs.height <= 0) {
          const v = await this.session.send('Page.getLayoutMetrics');
          cs = v.cssVisualViewport || v.contentSize || { width: 1280, height: 720 };
        }
        clipArg = { x: 0, y: 0, width: Math.max(1, Math.ceil(cs.width)), height: Math.max(1, Math.ceil(cs.height)), scale: 1 };
      }
      const { data } = await this.session.send('Page.captureScreenshot', {
        format: type, quality: type === 'jpeg' ? quality : undefined,
        ...(clipArg ? { clip: clipArg, captureBeyondViewport: true } : {}),
        ...(fast && type === 'png' ? { optimizeForSpeed: true } : {}),
      });
      if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(data, 'base64')); }
      return Buffer.from(data, 'base64');
    } finally {
      if (maskId) await this.evalSync(`__vlx.unmask(${JSON.stringify(maskId)})`).catch(() => {});
      if (froze) await this.evalSync('__vlx.unfreezeAnimations()').catch(() => {});
    }
  }

  async pdf({ path, format = 'A4', landscape = false, printBackground = true, margin, scale = 1, headerTemplate, footerTemplate, preferCSSPageSize = false } = {}) {
    const PAPER = { A4: [8.27, 11.69], Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17] };
    const [w, h] = PAPER[format] || (typeof format === 'object' ? format : PAPER.A4);
    const { data } = await this.session.send('Page.printToPDF', {
      landscape, printBackground, scale, preferCSSPageSize,
      paperWidth: w, paperHeight: h,
      marginTop: margin?.top ?? 0.4, marginBottom: margin?.bottom ?? 0.4,
      marginLeft: margin?.left ?? 0.4, marginRight: margin?.right ?? 0.4,
      displayHeaderFooter: !!(headerTemplate || footerTemplate),
      headerTemplate: headerTemplate || '<span></span>', footerTemplate: footerTemplate || '<span></span>',
    });
    if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(data, 'base64')); }
    return Buffer.from(data, 'base64');
  }

  /* ----------------------------------------------- emulation --------------------------------------------- */

  async setViewport(width, height, { mobile = false, dsf = 1 } = {}) {
    await this.session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile });
    return this;
  }
  async setUA(ua, platform) {
    await this.session.send('Network.setUserAgentOverride', { userAgent: ua, ...(platform ? { platform } : {}) });
    return this;
  }
  async setHeaders(headers) {
    this._extraHeaders = headers;
    await this.session.send('Network.setExtraHTTPHeaders', { headers });
    return this;
  }
  async setLocale(locale) { await this.session.send('Emulation.setLocaleOverride', { locale }); return this; }
  async setTimezone(tz) { await this.session.send('Emulation.setTimezoneOverride', { timezoneId: tz }); return this; }
  async setGeolocation({ latitude, longitude, accuracy = 100 }) {
    await this.session.send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy });
    await this.session.send('Browser.grantPermissions', { permissions: ['geolocation'] }).catch(() => {});
    return this;
  }
  async colorScheme(scheme = 'dark') { await this.session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); return this; }
  async reducedMotion(v = 'reduce') { await this.session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] }); return this; }
  async emulate(device) {
    const d = typeof device === 'string' ? (registeredDevices()[device] || DEVICES[device]) : device;
    if (!d) throw new Error(`Unknown device "${device}". Known: ${Object.keys({ ...DEVICES, ...registeredDevices() }).join(', ')}`);
    const jobs = [this.setViewport(d.width, d.height, { mobile: d.mobile, dsf: d.dsf })];
    if (d.ua) jobs.push(this.setUA(d.ua, d.platform));
    if (d.touch) jobs.push(this.session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }));
    if (d.locale) jobs.push(this.setLocale(d.locale));
    await Promise.all(jobs);
    return this;
  }

  /* ------------------------------------------- cookies & storage ----------------------------------------- */

  async cookies(urls) {
    const target = urls ? [].concat(urls) : (/^https?:/.test(this._url) ? [this._url] : undefined);
    return (await this.session.send('Network.getCookies', target ? { urls: target } : {})).cookies;
  }
  async setCookies(cookies) {
    const list = [].concat(cookies).map((c) => ({ ...c, url: c.url || (c.domain ? undefined : this._url) }));
    await this.session.send('Network.setCookies', { cookies: list });
    return this;
  }
  async clearCookies() { await this.session.send('Network.clearBrowserCookies'); return this; }
  async localStorage() { return this.eval('__vlx.storage()'); }
  async restoreStorage(data) { return this.eval(`__vlx.restoreStorage(${JSON.stringify(data)})`); }
  async setLocalStorage(k, v) { return this.eval(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`); }
  /** Save a portable session (cookies + web storage) to disk or return object. */
  async saveSession(path) {
    const data = { url: this._url, cookies: await this.cookies(), storage: await this.localStorage() };
    if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2)); }
    return data;
  }
  async loadSession(pathOrData) {
    const data = typeof pathOrData === 'string' ? JSON.parse((await import('node:fs')).readFileSync(pathOrData, 'utf8')) : pathOrData;
    if (data.cookies?.length) await this.setCookies(data.cookies);
    if (data.storage) await this.restoreStorage(data.storage);
    return this;
  }

  /* ------------------------------------------------ network ---------------------------------------------- */

  _onRequest({ requestId, request, type, frameId, redirectResponse, timestamp, wallTime }) {
    const existing = this._requests.get(requestId);
    if (existing && redirectResponse) {
      // same requestId continues after a redirect: close the hop, chain it, keep counting inflight
      (existing.redirectChain ||= []).push({ url: existing.url, status: redirectResponse.status, headers: redirectResponse.headers });
      existing.response = { status: redirectResponse.status, headers: redirectResponse.headers, url: redirectResponse.url };
      existing.done = true; existing.encodedDataLength = redirectResponse.encodedDataLength;
    }
    if (!existing || redirectResponse) {
      const entry = {
        id: requestId, url: request.url, method: request.method, headers: request.headers,
        resourceType: type, frameId, postData: request.postData, wallTime,
        response: null, done: false, body: undefined, failed: null, page: this,
        ...(existing?.redirectChain ? { redirectChain: existing.redirectChain } : {}),
      };
      this._requests.set(requestId, entry);
      if (!existing) { this._reqOrder.push(requestId); this._inflight++; }
      this.emit('request', entry);
    }
    // main document tracking: requestWillBeSent can beat frameNavigated, so
    // accept Document requests while the main frame id is still unknown
    if (type === 'Document' && !this._docResponse && (frameId === this._mainFrameId || !this._mainFrameId)) {
      this._docResponse = { url: request.url, status: null };
    }
  }

  _onResponse({ requestId, response, timestamp, frameId, type }) {
    const e = this._requests.get(requestId);
    if (!e) return;
    e.response = { status: response.status, statusText: response.statusText, headers: response.headers, url: response.url, remoteIP: response.remoteIPAddress, protocol: response.protocol, timing: response.timing, fromCache: response.fromDiskCache, security: response.securityDetails?.protocol };
    if ((e.resourceType ?? type) === 'Document' && (frameId === this._mainFrameId || !this._mainFrameId)) {
      this._docResponse = { url: response.url, status: response.status, headers: response.headers };
    }
    this.emit('response', e);
  }

  _onDone(requestId, timestamp, encodedDataLength, failInfo) {
    const e = this._requests.get(requestId);
    if (!e || e.done) return;
    e.done = true; e.encodedDataLength = encodedDataLength ?? 0;
    if (failInfo) { e.failed = failInfo.errorText || failInfo.blockedReason || 'failed'; e.canceled = !!failInfo.canceled; }
    this._inflight = Math.max(0, this._inflight - 1);
    this._checkIdle();
    this.emit('requestfinished', e);
  }

  /** All captured requests (in order). */
  requests({ filter } = {}) {
    let list = this._reqOrder.map((id) => this._requests.get(id)).filter(Boolean);
    if (filter) list = list.filter(filter);
    return list;
  }
  async body(entryOrId) {
    const e = typeof entryOrId === 'string' ? this._requests.get(entryOrId) : entryOrId;
    if (!e) return null;
    if (e.body !== undefined) return e.body;
    try {
      const { body, base64Encoded } = await this.session.send('Network.getResponseBody', { requestId: e.id });
      e.body = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    } catch { e.body = null; }
    return e.body;
  }
  async har({ withBodies = true } = {}) {
    const entries = this.requests();
    const out = [];
    for (const e of entries) {
      let content = undefined;
      if (withBodies && e.response && !e.failed) {
        try {
          const b = await this.session.send('Network.getResponseBody', { requestId: e.id }).catch(() => null);
          if (b) content = { text: b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body, encoding: b.base64Encoded ? 'base64' : undefined };
        } catch {}
      }
      out.push({ e, content });
    }
    return buildHar(out);
  }

  /** Block by URL list (uses browser-native blocking — zero overhead). Supports plain domains or glob URLs. */
  async block(urls) {
    for (const u of [].concat(urls)) this._blocked.add(u);
    const patterns = [...this._blocked].map((u) =>
      u.includes('*') || u.includes('://') ? u : `*://${u}/*`
    );
    await this.session.send('Network.setBlockedURLs', { urls: patterns });
    return this;
  }
  async unblock() { this._blocked.clear(); await this.session.send('Network.setBlockedURLs', { urls: [] }); return this; }

  /** Advanced interception: page.route('**/api/**', req => req.fulfill({ body: '[]' })) */
  route(pattern, handler) {
    // idempotent: same pattern + handler twice registers once
    if (this._routes.some((r) => r.handler === handler && r.rawPattern === pattern)) return this;
    this._routes.push({ match: pattern instanceof RegExp ? pattern : globToRe(String(pattern)), handler, rawPattern: pattern });
    if (!this._fetchOn) {
      this._fetchOn = true;
      this._fetchReady = this.session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }], ...(this._httpCredentials ? { handleAuthRequests: true } : {}) }).catch(() => {});
    }
    return this;
  }
  unroute(pattern) {
    const re = pattern instanceof RegExp ? pattern : globToRe(String(pattern));
    this._routes = this._routes.filter((r) => String(r.match) !== String(re));
    if (!this._routes.length && this._fetchOn) { this._fetchOn = false; this.session.send('Fetch.disable').catch(() => {}); }
    return this;
  }
  /** One-liner API mock. */
  mock(urlPattern, response) {
    return this.route(urlPattern, (req) => req.fulfill(typeof response === 'function' ? response(req) : response));
  }

  async _armBandwidth() {
    const patterns = [{ urlPattern: '*' }];
    if (this._bw.maxBytes) patterns.push({ urlPattern: '*', requestStage: 'Response' });
    this._fetchOn = true;
    await this.session.send('Fetch.enable', {
      patterns,
      ...(this._httpCredentials || this._proxyCredentials ? { handleAuthRequests: true } : {}),
    }).catch(() => {});
    return this;
  }

  async _onPaused(p) {
    const { requestId, request, resourceType } = p;

    // ── response stage: enforce the byte cap before the body streams ──────────
    if (p.responseStatusCode !== undefined || p.responseHeaders !== undefined) {
      const rules = this._bw;
      if (rules?.maxBytes) {
        const len = Number((p.responseHeaders || []).find((h) => h.name.toLowerCase() === 'content-length')?.value || 0);
        if (len > rules.maxBytes) {
          this._bytesBlocked += len;
          const key = `oversize:${resourceType}`;
          this._blockedByType[key] = (this._blockedByType[key] || 0) + 1;
          return this.session.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {});
        }
      }
      const ok = await this.session.send('Fetch.continueResponse', { requestId }).catch(() => null);
      if (ok === null) await this.session.send('Fetch.continueRequest', { requestId }).catch(() => {});
      return;
    }

    // ── request stage: resource-type + third-party filtering ─────────────────
    const rules = this._bw;
    if (rules && (rules.blockTypes.size || rules.blockThirdParty)) {
      let reason = null;
      if (rules.blockTypes.has(resourceType)) reason = `type:${resourceType}`;
      else if (rules.blockThirdParty && this._url && /^https?:/.test(this._url)) {
        try {
          if (!sameSite(new URL(request.url).hostname, new URL(this._url).hostname)) reason = `third-party:${resourceType}`;
        } catch {}
      }
      if (reason) {
        this._blockedByType[reason] = (this._blockedByType[reason] || 0) + 1;
        this.emit('blocked', { url: request.url, reason, resourceType });
        return this.session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    }

    // basic-auth challenge
    if (p.authChallenge) {
      const cred = this._httpCredentials;
      return this.session.send('Fetch.continueWithAuth', {
        requestId,
        authChallengeResponse: cred
          ? { response: 'ProvideCredentials', username: cred.username, password: cred.password }
          : { response: 'DefaultAuthCredentials' },
      }).catch(() => {});
    }

    const req = {
      id: requestId, url: request.url, method: request.method, headers: request.headers,
      resourceType, postData: request.postData, page: this, _handled: false,
      fulfill({ status = 200, headers = {}, body = '', contentType, path: filePath }) {
        if (this._handled) return Promise.resolve(); this._handled = true;
        let buf = Buffer.isBuffer(body) ? body : Buffer.from(filePath ? readFileSync(filePath) : body);
        const hdrs = Object.entries({ ...(contentType ? { 'content-type': contentType } : {}), ...headers }).map(([name, value]) => ({ name, value: String(value) }));
        return this.page.session.send('Fetch.fulfillRequest', {
          requestId, responseCode: status, responseHeaders: hdrs,
          body: buf.toString('base64'),
        });
      },
      abort(reason = 'BlockedByClient') {
        if (this._handled) return Promise.resolve(); this._handled = true;
        return this.page.session.send('Fetch.failRequest', { requestId, errorReason: reason }).catch(() => {});
      },
      continue(overrides = {}) {
        if (this._handled) return Promise.resolve(); this._handled = true;
        return this.page.session.send('Fetch.continueRequest', {
          requestId,
          ...(overrides.url ? { url: overrides.url } : {}),
          ...(overrides.method ? { method: overrides.method } : {}),
          ...(overrides.headers ? { headers: Object.entries(overrides.headers).map(([name, value]) => ({ name, value: String(value) })) } : {}),
          ...(overrides.postData !== undefined ? { postData: String(overrides.postData) } : {}),
        }).catch(() => {});
      },
      /** Perform the real request server-side (with page cookies) — for inspect-then-modify flows. */
      async fetch() {
        const { fetch: liteFetch } = await import('../lite/engine.js');
        const cookies = await this.page.cookies([this.url]).catch(() => []);
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        const res = await liteFetch(this.url, {
          method: this.method,
          headers: { ...this.headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
          ...(this.postData !== undefined ? { body: this.postData } : {}),
        });
        return { status: res.status, headers: res.headers, body: res.text(), buffer: res.body, json: () => res.json() };
      },
    };
    this.emit('requestpaused', req);
    const routeLists = [this._routes, (this.context?._routes || [])];
    for (const routes of routeLists) {
      for (const r of routes) {
        if (r.match.test(req.url)) {
          try { await r.handler(req); } catch (e) { this.emit('routeError', { error: e, request: req }); }
          if (req._handled) return;
        }
      }
    }
    if (!req._handled) req.continue().catch(() => {});
  }

  /** Attaching a download listener arms download capture automatically. */
  on(event, handler) {
    if (event === 'download' || event === 'filechooser') this._ensureDownloads().catch(() => {});
    return super.on(event, handler);
  }

  once(event, handler) {
    if (event === 'download' || event === 'filechooser') this._ensureDownloads().catch(() => {});
    return super.once(event, handler);
  }

  /** Arm download capture (idempotent). Called automatically by download-related APIs. */
  async _ensureDownloads(opts = {}) {
    if (this._downloads) return this._downloads;
    const dir = typeof opts.downloads === 'string' ? opts.downloads : typeof this._opts?.downloads === 'string' ? this._opts.downloads : join(tmpdir(), 'velox-downloads');
    try { mkdirSync(dir, { recursive: true }); } catch {}
    this._downloads = dir;
    await this.conn.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true }).catch(() => {});
    return dir;
  }

  /** Wait for a download (arms download capture first). */
  async waitForDownload(timeout = 30000) {
    await this._ensureDownloads();
    return this.waitForEvent('download', { timeout });
  }

  /* ------------------------------------------ dialogs & files -------------------------------------------- */

  _onDialog(info) {
    let responded = false;
    const dialog = {
      ...info, page: this,
      respond: (accept = true, promptText) => {
        if (responded) return Promise.resolve(); responded = true;
        return this.session.send('Page.handleJavaScriptDialog', { accept, promptText: promptText ?? this._dialogCfg.promptText }).catch(() => {});
      },
    };
    this.emit('dialog', dialog);
    // NOTE: any Runtime.evaluate auto-dismisses an open dialog, so when nobody is
    // listening we must respond immediately — a delayed default would race.
    const hasListener = this._h.get('dialog')?.size > 0;
    if (hasListener) setTimeout(() => { if (!responded) dialog.respond(this._dialogCfg.action === 'accept'); }, 100);
    else dialog.respond(this._dialogCfg.action === 'accept');
  }

  async uploadFile(sel, files) {
    const { result } = await this.session.send('Runtime.evaluate', { expression: this._x('one', sel), returnByValue: false });
    if (!result?.objectId) throw new Error(`No element: ${sel}`);
    await this.session.send('DOM.setFileInputFiles', { files: [].concat(files).map((f) => String(f)), objectId: result.objectId });
    return this;
  }

  /* ---------------------------------------------- bindings ----------------------------------------------- */

  /** Expose a Node function to the page: await window.myFn(arg) — round-trips over CDP. */
  async expose(name, fn) {
    await this.session.send('Runtime.addBinding', { name: `__vlxBound_${name}` });
    this._bindings.set(`__vlxBound_${name}`, fn);
    this.session.on('Runtime.bindingCalled', async ({ name: bname, payload }) => {
      if (bname !== `__vlxBound_${name}`) return;
      const { id, args } = JSON.parse(payload || '{}');
      let result, error;
      try { result = await fn(...(args || [])); } catch (e) { error = e.message; }
      this.session.fire('Runtime.evaluate', {
        expression: `__vlx._resolveBound(${JSON.stringify(name)}, ${JSON.stringify(id)}, ${JSON.stringify(error ? { __error: error } : result)})`,
      });
    });
    await this.eval(`window[${JSON.stringify(name)}] = function(){ var a=[].slice.call(arguments);
      return new Promise(function(res, rej){ var id = Math.random().toString(36).slice(2);
        (__vlx._bound[${JSON.stringify(name)}] = __vlx._bound[${JSON.stringify(name)}] || {})[id] = res;
        window[${JSON.stringify(`__vlxBound_${name}`)}](JSON.stringify({id, args:a}));
        setTimeout(function(){ rej(new Error('binding timeout')) }, 30000); });
    }`);
    return this;
  }

  /* ------------------------------------------------ misc -------------------------------------------------- */

  /* ------------------------------------------- bandwidth accounting -------------------------------------- */

  /** Bytes actually transferred, grouped by resource type (needs capture on). */
  transferred() {
    const byType = {};
    let total = 0;
    for (const r of this.requests()) {
      const n = r.encodedDataLength || 0;
      const t = r.resourceType || 'Other';
      byType[t] = (byType[t] || 0) + n;
      total += n;
    }
    return { total, byType, human: fmtBytes(total), blockedBytes: this._bytesBlocked, blocked: { ...this._blockedByType }, profile: this._bw?.name };
  }

  /** Requests dropped by the bandwidth profile. */
  blockedRequests() {
    return Object.entries(this._blockedByType).map(([reason, count]) => ({ reason, count }));
  }

  /** Change the profile at runtime (re-arms interception). */
  async setBandwidth(profile) {
    this._bw = resolveBandwidth(profile);
    if (this._bw.blockTypes.size || this._bw.maxBytes || this._bw.blockThirdParty) await this._armBandwidth();
    return this;
  }

  console() { return this._consoleBuffer; }
  errors() { return this._errorBuffer; }

  /* ------------------------------------------- waits & events ------------------------------------------- */

  /** Generic: await the next event with optional predicate. */
  waitForEvent(name, { predicate, timeout = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new TimeoutError(`event ${name}`, timeout)); }, timeout);
      const off = this.on(name, (p) => {
        if (predicate && !predicate(p)) return;
        clearTimeout(t); off(); resolve(p);
      });
    });
  }

  /** Wait for a request matching url (string/regex/predicate) → request entry. */
  waitForRequest(match, { timeout = 30000 } = {}) {
    const pred = toMatcher(match);
    return this.waitForEvent('request', { predicate: (e) => pred(e.url), timeout });
  }
  /** Wait for a response matching url (string/regex/predicate) → request entry (with .response). */
  waitForResponse(match, { timeout = 30000 } = {}) {
    const pred = toMatcher(match);
    return this.waitForEvent('response', { predicate: (e) => pred(e.url), timeout });
  }
  waitForRequestFinished(match, { timeout = 30000 } = {}) {
    const pred = toMatcher(match);
    return this.waitForEvent('requestfinished', { predicate: (e) => pred(e.url), timeout });
  }
  waitForDialog(timeout = 30000) { return this.waitForEvent('dialog', { timeout }); }
  waitForPopup(timeout = 30000) {
    return this.waitForEvent('popup', { timeout }).catch(() => this.waitForEvent('target', { timeout }));
  }


  /* ------------------------------------------ network emulation ------------------------------------------ */

  /** Offline / throttling. */
  async setOffline(offline = true) {
    return this.emulateNetwork({ offline });
  }
  async emulateNetwork({ offline = false, latency = 0, downloadThroughput = -1, uploadThroughput = -1 } = {}) {
    await this.session.send('Network.emulateNetworkConditions', {
      offline, latency,
      downloadThroughput: downloadThroughput < 0 ? -1 : downloadThroughput,
      uploadThroughput: uploadThroughput < 0 ? -1 : uploadThroughput,
    });
    return this;
  }

  /* -------------------------------------------- init scripts -------------------------------------------- */

  async addInitScript(fnOrSrc) {
    const src = typeof fnOrSrc === 'function' ? `(${fnOrSrc.toString()})()` : fnOrSrc;
    const { identifier } = await this.session.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    this._initScriptIds = this._initScriptIds || [];
    this._initScriptIds.push(identifier);
    await this.session.send('Runtime.evaluate', { expression: src }).catch(() => {});
    return identifier;
  }
  async removeInitScript(identifier) {
    if (identifier == null) {
      const ids = this._initScriptIds || [];
      this._initScriptIds = [];
      await Promise.all(ids.map((id) => this.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }).catch(() => {})));
      return true;
    }
    this._initScriptIds = (this._initScriptIds || []).filter((i) => i !== identifier);
    return this.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).then(() => true, () => false);
  }

  /** Inject a <script> (by url, content, or file path) into the live page. */
  async addScriptTag({ url, content, path } = {}) {
    if (path) content = readFileSync(path, 'utf8');
    return this.eval(`(async function(){
      var s = document.createElement('script');
      ${url ? `s.src = ${JSON.stringify(url)};` : ''}
      ${content ? `s.textContent = ${JSON.stringify(content)};` : ''}
      var p = new Promise(function(res, rej){ s.onload = res; s.onerror = function(){ rej(new Error('script load failed')) }; setTimeout(res, 5000); });
      document.head.appendChild(s);
      await p;
      return true;
    })()`);
  }
  /** Inject a <style> (by url, content, or file path) into the live page. */
  async addStyleTag({ url, content, path } = {}) {
    if (path) content = readFileSync(path, 'utf8');
    return this.eval(`(function(){
      ${url
        ? `var l = document.createElement('link'); l.rel='stylesheet'; l.href=${JSON.stringify(url)}; document.head.appendChild(l);`
        : `var st = document.createElement('style'); st.textContent = ${JSON.stringify(content || '')}; document.head.appendChild(st);`}
      return true;
    })()`);
  }

  /* --------------------------------------------- emulation --------------------------------------------- */

  async emulateMedia({ media, colorScheme, reducedMotion } = {}) {
    const features = [];
    if (colorScheme) features.push({ name: 'prefers-color-scheme', value: colorScheme });
    if (reducedMotion) features.push({ name: 'prefers-reduced-motion', value: reducedMotion });
    await this.session.send('Emulation.setEmulatedMedia', {
      ...(media ? { media } : {}),
      ...(features.length ? { features } : {}),
    });
    return this;
  }
  async setViewportSize(size) { return this.setViewport(size.width, size.height); }
  async bringToFront() { return this.activate(); }
  /** Raw CDP session for this page (power users). */
  createCDPSession() { return this.session; }
  get pages() { return this.context ? this.context.pages() : this.browser.pages(); }

  /* ----------------------------------------------- frames ----------------------------------------------- */

  /** Frames as objects with locator support (same-origin scoping). */
  async frames() {
    const tree = await this.frameTree();
    return tree.map((f) => {
      const frame = {
        ...f,
        page: this,
        url: f.url,
        locator: (sel) => { const l = new Locator(this, sel); l._frameRoot = f; return l; },
      };
      return frame;
    });
  }
  mainFrame() { return (async () => (await this.frames())[0])(); }

  /** Chainable frame locator (same-origin iframes): page.frameLocator('#comments').getByRole('button') */
  frameLocator(sel) {
    const scoped = Object.create(this);
    scoped._rootOverride = sel;
    scoped.$ = (s) => new Locator(scoped, s);
    scoped.locator = (s) => new Locator(scoped, s);
    for (const name of ['getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId']) {
      scoped[name] = (...a) => this[name](...a);
    }
    return scoped;
  }

  async activate() { await this.conn.send('Target.activateTarget', { targetId: this.targetId }).catch(() => {}); return this; }

  async close({ runBeforeUnload = false } = {}) {
    if (this._closed) return;
    this._closed = true;
    try {
      if (this.video?.recorder?._recording) await this.video.stop().catch(() => {});
      await this.conn.send('Target.closeTarget', { targetId: this.targetId, ...(runBeforeUnload ? { runBeforeUnload: true } : {}) });
    } catch {}
    this.conn.detach(this.session.sessionId);
    this.emit('close');
  }
}

function normKey(k, dir) {
  const raw = String(k);
  const lower = raw.toLowerCase();
  const m = KEYMAP[lower];
  if (m) return { key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode, ...(dir === 'down' && m.text ? { text: m.text } : {}) };
  const upper = raw.toUpperCase();
  return { key: raw, code: /^[a-z0-9]$/i.test(raw) ? 'Key' + upper : undefined, windowsVirtualKeyCode: upper.charCodeAt(0) || undefined, ...(dir === 'down' && raw.length === 1 ? { text: raw } : {}) };
}

export function defaultBlocklist() {
  return [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
    'googletagmanager.com', 'adservice.google.com', 'adnxs.com', 'adsystem.com', 'taboola.com',
    'outbrain.com', 'criteo.com', 'scorecardresearch.com', 'quantserve.com', 'hotjar.com',
    'mixpanel.com', 'segment.io', 'amplitude.com', 'branch.io', 'sentry-cdn.com',
    'facebook.net', 'connect.facebook.net', 'bat.bing.com', 'clarity.ms', 'yandex.ru/metrika',
    'moatads.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com', 'smartadserver.com',
  ];
}

/* ---------------------------------------------- helpers ---------------------------------------------- */

function toMatcher(match) {
  if (typeof match === 'function') return match;
  if (match instanceof RegExp) return (u) => match.test(u);
  if (typeof match === 'string' && match.includes('*')) {
    const re = new RegExp('^' + match.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^]*').replace(/\u0000/g, '[^]*').replace(/\?/g, '.') + '$');
    return (u) => re.test(u);
  }
  const s = String(match);
  return (u) => u === s || u.startsWith(s + '?') || u.includes(s);
}

/** Download object handed to page.on('download', dl) / page.waitForDownload(). */
export class Download {
  constructor(page, guid, url, suggestedFilename) {
    this.page = page;
    this.guid = guid;
    this.url = url;
    this.suggestedFilename = suggestedFilename;
    this.state = 'inProgress';
    this.receivedBytes = 0;
    this.totalBytes = 0;
    this._done = null;
    this._path = null;
  }
  _update(p) {
    if (p.state) this.state = p.state;
    if (p.receivedBytes != null) this.receivedBytes = p.receivedBytes;
    if (p.totalBytes != null) this.totalBytes = p.totalBytes;
    if ((p.state === 'completed' || p.state === 'canceled') && this._done) { this._done(); this._done = null; }
  }
  /** Resolves when the download finishes. */
  finished(timeout = 30000) {
    if (this.state === 'completed' || this.state === 'canceled') return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new TimeoutError('download', timeout)), timeout);
      this._done = () => { clearTimeout(t); resolve(this); };
    });
  }
  /** Where the browser is writing it (allowAndName: guid file inside the download dir). */
  path() {
    const dir = this.page._downloads;
    return dir ? join(dir, this.guid) : null;
  }
  /** Copy to a friendly filename once complete. */
  async saveAs(target) {
    if (this.state !== 'completed') await this.finished();
    if (this.state === 'canceled') throw new Error('download canceled');
    const src = this.path();
    if (!src) throw new Error('download dir not configured');
    const { copyFileSync, mkdirSync, existsSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    // the browser renames its .crdownload temp to the guid name shortly AFTER
    // reporting 'completed' — poll briefly for the file to appear
    const deadline = Date.now() + 5000;
    while (!existsSync(src) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!existsSync(src)) throw new Error(`download file never appeared: ${src}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
    this._path = target;
    return target;
  }
  async cancel() {
    await this.page.conn.send('Browser.cancelDownload', { guid: this.guid }).catch(() => {});
    this.state = 'canceled';
    if (this._done) { this._done(); this._done = null; }
  }
  get filename() { return this.suggestedFilename; }
}

/** WebSocket tracker handed to page.on('websocket', ws). */
export class WebSocketTracker extends Emitter {  constructor(page, id, url) {
    super();
    this.page = page;
    this.id = id;
    this.url = url;
    this.framesSent = [];
    this.framesReceived = [];
    this.headers = null;
    this.closedAt = null;
  }
  handshake(response) { this.headers = response?.headers || null; this.status = response?.status; }
  frame(dir, payload, timestamp) {
    let text = null;
    try { text = Buffer.from(payload.payloadData, 'base64').toString('utf8'); } catch { text = payload.payloadData; }
    const rec = { dir, text, opcode: payload.opcode, timestamp, ws: this };
    (dir === 'sent' ? this.framesSent : this.framesReceived).push(rec);
    this.emit(dir === 'sent' ? 'framesent' : 'framereceived', rec);
  }
  closed(timestamp) { this.closedAt = timestamp ?? Date.now() / 1000; this.emit('close', this); }
  get isClosed() { return this.closedAt != null; }
}
