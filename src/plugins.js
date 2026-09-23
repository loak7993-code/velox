// velox :: plugins.js — global configuration + a hook-based plugin system.
//
//   velox.config({ timeout: 20000, engine: 'auto', ads: true })
//   velox.use(velox.plugins.blockImages())
//   velox.use({ name: 'mine', onPage(page) { … } })
//
// Hooks (all optional, all sync unless noted):
//   launchOptions(opts) → opts      mutate before spawning
//   pageOptions(opts)   → opts      mutate before creating a page
//   onBrowser(browser)              after a browser is ready
//   onPage(page)                    after every page is initialised
//   onRequest(req) / onResponse(entry)   network hooks (arms interception)
//   onError(err, context)           any error crossing the plugin chain
import { readFileSync, existsSync } from 'node:fs';

const state = {
  config: {
    timeout: 15000,        // default per-action timeout
    navTimeout: 30000,     // default navigation timeout
    engine: 'auto',
    retries: 0,          // retries for velox.open()
    navRetries: 1,       // retries for page.goto() on TRANSIENT failures only
    retryDelay: 300,
    headless: true,
    stealth: false,
    ads: false,
    capture: true,
    transport: undefined,   // 'pipe' | 'socket'
    proxy: undefined,
    noSandbox: undefined,
    baseURL: undefined,
    storageState: undefined,
    headers: undefined,
    userAgent: undefined,
  },
  plugins: [],
  devices: {},
};

/** Merge defaults; also reads VELOX_CONFIG=<file.json> and VELOX_* env vars once. */
export function config(patch = {}) {
  if (!state._envLoaded) {
    state._envLoaded = true;
    const file = process.env.VELOX_CONFIG;
    if (file && existsSync(file)) {
      try { config(JSON.parse(readFileSync(file, 'utf8'))); } catch (e) { throw new Error(`VELOX_CONFIG: ${e.message}`); }
    }
    const env = {
      browser: process.env.VELOX_BROWSER,
      proxy: process.env.VELOX_PROXY,
      engine: process.env.VELOX_ENGINE,
      headless: process.env.VELOX_HEADLESS === undefined ? undefined : process.env.VELOX_HEADLESS !== '0' && process.env.VELOX_HEADLESS !== 'false',
      noSandbox: process.env.VELOX_NO_SANDBOX ? true : undefined,
      timeout: process.env.VELOX_TIMEOUT ? Number(process.env.VELOX_TIMEOUT) : undefined,
      baseURL: process.env.VELOX_BASE_URL,
      userAgent: process.env.VELOX_UA,
    };
    for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== '') state.config[k] = v;
  }
  Object.assign(state.config, patch);
  return { ...state.config };
}

export function getConfig() { return config({}); }

/** Register a plugin (object with hooks, or a function returning one). */
export function use(plugin) {
  const p = typeof plugin === 'function' ? plugin() : plugin;
  if (!p || typeof p !== 'object') throw new Error('velox.use(): expected a plugin object');
  p.name = p.name || `plugin-${state.plugins.length + 1}`;
  state.plugins.push(p);
  if (typeof p.setup === 'function') p.setup({ config, use, plugins: pluginsNs });
  return p;
}

export function registeredPluginList() { return [...state.plugins]; }

/** Run a hook across all plugins (chained for option mutators, fan-out otherwise). */
export function applyLaunchOptions(opts) {
  let out = opts;
  for (const p of state.plugins) if (p.launchOptions) out = p.launchOptions(out) || out;
  return out;
}
export function applyPageOptions(opts) {
  let out = opts;
  for (const p of state.plugins) if (p.pageOptions) out = p.pageOptions(out) || out;
  return out;
}
export function runHook(name, ...args) {
  for (const p of state.plugins) {
    if (typeof p[name] === 'function') {
      try { p[name](...args); } catch (e) { /* a plugin must never break the run */ }
    }
  }
}
export function hasHook(name) { return state.plugins.some((p) => typeof p[name] === 'function'); }

/** Custom device presets, merged over the built-ins. */
export function registerDevice(name, def) {
  state.devices[name] = def;
  return def;
}
export function registeredDevices() { return { ...state.devices }; }

/* ------------------------------------------------------------- built-in plugins */

const pluginsNs = {
  /** Anti-fingerprint patches on every page. */
  stealth: () => ({ name: 'stealth', pageOptions: (o) => ({ ...o, stealth: o.stealth ?? true }) }),

  /** Ad/tracker blocking at the network-stack level. */
  adblock: (extra = []) => ({
    name: 'adblock',
    pageOptions: (o) => ({ ...o, ads: o.ads ?? true, blockUrls: [...(o.blockUrls || []), ...extra] }),
  }),

  /** Human-ish timing for typing and cursor movement. */
  humanize: ({ typing = true, mouse = true } = {}) => ({
    name: 'humanize',
    onPage(page) {
      if (typing) {
        const type = page.type.bind(page);
        page.type = (sel, text, opts = {}) => type(sel, text, { human: true, ...opts });
      }
      if (mouse) {
        const click = page.click.bind(page);
        const move = page.mouse.humanMove.bind(page.mouse);
        page.click = async (sel, opts = {}) => {
          const p = await page.eval(`__vlx.point(${JSON.stringify(sel)})`).catch(() => null);
          if (p) await move(p.x, p.y);
          return click(sel, opts);
        };
      }
    },
  }),

  /** Skip heavy resources — big speed win on image/media-heavy sites. */
  blockImages: ({ fonts = true, media = true } = {}) => ({
    name: 'block-images',
    pageOptions: (o) => ({ ...o, _skipResources: true }),
    onPage: null,
    onRequest: null,
    _types: { image: true, ...(fonts ? { font: true } : {}), ...(media ? { media: true } : {}) },
    setup() {},
    pageSetup(page) {
      page.route('**/*', (req) => {
        const t = req.resourceType;
        return (t === 'Image' || t === 'Font' || t === 'Media') ? req.abort() : req.continue();
      });
    },
  }),

  /** Retry transient navigation failures. */
  retry: (tries = 2, delayMs = 300) => ({
    name: 'retry',
    pageOptions: (o) => ({ ...o, retries: o.retries ?? tries, retryDelay: o.retryDelay ?? delayMs }),
  }),

  /** Structured logging of navigations, requests and errors. */
  logger: ({ prefix = '[velox]', requests = false } = {}) => ({
    name: 'logger',
    onPage(page) {
      page.on('pageerror', (e) => console.error(`${prefix} pageerror: ${e.text}`));
      if (requests) page.on('response', (e) => console.log(`${prefix} ${e.response?.status} ${e.url}`));
      const goto = page.goto.bind(page);
      page.goto = async (url, opts) => {
        const r = await goto(url, opts);
        console.log(`${prefix} ${r.status ?? '?'} ${r.url} (${r.ms}ms)`);
        return r;
      };
    },
  }),

  /**
   * Rotate a ProxyPool across BROWSERS (CDP applies proxies per browser/context,
   * not per page). Each velox.launch()/open() picks the next exit; pass a sticky
   * key to keep the same exit for a whole job.
   */
  proxyRotate: (pool, { stickyKey } = {}) => ({
    name: 'proxy-rotate',
    launchOptions(o) {
      if (o.proxy) return o;                       // an explicit proxy always wins
      const p = stickyKey ? pool.sticky(stickyKey) : pool.next();
      return { ...o, proxy: typeof p.toProxy === 'function' ? p.toProxy() : p };
    },
    // context-level rotation for callers that build contexts themselves
    contextOptions(o) {
      if (o.proxy) return o;
      const p = stickyKey ? pool.sticky(stickyKey) : pool.next();
      return { ...o, proxy: typeof p.toProxy === 'function' ? p.toProxy() : p };
    },
  }),
};

export { pluginsNs as plugins };
