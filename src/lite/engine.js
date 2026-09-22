// velox :: lite/engine.js — from-scratch HTTP(S) client with keep-alive, compression,
// redirects and a cookie jar. The "no browser" fast path.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { parse, decodeEntities } from './html.js';

const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
};

export class CookieJar {
  constructor() { this.jar = new Map(); }
  _key(c) { return `${c.domain}|${c.path}|${c.name}`; }
  setFrom(url, setCookies) {
    const u = new URL(url);
    for (const raw of setCookies || []) {
      const [pair, ...rest] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const attrs = {};
      for (const a of rest) {
        const [k, v = ''] = a.split('=');
        attrs[k.trim().toLowerCase()] = v.trim();
      }
      const c = {
        name, value,
        domain: (attrs.domain || u.hostname).replace(/^\./, '').toLowerCase(),
        path: attrs.path || '/',
        expires: attrs.expires ? Date.parse(attrs.expires) : Infinity,
      };
      this.jar.set(this._key(c), c);
    }
  }
  headerFor(url) {
    const u = new URL(url);
    const now = Date.now();
    const out = [];
    for (const c of this.jar.values()) {
      if (c.expires < now) { this.jar.delete(this._key(c)); continue; }
      const host = u.hostname.toLowerCase();
      if (host === c.domain || host.endsWith('.' + c.domain)) {
        if (u.pathname.startsWith(c.path)) out.push(`${c.name}=${c.value}`);
      }
    }
    return out.length ? out.join('; ') : null;
  }
  toJSON() { return [...this.jar.values()]; }
  get size() { return this.jar.size; }
}

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
};

export async function fetch(url, opts = {}) {
  let current = url;
  const jar = opts.jar || new CookieJar();
  const maxRedirects = opts.maxRedirects ?? 10;
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers || {}) };
  if (headers['accept-encoding'] === undefined) delete headers['accept-encoding'];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const cookie = jar.headerFor(current);
    const u = new URL(current);
    const mod = u.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint();

    const res = await new Promise((resolve, reject) => {
      const req = mod.request(u, {
        method: opts.method || 'GET',
        agent: agents[u.protocol === 'https:' ? 'https' : 'http'],
        headers: { ...headers, ...(cookie ? { cookie } : {}), ...(opts.body ? { 'content-length': Buffer.byteLength(opts.body) } : {}) },
        ...(opts.timeout ? { timeout: opts.timeout } : {}),
        ...(opts.rejectUnauthorized === false && u.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      }, resolve);
      req.on('timeout', () => req.destroy(new Error(`timeout after ${opts.timeout}ms`)));
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });

    jar.setFrom(current, res.headers['set-cookie']);

    const decompress = (buf) => {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf);
      if (enc === 'deflate' || enc === 'x-deflate') return zlib.inflateSync(buf);
      if (enc === 'br') return zlib.brotliDecompressSync(buf);
      return buf;
    };

    const chunks = [];
    for await (const c of res) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body;
    try { body = decompress(raw); } catch { body = raw; }
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n);

    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      current = new URL(res.headers.location, current).href;
      if (res.statusCode === 303) { opts.method = 'GET'; delete opts.body; }
      continue;
    }
    return new LiteResponse(current, url, res.statusCode, res.headers, body, ms, jar, res);
  }
  throw new Error(`Too many redirects (> ${maxRedirects})`);
}

export class LiteResponse {
  constructor(finalUrl, startUrl, status, headers, body, ms, jar, rawRes) {
    this.url = finalUrl; this.startUrl = startUrl; this.status = status;
    this.headers = headers; this.body = body; this.ms = ms; this.jar = jar; this.raw = rawRes;
    this._doc = null;
  }
  text() { return this.body.toString('utf8'); }
  json() { return JSON.parse(this.text()); }
  get doc() { if (!this._doc) this._doc = parse(this.text()); return this._doc; }
  title() { return this.doc.title(); }
  header(name) { return this.headers[String(name).toLowerCase()]; }
  cookieHeader() { return this.jar.headerFor(this.url); }
}

/* ----------------------------------------- JS-need detection ----------------------------------------- */

const SPA_ROOT = /<div[^>]+id=["']?(root|app|__next|__nuxt|q-app|svelte|elm|vue-app)["']?[^>]*>\s*(<\/div>|<!--.*?-->)/i;
const SSR_STATE = /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|window\.__PRELOADED|application\/ld\+json/;

export function needsJS(res) {
  if (res.status === 403 || res.status === 503) {
    const server = String(res.header('server') || '');
    if (/cloudflare|akamai|fastly/i.test(server) || res.header('cf-mitigated')) return true;
  }
  const html = res.text();
  if (html.length < 4000 && SPA_ROOT.test(html) && !SSR_STATE.test(html)) return true;
  const bodyText = stripTags(html);
  const scripts = (html.match(/<script[^>]+src=/gi) || []).length;
  if (bodyText.length < 250 && scripts >= 2 && !SSR_STATE.test(html)) return true;
  if (/<noscript[^>]*>[^]{0,400}(enable|turn on|requires) javascript/i.test(html) && bodyText.length < 500) return true;
  if (/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=/i.test(html) && bodyText.length < 300) return true;
  return false;
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}
