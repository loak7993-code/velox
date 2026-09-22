// velox :: cdp/stealth.js — anti-fingerprint patches, injected before page scripts.
// Pure from-scratch implementation (no code from puppeteer-extra/stealth).
export const STEALTH_SOURCE = String.raw`
(function () {
  if (window.__vlxStealth) return; window.__vlxStealth = true;
  var def = function (obj, prop, value) {
    try { Object.defineProperty(obj, prop, { get: value.get ? value.get : function () { return value; }, configurable: true, enumerable: true }); } catch (e) {}
  };

  // 1. navigator.webdriver
  def(navigator, 'webdriver', { get: function () { return undefined; } });

  // 2. languages
  def(navigator, 'languages', ['en-US', 'en']);
  def(navigator, 'language', 'en-US');

  // 3. plugins — a realistic Chromium PDF set
  try {
    var mkPlugin = function (name, desc, fn, mime) {
      var p = Object.create(Plugin.prototype);
      Object.defineProperties(p, { name: { value: name }, description: { value: desc }, filename: { value: fn }, length: { value: 1 } });
      var f = { name: mime, description: mime, suffixes: 'pdf', type: mime };
      p[0] = f; p[mime] = f;
      return p;
    };
    var arr = [
      mkPlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
      mkPlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
      mkPlugin('Chromium PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
      mkPlugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
      mkPlugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer', 'application/x-google-chrome-pdf'),
    ];
    var fake = Object.create(PluginArray.prototype);
    arr.forEach(function (p, i) { fake[i] = p; fake[p.name] = p; });
    Object.defineProperty(fake, 'length', { value: arr.length });
    Object.defineProperty(fake, 'item', { value: function (i) { return arr[i]; } });
    Object.defineProperty(fake, 'namedItem', { value: function (n) { return arr.find(function (p) { return p.name === n; }) || null; } });
    Object.defineProperty(fake, 'refresh', { value: function () {} });
    def(navigator, 'plugins', fake);
    def(navigator, 'mimeTypes', (function () {
      var m = Object.create(MimeTypeArray.prototype);
      var mt = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: arr[0] };
      m[0] = mt; m['application/pdf'] = mt;
      Object.defineProperty(m, 'length', { value: 1 });
      return m;
    })());
  } catch (e) {}

  // 4. window.chrome runtime object
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', OTHER: 'other' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        connect: function () {}, sendMessage: function () {},
      };
    }
    if (!window.chrome.app) window.chrome.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    if (!window.chrome.csi) window.chrome.csi = function () { return { startE: Date.now() - 1000, onloadT: Date.now() - 500, pageT: 500, tran: 15 }; };
    if (!window.chrome.loadTimes) window.chrome.loadTimes = function () { return { commitLoadTime: Date.now() / 1000 - 1, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000 - 0.5, finishLoadTime: Date.now() / 1000 - 0.4, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000 - 0.8, navigationType: 'Other', npnNegotiatedProtocol: 'unknown', requestTime: Date.now() / 1000 - 1.2, startLoadTime: Date.now() / 1000 - 1.1, wasAlternateProtocolAvailable: false, wasFpProtocolUsed: false, wasNpnNegotiated: true }; };
  } catch (e) {}

  // 5. permissions — Notification.query should not throw / reveal automation
  try {
    var orig = window.Notification;
    if (orig) def(orig, 'permission', 'default');
    if (navigator.permissions && navigator.permissions.query) {
      var qp = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (p) {
        if (p && p.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission || 'default', onchange: null });
        }
        return qp(p);
      };
    }
  } catch (e) {}

  // 6. WebGL vendor/renderer — report a common consumer GPU
  try {
    var UNMASKED_VENDOR = 37445, UNMASKED_RENDERER = 37446;
    var getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === UNMASKED_VENDOR) return 'Intel Inc.';
      if (param === UNMASKED_RENDERER) return 'Intel Iris OpenGL Engine';
      return getParameter.apply(this, arguments);
    };
    var gpa2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === UNMASKED_VENDOR) return 'Intel Inc.';
      if (param === UNMASKED_RENDERER) return 'Intel Iris OpenGL Engine';
      return gpa2.apply(this, arguments);
    };
  } catch (e) {}

  // 7. hardware concurrency / device memory (plausible mid-range)
  def(navigator, 'hardwareConcurrency', 8);
  try { def(navigator, 'deviceMemory', 8); } catch (e) {}
  def(navigator, 'platform', 'Win32');
  try { def(navigator, 'oscpu', undefined); } catch (e) {}

  // 8. iframe contentWindow.chrome passthrough
  try {
    var hIF = HTMLIFrameElement.prototype.__lookupGetter__('contentWindow');
    if (hIF) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          var w = hIF.apply(this, arguments);
          if (w) { try { if (!w.chrome) w.chrome = window.chrome; } catch (e) {} }
          return w;
        },
      });
    }
  } catch (e) {}

  // 9. battery api sane default
  try {
    navigator.getBattery = function () { return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null }); };
  } catch (e) {}

  // 10. navigator.connection
  try {
    if (!navigator.connection) def(navigator, 'connection', { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false });
  } catch (e) {}
})();
`;
