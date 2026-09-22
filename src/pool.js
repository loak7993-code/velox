// velox :: pool.js — pre-warmed browser/page pool for parallel work
import { Browser } from './cdp/browser.js';

export class Pool {
  /**
   * @param opts { browsers, pagesPerBrowser, launch: {...Browser.launch opts}, pageOpts }
   * Pages are created eagerly and reused. acquire() never blocks longer than needed.
   */
  constructor(opts = {}) {
    this.opts = {
      browsers: opts.browsers ?? opts.size ?? 2,
      pagesPerBrowser: opts.pagesPerBrowser ?? 3,
      launch: { headless: true, ...(opts.launch || {}) },
      pageOpts: opts.pageOpts || {},
    };
    this._browsers = [];
    this._idle = [];
    this._busy = new Set();
    this._waiters = [];
    this._starting = false;
    this._closed = false;
    this.metrics = { created: 0, acquired: 0, released: 0, waited: 0 };
  }

  async _start() {
    if (this._starting || this._closed) return;
    this._starting = true;
    try {
      while (this._browsers.length < this.opts.browsers && !this._closed) {
        const b = await Browser.launch(this.opts.launch);
        this._browsers.push(b);
        for (let i = 0; i < this.opts.pagesPerBrowser; i++) {
          const p = await b.newPage(this.opts.pageOpts);
          this._idle.push(p); this.metrics.created++;
        }
      }
    } finally { this._starting = false; }
  }

  /** Get an idle page (launching browsers on demand), or queue until one frees. */
  async acquire() {
    if (this._closed) throw new Error('pool closed');
    if (!this._idle.length && this._browsers.length < this.opts.browsers) await this._start();
    if (this._idle.length) {
      const page = this._idle.pop();
      this._busy.add(page); this.metrics.acquired++;
      return page;
    }
    this.metrics.waited++;
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  release(page) {
    if (!this._busy.delete(page)) return;
    this.metrics.released++;
    if (page.isClosed) { this._replenish(); return; }
    const w = this._waiters.shift();
    if (w) { this._busy.add(page); this.metrics.acquired++; w(page); }
    else this._idle.push(page);
  }

  async _replenish() {
    if (this._closed) return;
    try {
      const b = this._browsers.find((x) => !x.closed);
      if (b) { const p = await b.newPage(this.opts.pageOpts); this._idle.push(p); this.metrics.created++; }
    } catch {}
  }

  /** Run fn(page) on an idle page; auto-releases. */
  async use(fn) {
    const page = await this.acquire();
    try { return await fn(page); }
    finally { this.release(page); }
  }

  /** map over items in parallel across the pool. */
  async map(items, fn, { concurrency } = {}) {
    const n = Math.min(concurrency || this.opts.browsers * this.opts.pagesPerBrowser, items.length);
    let i = 0;
    const results = new Array(items.length);
    const workers = Array.from({ length: n }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) break;
        results[idx] = await this.use((p) => fn(items[idx], p, idx));
      }
    });
    await Promise.all(workers);
    return results;
  }

  async close() {
    this._closed = true;
    await Promise.allSettled(this._browsers.map((b) => b.close()));
    this._browsers = []; this._idle = [];
  }
}
