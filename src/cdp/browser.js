// velox :: cdp/browser.js — launch/connect any CDP browser, manage targets & contexts
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpConnection } from './connection.js';
import { findBrowser, discoverBrowsers } from './discovery.js';
import { VeloxPage } from './page.js';
import { Emitter } from '../util.js';

const HEADLESS_OK = (p) => !/headless-shell/i.test(p);

export class Browser extends Emitter {
  constructor(conn, proc = null, opts = {}) {
    super();
    this.conn = conn;
    this.proc = proc;
    this.opts = opts;
    this.pages = new Set();
    this._knownTargets = new Map();   // targetId -> VeloxPage (we manage these explicitly)
    this._pendingAttaches = new Set();
    this._userDataDir = opts._userDataDir || null;
    this._closed = false;
    this.versionInfo = null;
    this._setupAutoAttach();
    conn.on('disconnect', (e) => this.emit('disconnect', e));
  }

  get closed() { return this._closed || this.conn.closed; }

  async _setupAutoAttach() {
    try {
      await this.conn.send('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      });
    } catch {}
    this.conn.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
      if (waitingForDebugger) this.conn.fire('Runtime.runIfWaitingForDebugger', {}, { sessionId });
      // we attached to this one ourselves (newPage) — skip, it's already managed
      if (this._knownTargets.has(targetInfo.targetId) || this._pendingAttaches.has(targetInfo.targetId)) return;
      const evName = targetInfo.type === 'page' && targetInfo.openerId ? 'popup' : 'target';
      const page = new VeloxPage(this, sessionId, targetInfo);
      this._knownTargets.set(targetInfo.targetId, page);
      this.pages.add(page);
      this.emit(evName, page);
      this.emit('targetCreated', page);
      page.once('close', () => { this.pages.delete(page); this._knownTargets.delete(targetInfo.targetId); });
      // arm popups/OOPIFs in the background (domains + engine) so they're ready to use
      page._init({}).catch(() => {});
    });
  }

  /** Launch a local browser. Uses any installed Chromium-family binary. */
  static async launch(opts = {}) {
    const {
      browser = 'auto', headless = true, executablePath,
      args = [], userDataDir, proxy, userAgent, timeout = 20000,
      env = {}, stealth = false, defaultContext,
    } = opts;

    const exe = executablePath || findBrowser(browser);
    const isShell = /headless-shell/i.test(exe);
    const root = typeof process.getuid === 'function' && process.getuid() === 0;
    const dir = userDataDir || mkdtempSync(join(tmpdir(), 'velox-'));
    const usePipe = opts.transport !== 'socket';
    const cli = [
      `--user-data-dir=${dir}`,
      usePipe ? '--remote-debugging-pipe' : '--remote-debugging-port=0',
      '--no-first-run', '--no-default-browser-check',
      ...(root || opts.noSandbox === true ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] : []),
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
      ...(proxy ? [`--proxy-server=${proxy.server}`] : []),
      ...args,
    ];

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
        return await Browser.launch({ ...opts, transport: 'socket' });
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
    if (proxy?.username) await b._proxyAuth(proxy);
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
    return b;
  }

  async _proxyAuth({ username, password }) {
    // Fetch.authRequired is browser-level on the root session
    await this.conn.send('Fetch.enable', { handleAuthRequests: true }).catch(() => {});
    this.conn.on('Fetch.authRequired', ({ requestId }) => {
      this.conn.fire('Fetch.continueWithAuth', {
        requestId, authChallengeResponse: { response: 'ProvideCredentials', username, password },
      });
    });
  }

  /** New page. Everything optional: { stealth, ads, device, viewport, ua, locale, timezone, geolocation, headers, blockUrls, routes } */
  async newPage(opts = {}) {
    const { browserContextId } = opts.isolated ? await this.conn.send('Target.createBrowserContext', { disposeOnDetach: true }) : {};
    const { targetId } = await this.conn.send('Target.createTarget', {
      url: 'about:blank', ...(browserContextId ? { browserContextId } : {}),
    });
    this._pendingAttaches.add(targetId);
    let sessionId;
    try {
      ({ sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true }));
    } finally {
      this._pendingAttaches.delete(targetId);
    }
    const page = new VeloxPage(this, sessionId, { targetId, type: 'page', url: 'about:blank' }, { browserContextId });
    this._knownTargets.set(targetId, page);
    this.pages.add(page);
    page.once('close', () => { this.pages.delete(page); this._knownTargets.delete(targetId); });
    await page._init(opts);
    return page;
  }

  pages() { return [...this.pages].filter((p) => !p.isClosed); }

  async contexts() { return (await this.conn.send('Target.getBrowserContexts')).browserContextIds; }

  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await Promise.race([this.conn.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]); } catch {}
    this.conn.close();
    try { this.proc?.kill('SIGKILL'); } catch {}
    if (this._userDataDir) { try { rmSync(this._userDataDir, { recursive: true, force: true }); } catch {} }
    this.emit('close');
  }
}

export const detect = discoverBrowsers;
export const launch = (o) => Browser.launch(o);
export const connect = (e, o) => Browser.connect(e, o);
