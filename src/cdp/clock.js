// velox :: cdp/clock.js — virtual clock: fake Date/time + virtual timers,
// injected as an init script. fastForward() fires due timers without waiting.
import { Emitter } from '../util.js';

export const CLOCK_SOURCE = String.raw`
(function () {
  if (window.__vlxClock) return;
  var C = { offset: 0, fixed: null, running: true, seq: 1, tasks: new Map(), nowBase: performance.now() };
  var RealDate = Date;
  function vnow() {
    if (C.fixed != null) return C.fixed;
    return RealDate.now() + C.offset;
  }
  function VDate(a, b, c, d, e, f) {
    if (!(this instanceof VDate)) return new Date(vnow()).toString();
    if (a === undefined) return new RealDate(vnow());
    switch (arguments.length) {
      case 1: return new RealDate(a);
      case 2: return new RealDate(a, b);
      case 3: return new RealDate(a, b, c);
      case 4: return new RealDate(a, b, c, d);
      case 5: return new RealDate(a, b, c, d, e);
      default: return new RealDate(a, b, c, d, e, f);
    }
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = function () { return vnow(); };
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  Object.setPrototypeOf(VDate, RealDate);
  window.Date = VDate;
  var realPerfNow = performance.now.bind(performance);
  performance.now = function () { return realPerfNow() + C.offset; };
  if (performance.timeOrigin !== undefined) { try { performance.timeOrigin = performance.timeOrigin; } catch (e) {} }

  // virtual timers
  var rSetTimeout = window.setTimeout.bind(window);
  var rClearTimeout = window.clearTimeout.bind(window);
  var rSetInterval = window.setInterval.bind(window);
  var rClearInterval = window.clearInterval.bind(window);
  function schedule(kind, fn, delay, args) {
    var id = C.seq++;
    delay = Math.max(0, +delay || 0);
    C.tasks.set(id, { kind, fn, at: vnow() + delay, interval: kind === 'interval' ? delay : 0, args: args || [] });
    return id;
  }
  window.setTimeout = function (fn, delay) { return schedule('timeout', fn, delay, [].slice.call(arguments, 2)); };
  window.clearTimeout = function (id) { C.tasks.delete(id); };
  window.setInterval = function (fn, delay) { return schedule('interval', fn, delay, [].slice.call(arguments, 2)); };
  window.clearInterval = function (id) { C.tasks.delete(id); };
  window.requestAnimationFrame = function (fn) { return schedule('timeout', function () { fn(vnow()); }, 16); };
  window.cancelAnimationFrame = function (id) { C.tasks.delete(id); };
  window.requestIdleCallback = function (fn) { return schedule('timeout', function () { fn({ didTimeout: false, timeRemaining: function () { return 50; } }); }, 1); };

  C.tick = function (ms) {
    var target = vnow() + ms, guard = 0;
    for (;;) {
      var next = null;
      C.tasks.forEach(function (t, id) { if (t.at <= target && (next === null || t.at < next.at)) { next = { t: t, id: id }; } });
      if (!next || guard++ > 200000) break;
      C.offset = next.t.at - RealDate.now();
      try { next.t.fn.apply(null, next.t.args); } catch (e) {}
      if (next.t.kind === 'interval' && C.tasks.has(next.id)) next.t.at = next.t.at + next.t.interval;
      else C.tasks.delete(next.id);
    }
    C.offset = target - RealDate.now();
  };
  C.setFixed = function (t) { C.fixed = (t instanceof Date) ? t.getTime() : (new RealDate(t)).getTime(); };
  C.advance = function (ms) { if (C.fixed != null) C.fixed += ms; else C.offset += ms; };
  C.install = function (t) { if (t != null) C.setFixed(t); };
  C.resume = function () { C.fixed = null; };
  window.__vlxClock = C;
})();
`;

/** Node-side controller for the injected clock. State re-applies after every navigation. */
export class Clock {
  constructor(page) {
    this.page = page;
    this.installed = false;
    this._fixedTime = null;
    this._initIdentifier = null;
    // best-effort re-apply for same-document edge cases
    page.session.on('Page.frameNavigated', () => { if (this._fixedTime != null) this._applyFixed().catch(() => {}); });
  }

  async _ensure() {
    const ok = await this.page.eval('typeof __vlxClock === "object"').catch(() => false);
    if (!ok) await this.page.eval(CLOCK_SOURCE).catch(() => {});
  }

  async _applyFixed() {
    // the init script may not have run yet in the new document — ensure the source first
    await this._ensure();
    await this.page.eval(`__vlxClock.setFixed(${JSON.stringify(this._fixedTime)})`);
  }

  /** Freeze time at a fixed point (Date string, timestamp, or Date). */
  async setFixedTime(time) {
    await this._ensure();
    this._fixedTime = time instanceof Date ? time.toISOString() : time;
    await this.page.eval(`__vlxClock.setFixed(${JSON.stringify(this._fixedTime)})`);
    // persist across navigations: bake the fixed time into a fresh init script
    if (this._initIdentifier) {
      await this.page.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this._initIdentifier }).catch(() => {});
    }
    const { identifier } = await this.page.session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `${CLOCK_SOURCE}\ntry{__vlxClock.setFixed(${JSON.stringify(this._fixedTime)})}catch(e){}`,
    }).catch(() => ({ identifier: null }));
    this._initIdentifier = identifier;
    return true;
  }
  async install({ time } = {}) {
    await this._ensure();
    if (time != null) await this.setFixedTime(time);
    this.installed = true;
    return this;
  }
  /** Shift the clock forward without firing timers. */
  async advance(ms) {
    await this._ensure();
    return this.page.eval(`__vlxClock.advance(${ms})`);
  }
  /** Shift time AND fire all due virtual timers instantly. */
  async fastForward(ms) {
    await this._ensure();
    return this.page.eval(`__vlxClock.tick(${ms})`);
  }
  /** Resume real time. */
  async resume() {
    await this._ensure();
    this._fixedTime = null;
    if (this._initIdentifier) {
      await this.page.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this._initIdentifier }).catch(() => {});
      this._initIdentifier = null;
    }
    return this.page.eval('__vlxClock.resume()');
  }
}
