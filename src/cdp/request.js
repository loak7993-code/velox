// velox :: cdp/request.js — APIRequestContext: plain HTTP requests that share the
// browser context's cookie state (Playwright-style request API, lite-engine fast).
import { fetch as liteFetch, CookieJar } from '../lite/engine.js';

export class APIRequestContext {
  constructor(context) {
    this.context = context;
  }

  /** Pull the context's cookies into a header for this origin. */
  async _cookieHeader(url) {
    try {
      const cookies = await this.context.cookies([url]);
      const u = new URL(url);
      const now = Date.now();
      return cookies
        .filter((c) => !c.expires || c.expires > now)
        .filter((c) => {
          const host = u.hostname.toLowerCase();
          const d = (c.domain || host).replace(/^\./, '');
          return host === d || host.endsWith('.' + d);
        })
        .filter((c) => !c.path || u.pathname.startsWith(c.path))
        .map((c) => `${c.name}=${c.value}`)
        .join('; ') || null;
    } catch { return null; }
  }

  /** Push any Set-Cookie from the response back into the browser context. */
  async _syncBack(res) {
    const sc = res.headers['set-cookie'];
    if (!sc) return;
    const list = [].concat(sc);
    if (!list.length) return;
    const url = new URL(res.url);
    const cookies = list.map((raw) => {
      const [pair, ...rest] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) return null;
      const attrs = {};
      for (const a of rest) { const [k, v = ''] = a.split('='); attrs[k.trim().toLowerCase()] = v.trim(); }
      return {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        domain: (attrs.domain || url.hostname).replace(/^\./, ''),
        path: attrs.path || '/',
        ...(attrs['max-age'] ? { expires: Math.floor(Date.now() / 1000) + (+attrs['max-age']) } : {}),
        ...(attrs.expires ? { expires: Math.floor(Date.parse(attrs.expires) / 1000) } : {}),
        ...(attrs.secure !== undefined ? { secure: true } : {}),
        ...(attrs.httponly !== undefined ? { httpOnly: true } : {}),
      };
    }).filter(Boolean);
    if (cookies.length) await this.context.setCookies(cookies).catch(() => {});
  }

  async fetch(url, opts = {}) {
    const base = typeof url === 'string' ? url : url.url;
    const full = this.context._opts?.baseURL && !/^https?:/i.test(base) ? new URL(base, this.context._opts.baseURL).href : base;
    const method = (opts.method || (typeof url === 'object' ? url.method : 'GET')).toUpperCase();
    const headers = { ...(opts.headers || {}) };
    const cookie = await this._cookieHeader(full);
    if (cookie && !headers.cookie) headers.cookie = cookie;

    let body = opts.data;
    if (body != null && typeof body === 'object' && !(body instanceof Buffer)) {
      const ct = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type');
      if (!ct || /json/.test(headers[ct])) { headers[ct || 'content-type'] = headers[ct] || 'application/json'; body = JSON.stringify(body); }
    }
    if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    }
    let u = full;
    if (opts.params) { const us = new URL(full); for (const [k, v] of Object.entries(opts.params)) us.searchParams.set(k, v); u = us.href; }

    const res = await liteFetch(u, {
      method, headers, body,
      timeout: opts.timeout || 30000,
      maxRedirects: opts.maxRedirects ?? 5,
      rejectUnauthorized: false,
    });
    await this._syncBack(res);
    const out = {
      url: res.url, status: res.status, headers: res.headers, body: res.body,
      ok: res.status >= 200 && res.status < 300,
      text: () => res.text(), json: () => res.json(), buffer: () => res.body,
    };
    if (opts.failOnStatusCode && !out.ok) throw new Error(`${method} ${u} → ${out.status}`);
    return out;
  }

  get(url, opts = {}) { return this.fetch(url, { ...opts, method: 'GET' }); }
  post(url, opts = {}) { return this.fetch(url, { ...opts, method: 'POST' }); }
  put(url, opts = {}) { return this.fetch(url, { ...opts, method: 'PUT' }); }
  patch(url, opts = {}) { return this.fetch(url, { ...opts, method: 'PATCH' }); }
  delete(url, opts = {}) { return this.fetch(url, { ...opts, method: 'DELETE' }); }
  head(url, opts = {}) { return this.fetch(url, { ...opts, method: 'HEAD' }); }
}
