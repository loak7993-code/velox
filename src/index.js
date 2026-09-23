// velox — browser automation at terminal velocity.
// Zero dependencies. Any Chromium-family browser. Or no browser at all.
import { Browser, launch, connect, launchPersistentContext } from './cdp/browser.js';
import { VeloxPage, WebSocketTracker, Download } from './cdp/page.js';
import { BrowserContext } from './cdp/context.js';
import { Locator } from './cdp/locator.js';
import { JSHandle, ElementHandle } from './cdp/handles.js';
import { discoverBrowsers } from './cdp/discovery.js';
import { DEVICES } from './cdp/devices.js';
import { ENGINE_SOURCE } from './cdp/inject.js';
import { Pool } from './pool.js';
import { open, scrape, LiteSession, BrowserSession } from './auto.js';
import { fetch as liteFetch, fetchAll as liteFetchAll, CookieJar, needsJS } from './lite/engine.js';
import { HttpCache, createCache } from './lite/cache.js';
import { parse as parseHtml } from './lite/html.js';
import { expect } from './assert.js';
import { createRequire } from 'node:module';
const pkg = createRequire(import.meta.url)('../package.json');
import { ProxyPool, checkProxy, normalizeProxy, proxyFlags } from './proxy.js';
import { proxyForward } from './forward.js';
import { importSession, exportSession, normalizeCookies, parseCurlCookies, parseNetscapeCookies, importHAR } from './field.js';
import { middleware, registerCommand, registerSelectorEngine, hook, registered as registeredExtensions, bindPrototypes } from './extend.js';
import { PROFILES as STEALTH_PROFILES, GEO as STEALTH_GEO } from './cdp/stealth.js';
import { detect as detectChallenge, engage as engageChallenge, goto as gotoChallenge, VENDORS as CHALLENGE_VENDORS } from './challenge.js';
import { config, getConfig, use, registerDevice, registeredDevices, plugins as pluginPresets, registeredPluginList } from './plugins.js';
import { PRESETS as BANDWIDTH_PROFILES, resolveBandwidth, fmtBytes } from './bandwidth.js';

// let registered commands live on the prototypes so they apply to existing instances too
bindPrototypes({ page: VeloxPage.prototype, browser: Browser.prototype, locator: Locator.prototype });

const velox = {
  /** Open a URL — lite HTTP first, real browser only if the page needs JS. */
  open,
  /** One-shot structured scrape. */
  scrape,
  /** Raw fast HTTP fetch (no browser ever). */
  fetch: liteFetch,
  /** Fetch many URLs in parallel over the keep-alive pool — no browser. */
  fetchAll: liteFetchAll,
  /** Launch any installed Chromium-family browser. */
  launch,
  /**
   * Pre-launch browsers (+optional pages) so later launch()/open() calls are instant.
   *   await velox.prewarm({ browsers: 1, pagesPerBrowser: 6 })
   */
  prewarm: async (opts = {}) => { Browser._warmTarget = opts.browsers ?? 1; return Browser.prewarm(opts); },
  /** Launch with a persistent profile (extensions, logins). */
  launchPersistentContext,
  /** Attach to a running browser / remote endpoint (host:port or ws://). */
  connect,
  /** List Chromium-family browsers installed on this machine. */
  detect: discoverBrowsers,
  Pool,
  DEVICES: new Proxy(DEVICES, { get: (t, k) => registeredDevices()[k] ?? t[k], has: (t, k) => k in registeredDevices() || k in t, ownKeys: (t) => [...new Set([...Object.keys(t), ...Object.keys(registeredDevices())])], getOwnPropertyDescriptor: (t, k) => ({ configurable: true, enumerable: true, value: registeredDevices()[k] ?? t[k] }) }),
  parseHtml,
  needsJS,
  CookieJar,
  /** Conditional-GET cache for the browser-free engine: velox.createCache({ dir }) */
  createCache,
  HttpCache,
  expect,
  ProxyPool,
  checkProxy,
  normalizeProxy,
  /** Global defaults: velox.config({ timeout, engine, proxy, retries, … }) */
  config,
  /** Read the effective config. */
  getConfig,
  /** Register a plugin: velox.use(velox.plugins.blockImages()) */
  use,
  /** Built-in plugins: stealth, adblock, humanize, blockImages, retry, logger, proxyRotate */
  plugins: pluginPresets,
  /** Add a device preset: velox.registerDevice('pixel_9', { width, height, ua, … }) */
  registerDevice,
  /** Bandwidth profiles: velox.BANDWIDTH.lean | .minimal | .text-only */
  BANDWIDTH: BANDWIDTH_PROFILES,
  /** Wrap every page command: velox.middleware((ctx, next) => …) */
  middleware,
  /** Add your own methods: velox.registerCommand('name', fn) */
  registerCommand,
  /**
   * Local forwarder for authenticated upstream proxies (the reliable path when CDP
   * proxy auth fails). Returns { server } for launch()/newContext().
   */
  proxyForward,
  /**
   * Session plumbing for hybrid HTTP+browser pipelines:
   *   velox.importSession(cookiesOrCurlOrHar)   // applies to the NEXT page/context
   *   await page.exportSession()                // Playwright-compatible storage state
   */
  importSession,
  exportSession,
  normalizeCookies,
  parseCurlCookies,
  parseNetscapeCookies,
  importHAR,
  /** Global selector engines: velox.registerSelectorEngine('name', fn) */
  registerSelectorEngine,
  /** Lifecycle hooks: velox.hook('onNavigation', fn) */
  hook,
  /** Introspect registered extensions. */
  extensions: registeredExtensions,
  /** Stealth profiles + geo presets (coherent fingerprint sets). */
  STEALTH: { profiles: STEALTH_PROFILES, geo: STEALTH_GEO },
  /** Bot-management awareness: detect / engage / goto-through. */
  challenge: { detect: detectChallenge, engage: engageChallenge, goto: gotoChallenge, vendors: CHALLENGE_VENDORS },
  resolveBandwidth,
  fmtBytes,
  Browser,
  VeloxPage,
  BrowserContext,
  Locator,
  JSHandle,
  ElementHandle,
  WebSocketTracker,
  Download,
  ENGINE_SOURCE,
  get version() { return pkg.version; },
};

export {
  open, scrape, launch, launchPersistentContext, connect, discoverBrowsers, Pool, DEVICES,
  Browser, VeloxPage, BrowserContext, Locator, JSHandle, ElementHandle, LiteSession, BrowserSession,
  WebSocketTracker, Download, liteFetch, liteFetchAll, parseHtml, needsJS, CookieJar, createCache, HttpCache, expect,
  ProxyPool, checkProxy, normalizeProxy, proxyFlags, proxyForward,
  importSession, exportSession, normalizeCookies, parseCurlCookies, parseNetscapeCookies, importHAR,
  config, getConfig, use, registerDevice, registeredDevices, pluginPresets as plugins,
  middleware, registerCommand, registerSelectorEngine, hook, registeredExtensions,
  STEALTH_PROFILES, STEALTH_GEO, detectChallenge, engageChallenge, gotoChallenge, CHALLENGE_VENDORS,
  BANDWIDTH_PROFILES, resolveBandwidth, fmtBytes,
};
export default velox;
export { velox };
