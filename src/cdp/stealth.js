// velox :: cdp/stealth.js — fingerprint hardening, profile-driven so every value is
// mutually coherent (platform ↔ UA-CH ↔ WebGL ↔ screen ↔ fonts ↔ locale ↔ timezone).
// Detectors score incoherence far more than they score individual values.
//
//   newPage({ stealth: true })                          // coherent default profile
//   newPage({ stealth: { profile: 'chrome-windows' } })  // pretend to be Windows Chrome
//   newPage({ stealth: { noise: false } })               // patches without canvas/audio noise
//   newPage({ stealth: { geo: 'de-DE' } })               // locale+tz+Accept-Language together

export const PROFILES = {
  'chrome-linux': {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    userAgentMetadata: { brands: [{brand:'Chromium',version:'128'},{brand:'Google Chrome',version:'128'},{brand:'Not)A;Brand',version:'24'}], fullVersion: '128.0.0.0', platform: 'Linux', platformVersion: '6.6.0', architecture: 'x86', bitness: '64', model: '', mobile: false },
    platform: 'Linux x86_64',
    uaPlatform: 'Linux', uaPlatformVersion: '6.6.0',
    vendor: 'Google Inc.',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 8, deviceMemory: 8,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 },
    languages: ['en-US', 'en'], locale: 'en-US', timezone: 'America/New_York',
    maxTouchPoints: 0,
    fonts: ['Arial', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Ubuntu', 'Cantarell'],
  },
  'chrome-windows': {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    userAgentMetadata: { brands: [{brand:'Chromium',version:'128'},{brand:'Google Chrome',version:'128'},{brand:'Not)A;Brand',version:'24'}], fullVersion: '128.0.0.0', platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', model: '', mobile: false },
    platform: 'Win32',
    uaPlatform: 'Windows', uaPlatformVersion: '15.0.0',
    vendor: 'Google Inc.',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    hardwareConcurrency: 12, deviceMemory: 8,
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032, colorDepth: 24, pixelDepth: 24 },
    languages: ['en-US', 'en'], locale: 'en-US', timezone: 'America/Chicago',
    maxTouchPoints: 0,
    fonts: ['Arial', 'Calibri', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'],
  },
  'chrome-mac': {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    userAgentMetadata: { brands: [{brand:'Chromium',version:'128'},{brand:'Google Chrome',version:'128'},{brand:'Not)A;Brand',version:'24'}], fullVersion: '128.0.0.0', platform: 'macOS', platformVersion: '14.5.0', architecture: 'arm', bitness: '64', model: '', mobile: false },
    platform: 'MacIntel',
    uaPlatform: 'macOS', uaPlatformVersion: '14.5.0',
    vendor: 'Google Inc.',
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)',
    hardwareConcurrency: 10, deviceMemory: 8,
    screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 944, colorDepth: 30, pixelDepth: 30 },
    languages: ['en-US', 'en'], locale: 'en-US', timezone: 'America/Los_Angeles',
    maxTouchPoints: 0,
    fonts: ['Helvetica', 'Helvetica Neue', 'Menlo', 'Monaco', 'SF Pro Text', 'Arial'],
  },
  'chrome-android': {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    userAgentMetadata: { brands: [{brand:'Chromium',version:'128'},{brand:'Google Chrome',version:'128'},{brand:'Not)A;Brand',version:'24'}], fullVersion: '128.0.0.0', platform: 'Android', platformVersion: '14.0.0', architecture: '', bitness: '', model: 'Pixel 8', mobile: true },
    platform: 'Linux armv8l',
    uaPlatform: 'Android', uaPlatformVersion: '14.0.0',
    vendor: 'Google Inc.',
    webglVendor: 'Qualcomm',
    webglRenderer: 'Adreno (TM) 740',
    hardwareConcurrency: 8, deviceMemory: 4,
    screen: { width: 412, height: 915, availWidth: 412, availHeight: 915, colorDepth: 24, pixelDepth: 24 },
    languages: ['en-US', 'en'], locale: 'en-US', timezone: 'America/New_York',
    maxTouchPoints: 5, mobile: true,
    fonts: ['Roboto', 'Noto Sans', 'Droid Sans'],
  },
};

// locale → coherent timezone / Accept-Language, so `geo` can't contradict itself
export const GEO = {
  'en-US': { tz: 'America/New_York', acceptLanguage: 'en-US,en;q=0.9' },
  'en-GB': { tz: 'Europe/London', acceptLanguage: 'en-GB,en;q=0.9' },
  'de-DE': { tz: 'Europe/Berlin', acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' },
  'fr-FR': { tz: 'Europe/Paris', acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8' },
  'es-ES': { tz: 'Europe/Madrid', acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8' },
  'pt-BR': { tz: 'America/Sao_Paulo', acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8' },
  'ja-JP': { tz: 'Asia/Tokyo', acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8' },
  'ko-KR': { tz: 'Asia/Seoul', acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' },
  'zh-CN': { tz: 'Asia/Shanghai', acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' },
  'ru-RU': { tz: 'Europe/Moscow', acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.8' },
  'nl-NL': { tz: 'Europe/Amsterdam', acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.8' },
  'it-IT': { tz: 'Europe/Rome', acceptLanguage: 'it-IT,it;q=0.9,en;q=0.8' },
  'pl-PL': { tz: 'Europe/Warsaw', acceptLanguage: 'pl-PL,pl;q=0.9,en;q=0.8' },
  'tr-TR': { tz: 'Europe/Istanbul', acceptLanguage: 'tr-TR,tr;q=0.9,en;q=0.8' },
  'id-ID': { tz: 'Asia/Jakarta', acceptLanguage: 'id-ID,id;q=0.9,en;q=0.8' },
};

/** Resolve a stealth option object into a concrete, coherent profile. */
export function resolveStealth(opt) {
  if (!opt) return null;
  const o = opt === true ? {} : opt;
  const profile = PROFILES[o.profile] || PROFILES[o.profile === undefined ? 'chrome-linux' : o.profile];
  if (!profile) throw new Error(`unknown stealth profile "${o.profile}" — try: ${Object.keys(PROFILES).join(', ')}`);
  const geo = o.geo ? GEO[o.geo] : null;
  if (o.geo && !geo) throw new Error(`unknown geo "${o.geo}" — try: ${Object.keys(GEO).join(', ')}`);
  // explicit locale/languages/timezone always win (e.g. an identity that says ja-JP), then
  // a geo preset, then the profile — and locale/languages are kept in sync so
  // navigator.language, the emulated locale and Accept-Language can never disagree
  const explicitLangs = o.languages && o.languages.length ? o.languages : null;
  const locale = o.locale || geo?.locale || explicitLangs?.[0] || (o.geo ? o.geo : profile.locale);
  const languages = explicitLangs
    || (o.geo ? [o.geo, o.geo.split('-')[0], 'en'] : [locale, locale.split('-')[0], ...profile.languages.filter((l) => !l.startsWith(locale.split('-')[0]))].slice(0, 3));
  return {
    profile: o.profile || 'chrome-linux',
    values: profile,
    userAgent: o.userAgent || profile.userAgent,
    userAgentMetadata: profile.userAgentMetadata,
    locale,
    timezone: o.timezone || geo?.tz || profile.timezone,
    acceptLanguage: o.acceptLanguage || geo?.acceptLanguage || languages.join(','),
    languages,
    noise: o.noise !== false,
    seed: Number.isFinite(o.seed) ? o.seed : 1337,
    webrtc: o.webrtc ?? 'default',          // 'default' | 'block'
    mediaDevices: o.mediaDevices !== false,
    hideEngine: o.hideEngine !== false,
    chromeRuntime: o.chromeRuntime === true,
  };
}

/**
 * Align the profile's claimed Chrome version with the real binary. Claiming 128 while
 * the browser is 154 is a contradiction detectors (creepjs, pixelscan) pick up.
 */
export function alignVersion(resolved, version) {
  if (!resolved) return resolved;              // stealth off → stay off
  if (!version) return resolved;
  const full = String(version).replace(/^.*\//, '').trim();
  const major = full.split('.')[0];
  if (!/^\d+$/.test(major)) return resolved;
  const out = { ...resolved, chromeVersion: { full, major } };
  if (out.userAgent) out.userAgent = out.userAgent.replace(/Chrome\/[\d.]+/, `Chrome/${full}`);
  if (out.userAgentMetadata) {
    out.userAgentMetadata = {
      ...out.userAgentMetadata,
      fullVersion: full,
      brands: (out.userAgentMetadata.brands || []).map((b) => /Chromium|Google Chrome/.test(b.brand) ? { ...b, version: major } : b),
    };
  }
  return out;
}

/**
 * Build the injected stealth source for a resolved profile.
 * Deterministic: the same seed always produces the same noise, so two reads of the
 * same canvas agree — which is exactly what canvas-fingerprint detectors check.
 */
export function buildStealthSource(resolved) {
  const r = resolved;
  const v = r.values;
  return String.raw`(function () {
  if (window.__vlxStealth) return;
  try { Object.defineProperty(window, '__vlxStealth', { value: 1, enumerable: false, configurable: true }); } catch (e) { window.__vlxStealth = 1; }
  var R = ${JSON.stringify({
    profile: r.profile,
    platform: v.platform, uaPlatform: v.uaPlatform, uaPlatformVersion: v.uaPlatformVersion,
    vendor: v.vendor, webglVendor: v.webglVendor, webglRenderer: v.webglRenderer,
    hardwareConcurrency: v.hardwareConcurrency, deviceMemory: v.deviceMemory,
    screen: v.screen, languages: r.languages, locale: r.locale, timezone: r.timezone,
    maxTouchPoints: v.maxTouchPoints || 0, mobile: !!v.mobile,
    noise: r.noise, seed: r.seed, webrtc: r.webrtc, mediaDevices: r.mediaDevices,
    uaMetadata: r.userAgentMetadata,
    chromeRuntime: !!r.chromeRuntime,     // off by default: a clean page has no chrome.runtime
  })};

  var def = function (obj, prop, value, enumerable) {
    try { Object.defineProperty(obj, prop, { get: typeof value === 'function' && value.__getter ? value.fn : function () { return value; }, configurable: true, enumerable: !!enumerable }); } catch (e) {}
  };
  var getter = function (fn) { var f = function () { return fn(); }; f.__getter = true; f.fn = fn; return f; };
  var navProto = (function () { try { return Object.getPrototypeOf(navigator); } catch (e) { return null; } })();
  // patch where the property actually lives (usually the prototype) so the descriptor
  // shape matches a clean browser instead of appearing as an own property
  var defNav = function (prop, value, enumerable) {
    // mount on the prototype wherever possible: a real browser exposes these there, and an
    // own property on the instance is exactly what "WebDriver (New)" style checks look for
    var target = navProto || navigator;
    try {
      var g;
      if (value && value.__getter) {
        g = value.fn;
      } else {
        // build a function literally NAMED "get <prop>" (WebIDL shape) and register it as
        // native-looking, so both Function.prototype.toString and .name match a real browser
        // WebIDL semantics: a real attribute getter throws "Illegal invocation" when
        // called on a foreign receiver. Detectors call the getter with a dummy object to see
        // whether it is a genuine accessor or a patched one that answers for anything.
        var lit = value;
        g = { ['get ' + prop]() {
          if (this !== navigator && !(this && typeof this === 'object' && 'userAgent' in this)) {
            throw new TypeError("Failed to read the '" + prop + "' property from 'Navigator': Illegal invocation");
          }
          return lit;
        } }['get ' + prop];
      }
      if (typeof markNative === 'function') g = markNative(g, 'get ' + prop);
      Object.defineProperty(target, prop, { get: g, configurable: true, enumerable: !!enumerable });
    } catch (e) { try { navigator[prop] = value; } catch (e2) {} }
  };

  // ── native-looking functions ───────────────────────────────────────────────
  // patched builtins must still report [native code] or the patch itself is the tell
  var nativeToString = Function.prototype.toString;
  var patched = new WeakMap();
  var fakeNative = function (name) { return 'function ' + name + '() { [native code] }'; };
  var toStringProxy = function () {
    var fn = this;
    if (patched.has(fn)) return patched.get(fn);
    var s = nativeToString.call(fn);
    if (/__vlx|vlxStealth|playwright|puppeteer|cdp|selenium|webdriver/i.test(s)) return fakeNative(fn.name || '');
    return s;
  };
  try {
    Object.defineProperty(Function.prototype, 'toString', { value: toStringProxy, writable: true, configurable: true, enumerable: false });
    patched.set(Function.prototype.toString, fakeNative('toString'));
  } catch (e) {}
  var markNative = function (fn, name) { patched.set(fn, fakeNative(name || fn.name || '')); return fn; };
  var originals = new WeakMap();
  var patch = function (holder, prop, impl, name) {
    try {
      var orig = holder[prop];
      // bookkeeping stays OUT of the function object: an own property on a patched builtin is
      // visible to any enumeration-based integrity check
      originals.set(holder[prop] = markNative(impl, name || prop), orig);
    } catch (e) {}
  };

  // ── seeded noise (deterministic per seed+input) ────────────────────────────
  var rand = (function (seed) {
    var s = (seed || 1) >>> 0;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  })(R.seed);
  var hash = function (str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  var noiseAt = function (key) {
    // stable pseudo-noise: same input → same output, so repeated reads agree
    var s = (R.seed >>> 0) ^ Math.imul(Math.floor(hash(key) * 4294967296), 2654435761);
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  // Selection noise needs a full avalanche: noiseAt() only perturbs low bits, so
  // floor(noise * n) — which reads the high bits — came out identical for every seed and
  // every identity reported the same GPU. seedPick() mixes properly (murmur3 finaliser).
  var seedPick = function (key) {
    var s = (R.seed >>> 0) ^ Math.imul(Math.floor(hash(key) * 4294967296) >>> 0, 2654435761);
    s = (s ^ (s >>> 16)) >>> 0; s = Math.imul(s, 2246822507) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0; s = Math.imul(s, 3266489909) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 4294967296;
  };

  // ── 1. navigator core ─────────────────────────────────────────────────────
  defNav('webdriver', undefined);
  defNav('platform', R.platform);
  defNav('vendor', ${JSON.stringify(v.vendor)});
  defNav('language', R.languages[0]);
  defNav('languages', R.languages.slice());
  defNav('hardwareConcurrency', R.hardwareConcurrency);
  try { defNav('deviceMemory', R.deviceMemory); } catch (e) {}
  defNav('maxTouchPoints', R.maxTouchPoints);
  try { defNav('doNotTrack', null); } catch (e) {}

  // ── 2. plugins / mimeTypes with a correct prototype chain ─────────────────
  try {
    var mime = function (type, suffixes, desc) { var m = Object.create(MimeType.prototype); m.type = type; m.suffixes = suffixes; m.description = desc; def(m, 'enabledPlugin', null); return m; };
    var plugin = function (name, desc, fn) {
      var p = Object.create(Plugin.prototype);
      def(p, 'name', name); def(p, 'description', desc); def(p, 'filename', fn); def(p, 'length', 1);
      var m = mime('application/x-google-chrome-pdf', 'pdf', 'Portable Document Format');
      p[0] = m; p['application/x-google-chrome-pdf'] = m;
      return p;
    };
    var list = [
      plugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      plugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      plugin('Chromium PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      plugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
      plugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer'),
    ];
    var arr = Object.create(PluginArray.prototype);
    list.forEach(function (p, i) { arr[i] = p; arr[p.name] = p; });
    def(arr, 'length', list.length);
    patch(arr, 'item', function (i) { return list[i] || null; }, 'item');
    patch(arr, 'namedItem', function (n) { for (var i = 0; i < list.length; i++) if (list[i].name === n) return list[i]; return null; }, 'namedItem');
    patch(arr, 'refresh', function () {}, 'refresh');
    defNav('plugins', arr);
    var marr = Object.create(MimeTypeArray.prototype);
    var mt = mime('application/pdf', 'pdf', 'Portable Document Format');
    def(mt, 'enabledPlugin', list[0]);
    marr[0] = mt; marr['application/pdf'] = mt;
    def(marr, 'length', 1);
    patch(marr, 'item', function (i) { return i === 0 ? mt : null; }, 'item');
    patch(marr, 'namedItem', function (n) { return n === 'application/pdf' ? mt : null; }, 'namedItem');
    defNav('mimeTypes', marr);
  } catch (e) {}

  // ── 3. window.chrome (present on every real Chrome page) ──────────────────
  try {
    if (!window.chrome) window.chrome = {};
    var c = window.chrome;
    if (!c.runtime && R.chromeRuntime) {          // off by default: clean pages have none
      c.runtime = {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', OTHER: 'other', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: markNative(function () { return { onDisconnect: { addListener: function () {} }, onMessage: { addListener: function () {} }, postMessage: function () {}, disconnect: function () {} }; }, 'connect'),
        sendMessage: markNative(function () {}, 'sendMessage'),
      };
    }
    if (!c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    if (!c.csi) c.csi = markNative(function () { return { startE: Date.now() - 3000, onloadT: Date.now() - 800, pageT: 2200, tran: 15 }; }, 'csi');
    if (!c.loadTimes) c.loadTimes = markNative(function () { return { commitLoadTime: Date.now() / 1000 - 2.1, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000 - 1.4, finishLoadTime: Date.now() / 1000 - 1.2, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000 - 1.9, navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000 - 2.4, startLoadTime: Date.now() / 1000 - 2.35, wasAlternateProtocolAvailable: false, wasFpProtocolUsed: false, wasNpnNegotiated: true }; }, 'loadTimes');
  } catch (e) {}

  // ── 4. permissions: Notification must agree with Notification.permission ──
  try {
    if (window.Notification) def(window.Notification, 'permission', 'default');
    if (navigator.permissions && navigator.permissions.query) {
      var pq = navigator.permissions.query.bind(navigator.permissions);
      patch(navigator.permissions, 'query', function (p) {
        try {
          if (p && p.name === 'notifications') return Promise.resolve({ state: (window.Notification && Notification.permission) || 'default', onchange: null });
        } catch (e) {}
        return pq(p);
      }, 'query');
    }
  } catch (e) {}

  // ── 5. WebGL identity: per-seed GPU + per-driver limits ──────────────────
  // A GPU is one of the strongest linking signals: two "different people" who report the
  // exact same renderer and the exact same capability limits are the same machine. Real GPUs
  // differ along both axes, so the seed picks a plausible card and nudges the limits the way
  // different driver versions report them.
  try {
    var GL_POOL = {
      // real cards only: a software rasteriser (llvmpipe/SwiftShader) is itself a VM tell,
      // so it never appears in an identity
      'chrome-windows': [
        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
      ],
      'chrome-mac': [
        ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)'],
        ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
        ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)'],
        ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
        ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics, Unspecified Version)'],
        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Pro 5500M, Unspecified Version)'],
      ],
      'chrome-linux': [
        ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'],
        ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)'],
        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060/PCIe/SSE2, OpenGL 4.6)'],
        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650/PCIe/SSE2, OpenGL 4.6)'],
        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.6)'],
        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600/PCIe/SSE2, OpenGL 4.6)'],
        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580/PCIe/SSE2, OpenGL 4.5)'],
      ],
      'chrome-android': [
        ['Google Inc. (Qualcomm)', 'Adreno (TM) 740'],
        ['Google Inc. (Qualcomm)', 'Adreno (TM) 730'],
        ['Google Inc. (Qualcomm)', 'Adreno (TM) 642L'],
        ['Google Inc. (ARM)', 'Mali-G710'],
        ['Google Inc. (ARM)', 'Mali-G78'],
        ['Google Inc. (ARM)', 'Mali-G68'],
        ['Google Inc. (Imagination)', 'PowerVR Rogue GE8320'],
      ],
    };
    var pool = GL_POOL[R.profile] || GL_POOL['chrome-linux'];
    var pick = pool[Math.floor(seedPick('gpu') * pool.length) % pool.length];
    var glVendor = pick[0], glRenderer = pick[1];
    // capability limits: real drivers of the same card report slightly different maxima
    var LIMITS = {
      3379:  [8192, 16384, 16384],   // MAX_TEXTURE_SIZE
      34076: [16384, 32768, 32768], // MAX_RENDERBUFFER_SIZE
      35660: [15, 30, 31],          // MAX_VARYING_VECTORS
      35661: [256, 1024, 4096],     // MAX_VERTEX_UNIFORM_VECTORS
      35667: [224, 1024, 4096],     // MAX_FRAGMENT_UNIFORM_VECTORS
      35621: [16, 16, 16],          // MAX_VERTEX_ATTRIBS
    };
    var jitterLimit = function (p, real) {
      var opts = LIMITS[p];
      if (!opts) return real;
      var f = seedPick('gl:' + p);
      return opts[Math.floor(f * opts.length) % opts.length];
    };
    var patchGL = function (proto) {
      if (!proto) return;
      var gp = proto.getParameter;
      patch(proto, 'getParameter', function (p) {
        if (p === 37445) return glVendor;            // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return glRenderer;          // UNMASKED_RENDERER_WEBGL
        if (p === 7936) return glVendor;             // VENDOR
        if (p === 7937) return glRenderer;           // RENDERER
        var real = gp.apply(this, arguments);
        // ALIASED_LINE_WIDTH_RANGE: a Float32Array, real drivers vary in their steps
        if (p === 33901 && real && real.length === 2) {
          try { var w = new Float32Array(real); w[0] = 1; w[1] = 1 + (seedPick('gl:lw') > 0.5 ? 1 : 0.5); return w; } catch (e) { return real; }
        }
        if (typeof real === 'number' && Object.prototype.hasOwnProperty.call(LIMITS, p)) return jitterLimit(p, real);
        return real;
      }, 'getParameter');
      var ge = proto.getExtension;
      patch(proto, 'getExtension', function (name) {
        var ext = ge.apply(this, arguments);
        if (!ext) return ext;
        if (name === 'WEBGL_debug_renderer_info' && typeof ext === 'object') {
          try { def(ext, 'UNMASKED_VENDOR_WEBGL', 37445); def(ext, 'UNMASKED_RENDERER_WEBGL', 37446); } catch (e) {}
        }
        return ext;
      }, 'getExtension');
      var gse = proto.getSupportedExtensions;
      if (gse && R.noise) patch(proto, 'getSupportedExtensions', function () {
        var list = gse.apply(this, arguments);
        if (!list || !list.length) return list;
        // driver build differences reorder the list; a rotation is what a different version
        // looks like, whereas a shuffle would contradict the reported limits
        var off = Math.floor(seedPick('gl:ext') * list.length) % list.length;
        return list.slice(off).concat(list.slice(0, off));
      }, 'getSupportedExtensions');
    };
    if (window.WebGLRenderingContext) patchGL(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) patchGL(WebGL2RenderingContext.prototype);
  } catch (e) {}

  // ── 5b. ClientRects: stable sub-pixel geometry jitter ────────────────────
  // element geometry is a linking signal too (font metrics + zoom + DPI leave a signature),
  // and real machines differ by fractions of a pixel. The jitter is cached per element, so
  // repeated reads agree — a moving target is itself a tell.
  try {
    var rectCache = new WeakMap();
    var jitterFor = function (el, r) {
      if (!el || !r || (r.width === 0 && r.height === 0)) return null;
      var hit = rectCache.get(el);
      if (hit) return hit;
      var h = seedPick('rect:' + (el.id || '') + ':' + el.tagName);
      var h2 = seedPick('rect2:' + (el.id || '') + ':' + el.tagName);
      hit = { dx: (h - 0.5) * 0.68, dy: (h2 - 0.5) * 0.68, dw: (h - 0.5) * 0.22, dh: (h2 - 0.5) * 0.22 };
      try { rectCache.set(el, hit); } catch (e) {}
      return hit;
    };
    var shift = function (r, j) {
      try {
        var Ctor = (typeof DOMRect === 'function') ? DOMRect : null;
        if (Ctor) return new Ctor(r.x + j.dx, r.y + j.dy, r.width + j.dw, r.height + j.dh);
      } catch (e) {}
      return { x: r.x + j.dx, y: r.y + j.dy, width: r.width + j.dw, height: r.height + j.dh, top: r.top + j.dy, left: r.left + j.dx, right: r.right + j.dx, bottom: r.bottom + j.dy, toJSON: function () { return { x: this.x, y: this.y, width: this.width, height: this.height }; } };
    };
    var ebcr = Element.prototype.getBoundingClientRect;
    patch(Element.prototype, 'getBoundingClientRect', function () {
      var r = ebcr.apply(this, arguments);
      if (!R.noise) return r;
      var j = jitterFor(this, r);
      return j ? shift(r, j) : r;
    }, 'getBoundingClientRect');
    var egcr = Element.prototype.getClientRects;
    if (egcr) patch(Element.prototype, 'getClientRects', function () {
      var list = egcr.apply(this, arguments);
      if (!R.noise || !list || !list.length) return list;
      try {
        var out = [];
        for (var i = 0; i < list.length; i++) { var j = jitterFor(this, list[i]); out.push(j ? shift(list[i], j) : list[i]); }
        if (typeof DOMRectList === 'function') { try { return new DOMRectList(this, out); } catch (e2) {} }
        out.item = function (k) { return this[k] || null; };
        return out;
      } catch (e) { return list; }
    }, 'getClientRects');
  } catch (e) {}

  // ── 6. canvas fingerprint noise: stable per input, so repeat reads match ──
  if (R.noise) {
    try {
      var perturb = function (data, key) {
        // ~1 pixel in 6 gets a 1-LSB nudge in one channel: invisible, but unique per
        // seed and perfectly deterministic for the same input
        for (var i = 0; i < data.length; i += 4) {
          var n = noiseAt(key + ':' + (i % 7919));
          if (n < 0.16) data[i] = data[i] ^ 1;
          else if (n < 0.32) data[i + 1] = data[i + 1] ^ 1;
          else if (n < 0.48) data[i + 2] = data[i + 2] ^ 1;
        }
        return data;
      };
      var fpCache = new WeakMap();
      var gid = CanvasRenderingContext2D.prototype.getImageData;
      patch(CanvasRenderingContext2D.prototype, 'getImageData', function (x, y, w, h) {
        var d = gid.apply(this, arguments);
        try { perturb(d.data, 'gid:' + w + 'x' + h + ':' + x + ':' + y); } catch (e) {}
        return d;
      }, 'getImageData');
      var tdu = HTMLCanvasElement.prototype.toDataURL;
      patch(HTMLCanvasElement.prototype, 'toDataURL', function () {
        // cache per canvas: detectors read twice and compare — a mutating patch would
        // make the two reads differ, which is exactly what they look for
        var cached = fpCache.get(this);
        if (cached) return cached;
        var out = tdu.apply(this, arguments);
        var ctx = null;
        var is2d = false;
        try { ctx = this.getContext('2d'); is2d = !!ctx; } catch (e) {}
        try {
          if (!is2d) {
            // a WebGL/other canvas: snapshot it into a 2D canvas and perturb the PIXELS.
            // Rendered-image hashes are the strongest GPU signal there is — patching the
            // reported renderer string does nothing for them, so the pixels have to move.
            if (R.noise && this.width * this.height <= 4e6) {
              var c2 = document.createElement('canvas');
              c2.width = this.width; c2.height = this.height;
              var x2 = c2.getContext('2d');
              x2.drawImage(this, 0, 0);
              var d2 = gid.call(x2, 0, 0, c2.width, c2.height);
              perturb(d2.data, 'gl:' + c2.width + 'x' + c2.height + (arguments[0] || ''));
              x2.putImageData(d2, 0, 0);
              out = tdu.call(c2, arguments[0], arguments[1]);
            }
          } else if (this.width * this.height <= 4e6) {
            var d = gid.call(ctx, 0, 0, this.width, this.height);
            perturb(d.data, 'tdu:' + this.width + 'x' + this.height + (arguments[0] || ''));
            ctx.putImageData(d, 0, 0);
            out = tdu.apply(this, arguments);
          }
        } catch (e) {}
        fpCache.set(this, out);
        return out;
      }, 'toDataURL');
      var tb = HTMLCanvasElement.prototype.toBlob;
      if (tb) patch(HTMLCanvasElement.prototype, 'toBlob', function (cb, type, q) {
        var cached = fpCache.get(this);
        if (cached) { try { cb(new Blob([cached])); return; } catch (e) {} }
        var args = [function (blob) { try { fpCache.set(this, blob); } catch (e) {} if (cb) cb(blob); }.bind(this), type, q];
        var ctx = this.getContext('2d');
        try {
          if (ctx && this.width * this.height <= 4e6) {
            var d = gid.call(ctx, 0, 0, this.width, this.height);
            perturb(d.data, 'tb:' + this.width + 'x' + this.height);
            ctx.putImageData(d, 0, 0);
          }
        } catch (e) {}
        return tb.apply(this, args);
      }, 'toBlob');
    } catch (e) {}
    // audio fingerprint noise
    try {
      if (window.AnalyserNode) {
        var gffd = AnalyserNode.prototype.getFloatFrequencyData;
        patch(AnalyserNode.prototype, 'getFloatFrequencyData', function (arr) {
          gffd.apply(this, arguments);
          try { for (var i = 0; i < arr.length; i += 16) arr[i] = arr[i] + (noiseAt('audio:' + i) - 0.5) * 1e-4; } catch (e) {}
        }, 'getFloatFrequencyData');
      }
      if (window.AudioBuffer) {
        var gcd = AudioBuffer.prototype.getChannelData;
        patch(AudioBuffer.prototype, 'getChannelData', function (ch) {
          var d = gcd.apply(this, arguments);
          try { for (var i = 0; i < d.length; i += 128) d[i] = d[i] + (noiseAt('pcm:' + ch + ':' + i) - 0.5) * 1e-7; } catch (e) {}
          return d;
        }, 'getChannelData');
      }
    } catch (e) {}
  }

  // ── 7. iframe contentWindow keeps our chrome object ───────────────────────
  try {
    var getCW = HTMLIFrameElement.prototype.__lookupGetter__('contentWindow');
    if (getCW) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: markNative(function () { var w = getCW.apply(this, arguments); if (w) { try { if (!w.chrome) w.chrome = window.chrome; } catch (e) {} } return w; }, 'get contentWindow'),
      configurable: true,
    });
  } catch (e) {}

  // ── 8. screen / viewport coherence with the declared device ───────────────
  try {
    var s = R.screen;
    def(screen, 'width', s.width); def(screen, 'height', s.height);
    def(screen, 'availWidth', s.availWidth); def(screen, 'availHeight', s.availHeight);
    def(screen, 'colorDepth', s.colorDepth); def(screen, 'pixelDepth', s.pixelDepth);
    try { def(screen, 'orientation', { type: s.width > s.height ? 'landscape-primary' : 'portrait-primary', angle: 0, onchange: null }); } catch (e) {}
    window.addEventListener('resize', function () {}, { passive: true });
  } catch (e) {}

  // ── 8b. window outer dims must be coherent with inner + screen ────────────
  try {
    var outer = function () { return { w: Math.max(innerWidth, Math.min(R.screen.width, innerWidth + 16)), h: Math.max(innerHeight, Math.min(R.screen.height, innerHeight + 88)) }; };
    def(window, 'outerWidth', getter(function () { return outer().w; }), true);
    def(window, 'outerHeight', getter(function () { return outer().h; }), true);
  } catch (e) {}

  // ── 9. media devices: a plausible, stable device list ─────────────────────
  if (R.mediaDevices && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    var devices = [
      { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'grp-audio' },
      { deviceId: 'communications', kind: 'audioinput', label: '', groupId: 'grp-audio' },
      { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'grp-audio' },
      { deviceId: 'vid-default', kind: 'videoinput', label: '', groupId: 'grp-video' },
    ];
    patch(navigator.mediaDevices, 'enumerateDevices', function () {
      return Promise.resolve(devices.map(function (d) { var o = Object.create(MediaDeviceInfo.prototype); def(o, 'deviceId', d.deviceId); def(o, 'kind', d.kind); def(o, 'label', d.label); def(o, 'groupId', d.groupId); return o; }));
    }, 'enumerateDevices');
    try { def(navigator.mediaDevices, 'getSupportedConstraints', function () { return { width: true, height: true, frameRate: true, aspectRatio: true, deviceId: true, facingMode: true }; }); } catch (e) {}
  }

  // ── 10. WebRTC: optionally stop local-IP leakage ─────────────────────────
  if (R.webrtc === 'block') {
    try {
      var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (RTC) {
        var patchedRTC = function (cfg, constraints) {
          var args = [cfg, constraints];
          if (cfg && cfg.iceServers) args[0] = Object.assign({}, cfg, { iceServers: [] });
          var pc = new RTC(...args);
          var origAdd = pc.createOffer && pc.createOffer.bind(pc);
          return pc;
        };
        patchedRTC.prototype = RTC.prototype;
        markNative(patchedRTC, 'RTCPeerConnection');
        window.RTCPeerConnection = patchedRTC;
      }
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        patch(navigator.mediaDevices, 'getUserMedia', function () { return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })); }, 'getUserMedia');
      }
    } catch (e) {}
  }

  // ── 10b. navigator.userAgentData — headless-shell lacks UA-CH entirely, and a
  // "Windows Chrome" UA with no userAgentData is itself a contradiction ─────────
  try {
    if (!navigator.userAgentData && R.uaMetadata) {
      var md = R.uaMetadata;
      var highEntropy = {
        architecture: md.architecture || 'x86',
        bitness: md.bitness || '64',
        brands: md.brands,
        fullVersionList: md.brands.map(function (b) { return { brand: b.brand, version: md.fullVersion }; }),
        mobile: !!md.mobile,
        model: md.model || '',
        platform: md.platform,
        platformVersion: md.platformVersion,
        uaFullVersion: md.fullVersion,
        wow64: false,
      };
      var uad = {
        brands: md.brands.slice(),
        mobile: !!md.mobile,
        platform: md.platform,
        getHighEntropyValues: markNative(function (hints) {
          var out = {};
          (hints || []).forEach(function (h) { if (h in highEntropy) out[h] = highEntropy[h]; });
          return Promise.resolve(out);
        }, 'getHighEntropyValues'),
        toJSON: markNative(function () { return { brands: md.brands.slice(), mobile: !!md.mobile, platform: md.platform }; }, 'toJSON'),
      };
      defNav('userAgentData', uad);
    }
  } catch (e) {}

  // ── 11. misc surfaces detectors read ─────────────────────────────────────
  try { defNav('connection', { effectiveType: '4g', rtt: 50, downlink: 10.5, saveData: false, onchange: null }); } catch (e) {}
  try {
    navigator.getBattery = markNative(function () { return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null }); }, 'getBattery');
  } catch (e) {}
  try { defNav('pdfViewerEnabled', true); } catch (e) {}
  try { def(screen, 'isExtended', false); } catch (e) {}

  // ── 11b. descriptor hygiene: nothing of ours may appear as an own property ─
  try {
    Object.defineProperty(window, '__vlxDescriptorClean', {
      value: function () {
        var own = Object.getOwnPropertyNames(navigator);
        var dirty = own.filter(function (k) {
          return ['webdriver','platform','vendor','language','languages','hardwareConcurrency','deviceMemory','maxTouchPoints','plugins','mimeTypes','userAgentData','connection','pdfViewerEnabled','oscpu','doNotTrack','standalone'].indexOf(k) !== -1;
        });
        return dirty;
      },
      enumerable: false, configurable: true,
    });
  } catch (e) {}

  // ── 12. hide our own engine surface from casual enumeration ───────────────
  ${r.hideEngine ? String.raw`
  try {
    var hide = function () {
      if (!window.__vlx) return;
      // keep it reachable (our protocol calls it) but non-enumerable and toString-safe
      try { Object.defineProperty(window, '__vlx', { value: window.__vlx, enumerable: false, configurable: true, writable: true }); } catch (e) {}
      var V = window.__vlx;
      if (V && typeof V === 'object') {
        try { Object.defineProperty(V, '_bound', { enumerable: false }); } catch (e) {}
      }
    };
    hide();
    setTimeout(hide, 0);
  } catch (e) {}
  ` : ''}
})();`;
}


/** Default-profile source, kept for backwards compatibility (compacted for size). */
export const STEALTH_SOURCE = buildStealthSource(resolveStealth(true)).replace(/^\s*\/\/.*$/gm, '').replace(/\n\s*/g, '\n');
