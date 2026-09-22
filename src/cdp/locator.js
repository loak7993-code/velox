// velox :: cdp/locator.js — zero-handle locators with the full Playwright-style surface.
// Every operation is ONE fresh round-trip: always current, never stale.
import { TimeoutError, withTimeout, sleep } from '../util.js';

const enc = encodeURIComponent;

/** Build a selector string from a getBy* spec */
export function byRoleSel(role, { name, exact } = {}) {
  return `role=${role}${name != null ? '@' + (exact ? '=' : '') + enc(name) : ''}`;
}
export const byTextSel = (text, exact) => (exact ? 'text==' : 'text=') + text;
export const byLabelSel = (text, exact) => (exact ? 'label==' : 'label=') + enc(text);
export const byPlaceholderSel = (text, exact) => (exact ? 'placeholder==' : 'placeholder=') + enc(text);
export const byAltTextSel = (text, exact) => (exact ? 'alt==' : 'alt=') + enc(text);
export const byTitleSel = (text, exact) => (exact ? 'title==' : 'title=') + enc(text);
export const byTestIdSel = (id) => 'testid=' + enc(id);

export class Locator {
  constructor(page, sel, filters = {}) {
    this.page = page;
    this.sel = sel;          // selector string (engine syntax)
    this._filters = filters; // { index, hasText, has, visible }
  }

  /* ------------- derivation ------------- */
  first() { return new Locator(this.page, this.sel, { ...this._filters, index: 0 }); }
  last() { return new Locator(this.page, this.sel, { ...this._filters, index: -1 }); }
  nth(i) { return new Locator(this.page, this.sel, { ...this._filters, index: i }); }
  filter({ hasText, has }) { return new Locator(this.page, this.sel, { ...this._filters, hasText, has }); }
  locator(sel) { return new Locator(this.page, this.sel + ' >> ' + sel, this._filters); }

  /* ------------- internals ------------- */
  _pickExpr() {
    const f = this._filters;
    const opts = {};
    if (f.index != null) opts.index = f.index;
    if (f.hasText != null) opts.hasText = f.hasText;
    if (f.has != null) opts.has = f.has;
    if (f.visible) opts.visible = true;
    return `__vlx.pick(${JSON.stringify(this.sel)}${Object.keys(opts).length ? ',' + JSON.stringify(opts) : ''})`;
  }
  _x(fn, ...args) { return `__vlx.${fn}(${this._pickExpr()}${args.length ? ',' + args.map((a) => JSON.stringify(a)).join(',') : ''})`; }
  _rootX() { return this.page._rootOverride ? this.page._rootOverride : null; }

  /* ------------- waits ------------- */
  async waitFor({ state = 'visible', timeout = 10000 } = {}) {
    const ok = await this.page.waitForSelector(this.sel, { timeout, state, _filters: this._filters });
    return ok ? this : null;
  }
  async waitFor_({ state = 'visible', timeout = 10000 } = {}) { return this.waitFor({ state, timeout }); }

  /* ------------- data (one round-trip each) ------------- */
  async text() { return this.page.eval(this._x('text')); }
  async innerText() { return this.page.eval(`(function(){var el=${this._pickExpr()};return el?el.innerText.trim():null})()`); }
  async html() { return this.page.eval(this._x('html')); }
  async innerHTML() { return this.html(); }
  async attr(name) { return this.page.eval(this._x('attr', name)); }
  getAttribute(name) { return this.attr(name); }
  async count() {
    if (!Object.keys(this._filters).length) return this.page.count(this.sel);
    return this.page.eval(`__vlx.pickCount(${JSON.stringify(this.sel)},${JSON.stringify(this._filters)})`);
  }
  async exists() { return (await this.count()) > 0; }
  async val() { return this.page.eval(this._x('val')); }
  inputValue() { return this.val(); }
  async isChecked() { const s = await this.states(); return s?.checked === true; }
  async isDisabled() { const s = await this.states(); return s?.disabled === true; }
  async isEditable() { const s = await this.states(); return s?.editable === true; }
  async isVisible() {
    const st = await this.page.eval(`(function(){var el=${this._pickExpr()};if(!el)return false;var st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0})()`);
    return st === true;
  }
  async isHidden() { return !(await this.isVisible()); }
  async states() { return this.page.eval(this._x('states')); }
  async boundingBox() { return this.page.eval(this._x('rect')); }
  async ariaSnapshot() { return this.page.eval(this._x('ariaSnapshot')); }
  allTextContents() { return this.page.texts(this.sel); }
  async extract(spec = { text: true }) { return this.page.extract(this.sel, spec); }
  async all() {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  /* ------------- actions ------------- */
  async click(opts = {}) {
    const { timeout = 10000, button = 'left', clicks = 1, modifiers = [], delay = 0, force = false, position, trial = false } = opts;
    if (!force) await withTimeout(this.page.waitForSelector(this.sel, { timeout, state: 'visible', _filters: this._filters }), timeout, `click ${this.sel}`);
    if (trial) return null;
    const p = position
      ? await this.page.eval(`(function(){var el=${this._pickExpr()};if(!el)return null;var r=el.getBoundingClientRect();return {x:r.x+${position.x},y:r.y+${position.y}}})()`)
      : await this.page.eval(this._x('point'));
    if (!p) throw new Error(`Not clickable: ${this.sel}`);
    await this.page.mouse.click(p.x, p.y, { button, clicks, modifiers, delay });
    return this.page;
  }
  async dblclick(opts = {}) { return this.click({ ...opts, clicks: 2 }); }
  async tap(opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `tap ${this.sel}`);
    const p = await this.page.eval(this._x('point'));
    if (!p) throw new Error(`Not tappable: ${this.sel}`);
    await this.page.touch.tap(p.x, p.y);
    return this.page;
  }
  async hover(opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `hover ${this.sel}`);
    const p = await this.page.eval(this._x('point'));
    if (p) await this.page.mouse.move(p.x, p.y, { steps: opts.steps ?? 3 });
    return this.page;
  }
  async focus() { return this.page.eval(this._x('focus')); }
  async blur() { return this.page.eval(this._x('blur')); }
  async scrollIntoViewIfNeeded({ timeout = 10000 } = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout, state: 'visible', _filters: this._filters }), timeout, `scroll ${this.sel}`).catch(() => {});
    return this.page.eval(this._x('scrollIntoView'));
  }
  async type(text, opts = {}) { return this.page.type(this.sel, text, { ...opts, _filters: this._filters }); }
  async press(key, opts = {}) {
    await this.focus();
    return this.page.press(key, opts);
  }
  async fill(value, opts = {}) {
    const { timeout = 10000 } = opts;
    await withTimeout(this.page.waitForSelector(this.sel, { timeout, state: 'visible', _filters: this._filters }), timeout, `fill ${this.sel}`);
    const ok = await this.page.eval(this._x('fill', value));
    if (!ok) throw new Error(`Cannot fill: ${this.sel}`);
    return this.page;
  }
  async setChecked(checked, opts = {}) {
    if (checked) return this.check(opts);
    return this.uncheck(opts);
  }
  async check(opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `check ${this.sel}`);
    const ok = await this.page.eval(this._x('setChecked', true));
    if (!ok) throw new Error(`Not a checkbox/radio: ${this.sel}`);
    return this.page;
  }
  async uncheck(opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `uncheck ${this.sel}`);
    const ok = await this.page.eval(this._x('setChecked', false));
    if (!ok) throw new Error(`Not a checkbox/radio: ${this.sel}`);
    return this.page;
  }
  async selectOption(values, opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `select ${this.sel}`);
    const chosen = await this.page.eval(this._x('selectOption', values));
    if (chosen === null) throw new Error(`Not a <select>: ${this.sel}`);
    return chosen;
  }
  async selectText(opts = {}) {
    await withTimeout(this.page.waitForSelector(this.sel, { timeout: opts.timeout ?? 10000, state: 'visible', _filters: this._filters }), opts.timeout ?? 10000, `selectText ${this.sel}`);
    return this.page.eval(this._x('selectText'));
  }
  async dragTo(target, opts = {}) {
    const t = typeof target === 'string' ? this.page.locator(target) : target;
    return this.page.dragAndDrop(this.sel, t.sel, { ...opts, _srcFilters: this._filters, _dstFilters: t._filters });
  }
  async screenshot(opts = {}) { return this.page.screenshot({ ...opts, selector: this.sel }); }
  async elementHandle() { return this.page.elementHandle(this.sel); }
  async evaluate(fn, arg) { return this.page.$eval(this.sel, fn, arg, this._filters); }
}
