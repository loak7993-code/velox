// velox :: extend.js — make the library yours: middleware over every page command,
// custom commands, global selector engines, extra lifecycle hooks.
//
//   velox.middleware(async ({ page, method, args }, next) => {         // every page call
//     const t = Date.now(); const out = await next(); log(method, Date.now() - t); return out;
//   });
//   velox.registerCommand('dismissBanners', async function () {        // page.dismissBanners()
//     return this.click('.cookie-accept', { timeout: 800 }).catch(() => {});
//   });
//   velox.registerSelectorEngine('priceAbove', (value, root) => [...]); // 'priceAbove=25'
//   velox.hook('onNavigation', (page, url) => console.log('→', url));
import { Emitter } from './util.js';

const registry = {
  middleware: [],
  commands: { page: new Map(), browser: new Map(), locator: new Map() },
  selectorEngines: new Map(),
  hooks: { onNavigation: [], onPage: [], onBrowser: [], onRequest: [], onResponse: [], onError: [], onChallenge: [] },
  attached: new WeakSet(),
};

/** Wrap every page command in a chain: fn(ctx, next) — ctx = { page, method, args }. */
export function middleware(fn) {
  if (typeof fn !== 'function') throw new Error('velox.middleware(): expected a function');
  registry.middleware.push(fn);
  return () => { const i = registry.middleware.indexOf(fn); if (i >= 0) registry.middleware.splice(i, 1); };
}

/**
 * Add a method to every page (or browser/locator).
 * The function runs with `this` bound to the target instance.
 */
export function registerCommand(name, fn, { target = 'page' } = {}) {
  if (!registry.commands[target]) throw new Error(`velox.registerCommand(): unknown target "${target}" (page|browser|locator)`);
  registry.commands[target].set(name, fn);
  defineCommand(PROTOS[target], name, fn);              // applies immediately, everywhere
  return fn;
}

/** Register a selector engine globally — usable as `name=value` on every page. */
export function registerSelectorEngine(name, fn) {
  registry.selectorEngines.set(name, typeof fn === 'function' ? fn.toString() : String(fn));
  return fn;
}

/** Extra lifecycle hooks beyond the plugin system (multiple listeners allowed). */
export function hook(name, fn) {
  if (!registry.hooks[name]) registry.hooks[name] = [];
  registry.hooks[name].push(fn);
  return () => { const a = registry.hooks[name]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
}
export function runHooks(name, ...args) {
  for (const fn of registry.hooks[name] || []) { try { fn(...args); } catch {} }
}
export function hasHooks(name) { return (registry.hooks[name] || []).length > 0; }

/** The middleware chain, exposed for the page proxy. */
export function chainFor(page) {
  return registry.middleware;
}

// Prototypes backing each target kind, injected from index.js to avoid import cycles.
const PROTOS = { page: null, browser: null, locator: null };

export function bindPrototypes(protos = {}) {
  for (const [kind, proto] of Object.entries(protos)) {
    if (!proto) continue;
    PROTOS[kind] = proto;
    for (const [name, fn] of registry.commands[kind]) defineCommand(proto, name, fn);
  }
}

/** Commands live on the prototype, so they reach existing AND future instances. */
function defineCommand(proto, name, fn) {
  if (!proto || name in proto) return false;            // never shadow the real API
  Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true, enumerable: false });
  return true;
}

/** Kept for callers that used to attach per instance (now a no-op). */
export function applyExtensions(target) { return target; }

/** Namespace for user extensions: page.ext.anything = … */
export function makeExtNamespace(target) {
  const ext = Object.create(null);
  Object.defineProperty(target, 'ext', { value: ext, writable: false, configurable: true, enumerable: false });
  return ext;
}

export function registered() {
  return {
    middleware: registry.middleware.length,
    commands: { page: [...registry.commands.page.keys()], browser: [...registry.commands.browser.keys()], locator: [...registry.commands.locator.keys()] },
    selectorEngines: [...registry.selectorEngines.keys()],
    hooks: Object.fromEntries(Object.entries(registry.hooks).map(([k, v]) => [k, v.length])),
  };
}

export function selectorEngineSource() {
  if (!registry.selectorEngines.size) return null;
  const defs = [...registry.selectorEngines.entries()].map(([name, src]) => `__vlx.custom[${JSON.stringify(name)}] = (${src});`).join('\n');
  return `(function(){ var e = window.__vlx || {}; var c = e.custom || (e.custom = {}); if (!c.__globalLoaded) { ${defs} c.__globalLoaded = 1; } })();`;
}

export const _registry = registry;
export { Emitter };
