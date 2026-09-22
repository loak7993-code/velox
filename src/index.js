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
import { fetch as liteFetch, CookieJar, needsJS } from './lite/engine.js';
import { parse as parseHtml } from './lite/html.js';
import { expect } from './assert.js';

const velox = {
  /** Open a URL — lite HTTP first, real browser only if the page needs JS. */
  open,
  /** One-shot structured scrape. */
  scrape,
  /** Raw fast HTTP fetch (no browser ever). */
  fetch: liteFetch,
  /** Launch any installed Chromium-family browser. */
  launch,
  /** Launch with a persistent profile (extensions, logins). */
  launchPersistentContext,
  /** Attach to a running browser / remote endpoint (host:port or ws://). */
  connect,
  /** List Chromium-family browsers installed on this machine. */
  detect: discoverBrowsers,
  Pool,
  DEVICES,
  parseHtml,
  needsJS,
  CookieJar,
  expect,
  Browser,
  VeloxPage,
  BrowserContext,
  Locator,
  JSHandle,
  ElementHandle,
  WebSocketTracker,
  Download,
  ENGINE_SOURCE,
  get version() { return '2.0.0'; },
};

export {
  open, scrape, launch, launchPersistentContext, connect, discoverBrowsers, Pool, DEVICES,
  Browser, VeloxPage, BrowserContext, Locator, JSHandle, ElementHandle, LiteSession, BrowserSession,
  WebSocketTracker, Download, liteFetch, parseHtml, needsJS, CookieJar, expect,
};
export default velox;
export { velox };
