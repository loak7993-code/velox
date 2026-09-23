// velox :: lite/cache.js — conditional-GET cache (ETag / Last-Modified) for the
// browser-free engine. A 304 Not Modified round-trip costs a few hundred bytes
// instead of the whole page, which is where most scraping bandwidth goes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const keyOf = (url) => createHash('sha1').update(url).digest('hex');

export class HttpCache {
  /**
   * @param opts.dir      persist entries to disk (survives process restarts)
   * @param opts.maxEntries / maxBytes  LRU-ish eviction bounds
   */
  constructor({ dir, maxEntries = 1000, maxBytes = 128 << 20, ttl = 0 } = {}) {
    this.dir = dir || null;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.ttl = ttl;                       // 0 = only revalidate; >0 = serve fresh without asking
    this.entries = new Map();             // url -> entry
    this.stats = { hits: 0, misses: 0, revalidated: 0, stores: 0, bytesServed: 0, bytesSaved: 0, bytesFetched: 0 };
    if (this.dir) { try { mkdirSync(this.dir, { recursive: true }); } catch {} }
  }

  _diskPath(url) { return this.dir ? join(this.dir, keyOf(url) + '.json') : null; }

  get(url) {
    let e = this.entries.get(url);
    if (!e && this.dir) {
      const p = this._diskPath(url);
      try { if (existsSync(p)) e = JSON.parse(readFileSync(p, 'utf8')); } catch { e = null; }
      if (e) { e.body = Buffer.from(e.bodyB64 || '', 'base64'); this.entries.set(url, e); }
    }
    if (!e) { this.stats.misses++; return null; }
    // touch for LRU
    this.entries.delete(url); this.entries.set(url, e);
    if (this.ttl && Date.now() - e.savedAt < this.ttl) { this.stats.hits++; this.stats.bytesSaved += e.size || 0; return { ...e, fresh: true }; }
    return e;
  }

  set(url, { status, headers, body, etag, lastModified }) {
    const entry = {
      status, headers, etag, lastModified,
      body, size: body.length, savedAt: Date.now(),
      bodyB64: undefined,
    };
    this.entries.set(url, entry);
    this.stats.stores++;
    if (this.dir) {
      try {
        writeFileSync(this._diskPath(url), JSON.stringify({ status, headers, etag, lastModified, size: body.length, savedAt: entry.savedAt, bodyB64: body.toString('base64') }));
      } catch {}
    }
    this._evict();
    return entry;
  }

  /** Called when a conditional request came back 304 — the cached body was reused. */
  hit304(url, bytesSaved) {
    this.stats.revalidated++;
    this.stats.bytesSaved += bytesSaved || 0;
    const e = this.entries.get(url);
    if (e) { e.savedAt = Date.now(); this.entries.delete(url); this.entries.set(url, e); }
    return e;
  }

  _evict() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      const e = this.entries.get(oldest);
      if (this.dir) { try { rmSync(this._diskPath(oldest), { force: true }); } catch {} }
      this.entries.delete(oldest);
    }
    // also respect a byte budget (cheap approximation: drop oldest until under)
    let total = 0;
    for (const e of this.entries.values()) total += e.size || 0;
    while (total > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      const e = this.entries.get(oldest);
      total -= e.size || 0;
      if (this.dir) { try { rmSync(this._diskPath(oldest), { force: true }); } catch {} }
      this.entries.delete(oldest);
    }
  }

  get size() { return this.entries.size; }
  get bytes() { let t = 0; for (const e of this.entries.values()) t += e.size || 0; return t; }
  clear() { this.entries.clear(); if (this.dir) { try { rmSync(this.dir, { recursive: true, force: true }); mkdirSync(this.dir, { recursive: true }); } catch {} } }
}

export function createCache(opts) { return new HttpCache(opts); }
