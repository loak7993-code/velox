// velox :: proxy.js — proxy utilities: normalisation, health checks and a rotating pool.
import { fetch as liteFetch } from './lite/engine.js';

/**
 * One canonical proxy shape: { server, scheme, username?, password?, bypass? }
 * Accepts 'host:port', 'scheme://user:pass@host:port' or an options object.
 */
export function normalizeProxy(p) {
  if (!p) return null;
  const raw = typeof p === 'string' ? { server: p } : { ...p };
  let server = String(raw.server || '').trim();
  if (!server) return null;
  if (!/^[a-z0-9+.-]+:\/\//i.test(server)) server = 'http://' + server;
  let u;
  try { u = new URL(server); } catch { throw new Error(`invalid proxy: ${raw.server}`); }
  let scheme = u.protocol.replace(':', '').toLowerCase();
  if (scheme === 'socks') scheme = 'socks5';
  if (!['http', 'https', 'socks4', 'socks5'].includes(scheme)) throw new Error(`unsupported proxy scheme: ${scheme}`);
  const port = u.port || (scheme.startsWith('socks') ? '1080' : '80');
  const username = raw.username ?? (u.username ? decodeURIComponent(u.username) : undefined);
  const password = raw.password ?? (u.password ? decodeURIComponent(u.password) : undefined);
  return {
    ...raw,
    server: `${scheme}://${u.hostname}:${port}`,
    scheme,
    host: u.hostname,
    port: Number(port),
    username,
    password,
    ...(raw.bypass ? { bypass: raw.bypass } : {}),
  };
}

export function proxyFlags(proxy) {
  const p = normalizeProxy(proxy);
  if (!p) return [];
  return [
    `--proxy-server=${p.server}`,
    ...(p.bypass ? [`--proxy-bypass-list=${[].concat(p.bypass).join(';')}`] : []),
  ];
}

/**
 * Verify a proxy works: fetch `url` through it and report latency, status and
 * (optionally) the exit IP from `ipUrl`.
 *   await velox.checkProxy('socks5://user:pass@host:1080')
 *   → { ok: true, status: 200, ms: 142, ip: '203.0.113.7' }
 */
export async function checkProxy(proxy, { url = 'http://example.com', ipUrl, timeout = 15000 } = {}) {
  const p = normalizeProxy(proxy);
  if (!p) throw new Error('checkProxy: no proxy given');
  const t0 = Date.now();
  try {
    const probe = await liteFetch(url, { timeout, headers: { accept: '*/*' }, proxy: p });
    const via = probe.headers['x-vx-proxy-id'];
    let ip;
    if (ipUrl) {
      try { ip = (await liteFetch(ipUrl, { timeout, headers: { accept: '*/*' }, proxy: p })).text().trim(); } catch {}
    }
    return { ok: probe.status >= 200 && probe.status < 500, status: probe.status, ms: Date.now() - t0, via, ip, proxy: p.server };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.message, proxy: p.server };
  }
}

/**
 * A pool of proxies with rotation, sticky assignments, health checks and
 * automatic ejection of failing exit nodes.
 *
 *   const pool = new velox.ProxyPool(['http://u:p@a:8080', 'socks5://b:1080'], { strategy: 'least-latency' });
 *   await pool.healthCheck();
 *   const proxy = pool.next();                  // → pass to launch/newContext
 *   pool.release(proxy, { ok: false });         // mark a failure
 *   const sticky = pool.sticky('account-42');   // same proxy for the same key
 */
export class ProxyPool {
  constructor(proxies = [], opts = {}) {
    this.opts = {
      strategy: 'round-robin',      // round-robin | random | least-used | least-latency
      maxFailures: 3,               // eject after this many consecutive failures
      cooldownMs: 60_000,           // how long an ejected proxy stays out
      healthCheckUrl: 'http://example.com',
      healthCheckTimeout: 15000,
      ...opts,
    };
    this.proxies = proxies.map((p, i) => {
      const n = normalizeProxy(p);
      const creds = n.username ? `${encodeURIComponent(n.username)}:${encodeURIComponent(n.password ?? '')}@` : '';
      return {
        ...n,
        // ready-to-use forms: `url` keeps credentials, `server` is credential-free
        url: `${n.scheme}://${creds}${n.host}:${n.port}`,
        toProxy: () => ({ server: n.server, username: n.username, password: n.password, ...(n.bypass ? { bypass: n.bypass } : {}) }),
        id: n.server + (n.username ? `#${n.username}` : ''),
        _i: i, uses: 0, failures: 0, consecutive: 0, latency: null, ejectedUntil: 0,
      };
    });
    if (!this.proxies.length) throw new Error('ProxyPool: no proxies given');
    this._cursor = 0;
    this._sticky = new Map();
  }

  get size() { return this.proxies.length; }

  /** Live proxies (not ejected). Falls back to the full list if all are ejected. */
  available() {
    const now = Date.now();
    const live = this.proxies.filter((p) => p.ejectedUntil === 0 || p.ejectedUntil < now);
    return live.length ? live : this.proxies;
  }

  /** Next proxy according to the strategy. */
  next() {
    const pool = this.available();
    if (this.opts.strategy === 'random') return pool[Math.floor(Math.random() * pool.length)];
    if (this.opts.strategy === 'least-used') return pool.reduce((a, b) => (b.uses < a.uses ? b : a));
    if (this.opts.strategy === 'least-latency') {
      const known = pool.filter((p) => p.latency != null);
      if (known.length) return known.reduce((a, b) => (b.latency < a.latency ? b : a));
    }
    const p = pool[this._cursor % pool.length];
    this._cursor++;
    return p;
  }

  /** A proxy that stays the same for a given key (login/account/site affinity). */
  sticky(key) {
    const existing = this._sticky.get(key);
    if (existing) {
      const still = this.available().find((p) => p.id === existing);
      if (still) return still;
    }
    const chosen = this.next();
    this._sticky.set(key, chosen.id);
    return chosen;
  }

  /** Report the outcome of a use; counts failures and ejects when the threshold is hit. */
  release(proxy, { ok = true, latency } = {}) {
    const p = typeof proxy === 'string' ? this.proxies.find((x) => x.id === proxy) : proxy;
    if (!p) return;
    p.uses++;
    if (latency != null) p.latency = latency;
    if (ok) { p.consecutive = 0; return; }
    p.failures++;
    p.consecutive++;
    if (p.consecutive >= this.opts.maxFailures) p.ejectedUntil = Date.now() + this.opts.cooldownMs;
  }

  /** Run `fn(proxy)` once per healthy proxy with a fresh launch/context — handy for scraping. */
  async withProxy(fn, { attempts = this.size } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      const proxy = this.next();
      const t0 = Date.now();
      try {
        // hand a credential-carrying form to user code so auth survives
        const result = await fn(typeof proxy.toProxy === 'function' ? proxy.toProxy() : proxy);
        this.release(proxy, { ok: true, latency: Date.now() - t0 });
        return result;
      } catch (e) {
        lastErr = e;
        this.release(proxy, { ok: false, latency: Date.now() - t0 });
      }
    }
    throw lastErr || new Error('ProxyPool.withProxy: all proxies failed');
  }

  /** Probe every proxy: latency, status, exit IP. Updates ejection state. */
  async healthCheck({ url = this.opts.healthCheckUrl, ipUrl, timeout = this.opts.healthCheckTimeout } = {}) {
    const results = await Promise.all(this.proxies.map(async (p) => {
      const r = await checkProxy(p, { url, ipUrl, timeout });
      if (r.ok) { p.latency = r.ms; p.consecutive = 0; p.ejectedUntil = 0; }
      else { p.failures++; p.consecutive++; if (p.consecutive >= this.opts.maxFailures) p.ejectedUntil = Date.now() + this.opts.cooldownMs; }
      return { ...r, id: p.id };
    }));
    return results;
  }

  /** Per-proxy metrics for logging/dashboards. */
  stats() {
    const now = Date.now();
    return this.proxies.map((p) => ({
      id: p.id, server: p.server, uses: p.uses, failures: p.failures,
      latency: p.latency, ejected: p.ejectedUntil > now,
      ejectedInMs: p.ejectedUntil > now ? p.ejectedUntil - now : 0,
    }));
  }
}
