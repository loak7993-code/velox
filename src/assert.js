// velox :: assert.js — tiny expect() for locator/page assertions with auto-retry.
// Not a test runner — just the polling assertions, Playwright-expect flavored.
import { sleep } from './util.js';

const noop = () => {};

class Expectation {
  constructor(target, opts) { this.target = target; this.opts = opts || {}; this.not = { ...this, _negated: true }; this._negated = false; }

  async _poll(fn, { timeout = 5000, message } = {}) {
    const t0 = Date.now();
    for (;;) {
      let ok, value;
      try { value = await fn(); ok = value === true; }
      catch (e) { ok = false; value = e; }
      if (this._negated ? !ok : ok) return this._negated ? undefined : value;
      if (Date.now() - t0 > timeout) {
        throw new Error(`expect${this._negated ? ' not' : ''}(${message || 'condition'}) failed after ${timeout}ms — got: ${JSON.stringify(value?.message ?? value)}`);
      }
      await sleep(100);
    }
  }
}

function make(target, opts) {
  const isPage = target && typeof target.goto === 'function' && !target.sel;
  const isLocator = target && target.sel !== undefined;
  const E = new Expectation(target, opts);

  const api = {
    async toBeVisible(opts = {}) {
      if (isPage) throw new Error('toBeVisible is a locator assertion');
      return E._poll(() => target.isVisible(), { ...opts, message: `${target.sel} visible` });
    },
    async toBeHidden(opts = {}) { return E._poll(() => target.isHidden(), { ...opts, message: `${target.sel} hidden` }); },
    async toBeEnabled(opts = {}) { return E._poll(() => !target.isDisabled(), { ...opts, message: `${target.sel} enabled` }); },
    async toBeDisabled(opts = {}) { return E._poll(() => target.isDisabled(), { ...opts, message: `${target.sel} disabled` }); },
    async toBeChecked(opts = {}) { return E._poll(() => target.isChecked(), { ...opts, message: `${target.sel} checked` }); },
    async toBeEditable(opts = {}) { return E._poll(() => target.isEditable(), { ...opts, message: `${target.sel} editable` }); },
    async toHaveText(text, opts = {}) {
      return E._poll(async () => (await target.text()) === text ? true : (await target.text()), { ...opts, message: `${target.sel} text=${text}` });
    },
    async toContainText(text, opts = {}) {
      return E._poll(async () => ((await target.text()) || '').includes(text), { ...opts, message: `${target.sel} contains ${text}` });
    },
    async toHaveValue(value, opts = {}) {
      return E._poll(async () => (await target.val()) === value ? true : (await target.val()), { ...opts, message: `${target.sel} value=${value}` });
    },
    async toHaveCount(n, opts = {}) {
      return E._poll(async () => (await target.count()) === n ? true : (await target.count()), { ...opts, message: `${target.sel} count=${n}` });
    },
    async toHaveAttribute(name, value, opts = {}) {
      return E._poll(async () => (await target.attr(name)) === value ? true : (await target.attr(name)), { ...opts, message: `${target.sel}[${name}]=${value}` });
    },
    async toHaveTitle(title, opts = {}) {
      return E._poll(async () => (await target.title()) === title ? true : (await target.title()), { ...opts, message: `title=${title}` });
    },
    async toHaveURL(urlOrRe, opts = {}) {
      return E._poll(async () => {
        const u = await target.url();
        return urlOrRe instanceof RegExp ? urlOrRe.test(u) : u === urlOrRe ? true : u;
      }, { ...opts, message: `url=${urlOrRe}` });
    },
    // page-only
    async toHaveCookie(name, opts = {}) {
      return E._poll(async () => (await target.cookies()).some((c) => c.name === name), { ...opts, message: `cookie ${name}` });
    },
  };
  // negated variant
  const negApi = {};
  for (const [k, fn] of Object.entries(api)) {
    negApi[k] = async (...args) => {
      E._negated = true;
      try { return await fn(...args); } finally { E._negated = false; }
    };
  }
  api.not = negApi;
  return api;
}

/** expect(locatorOrPage).toBeVisible() / expect(page).toHaveTitle('x') */
export function expect(target, opts) { return make(target, opts); }
