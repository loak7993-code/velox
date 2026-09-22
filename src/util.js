// velox :: util.js — zero-dep helpers
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Number(process.hrtime.bigint() / 1000n); // µs
export const ms = () => Number(process.hrtime.bigint() / 1000000n);

export class TimeoutError extends Error {
  constructor(what, ms) { super(`Timeout ${ms}ms waiting for ${what}`); this.name = 'TimeoutError'; }
}

export function withTimeout(promise, ms_, what = 'operation') {
  if (ms_ == null || ms_ <= 0 || ms_ === Infinity) return promise;
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new TimeoutError(what, ms_)), ms_); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export async function retry(fn, { tries = 3, delay = 100, backoff = 2, onRetry } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      err = e;
      if (onRetry) onRetry(e, i + 1);
      if (i < tries - 1) await sleep(delay * Math.pow(backoff, i));
    }
  }
  throw err;
}

export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Human-like delay: jittered around target */
export const humanDelay = (ms_) => sleep(Math.max(1, Math.round(ms_ * (0.5 + Math.random()))));

/** Tiny event emitter */
export class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  once(ev, fn) {
    const off = this.on(ev, (...a) => { off(); fn(...a); });
    return off;
  }
  off(ev, fn) { this._h.get(ev)?.delete(fn); }
  emit(ev, ...args) {
    const set = this._h.get(ev);
    if (set) for (const fn of [...set]) { try { fn(...args); } catch (e) { this.emit('error', e); } }
    const any = this._h.get('*');
    if (any) for (const fn of [...any]) { try { fn(ev, ...args); } catch {} }
  }
}

export function b64(str) { return Buffer.from(str, 'utf8').toString('base64'); }
export function unb64(str) { return Buffer.from(str, 'base64').toString('utf8'); }

/** Merge default headers, lower-case keys */
export function normHeaders(h = {}) {
  const out = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

export function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
