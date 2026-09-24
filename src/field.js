// velox :: field.js — helpers shaped by real field use: the loops people write over and
// over against anti-bot-heavy targets. Everything here is additive.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sleep } from './util.js';

/* ────────────────────────────── cookie / session plumbing ────────────────────────────── */

const IPish = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost' || h.includes(':');

/**
 * Normalise cookies for CDP: the classic hybrid-pipeline bug is a cookie whose domain
 * lacks the leading dot (`amazon.com`) being set host-only, so every request to
 * `www.amazon.com` misses it. We dot the domain, default the path, derive url-form
 * cookies into domain form and de-duplicate.
 */
export function normalizeCookies(input) {
  const list = [].concat(input || []);
  const out = [];
  const seen = new Map();
  const skipped = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { skipped.push({ cookie: raw, why: 'not an object' }); continue; }
    let { name, value, domain, path, expires, httpOnly, secure, sameSite, url } = raw;
    if (!name) { skipped.push({ cookie: raw, why: 'no name' }); continue; }
    if (value == null) value = '';
    let host = domain ? String(domain).trim() : null;
    if (!host && url) { try { host = new URL(url).hostname; } catch { /* ignore */ } }
    if (!host) { skipped.push({ cookie: { name }, why: 'no domain or url' }); continue; }
    let dom = host.replace(/^\./, '').toLowerCase();
    if (!IPish(dom) && dom.includes('.') && !dom.startsWith('.')) dom = '.' + dom;   // subdomain-inclusive
    const p = path || (url ? (new URL(url).pathname.startsWith('/') ? '/' : '/') : '/');
    const cookie = { name, value: String(value), domain: dom, path: p.startsWith('/') ? p : '/' + p };
    if (expires !== undefined) cookie.expires = typeof expires === 'number' ? expires : Math.floor(Date.parse(expires) / 1000);
    if (httpOnly !== undefined) cookie.httpOnly = !!httpOnly;
    if (secure !== undefined) cookie.secure = !!secure;
    if (sameSite) cookie.sameSite = /^(strict|lax|none)$/i.test(sameSite) ? (sameSite[0].toUpperCase() + sameSite.slice(1).toLowerCase()) : sameSite;
    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
    if (seen.has(key)) { out[seen.get(key)] = cookie; continue; }        // later wins
    seen.set(key, out.length);
    out.push(cookie);
  }
  return { cookies: out, skipped, dropped: skipped.length };
}

/** Parse a curl / document.cookie style header: `a=b; c=d`. */
export function parseCurlCookies(header, { domain } = {}) {
  if (!header || typeof header !== 'string') return [];
  const cleaned = header.replace(/^\s*cookie:\s*/i, '').replace(/[\r\n]+/g, '');
  return cleaned.split(';').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return null;
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), ...(domain ? { domain } : {}) };
  }).filter(Boolean);
}

/** Parse a Netscape cookies.txt dump. */
export function parseNetscapeCookies(text) {
  return String(text).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((line) => {
    const [domain, , path, secure, expires, name, ...rest] = line.split('\t');
    return { name, value: rest.join('\t').trim(), domain, path, secure: secure === 'TRUE', expires: Number(expires) || undefined };
  }).filter((c) => c.name);
}

/** Extract cookies (and optionally storage) from a HAR file. */
export function importHAR(source, { urlFilter, storage = false } = {}) {
  const har = typeof source === 'string' && source.trim().startsWith('{') ? JSON.parse(source) : JSON.parse(readFileSync(source, 'utf8'));
  const cookies = [];
  const match = (u) => !urlFilter || (urlFilter instanceof RegExp ? urlFilter.test(u) : String(u).includes(urlFilter));
  for (const entry of har?.log?.entries || []) {
    if (!match(entry.request?.url || '')) continue;
    const setHeaders = Object.entries(entry.response?.headers || {}).filter(([k]) => k.toLowerCase() === 'set-cookie');
    for (const [, v] of setHeaders) {
      const [pair, ...attrs] = String(v).split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const a = {};
      for (const x of attrs) { const [k, val = ''] = x.split('='); a[k.trim().toLowerCase()] = val.trim(); }
      cookies.push({
        name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(),
        domain: a.domain || new URL(entry.request.url).hostname, path: a.path || '/',
        httpOnly: a.httponly !== undefined, secure: a.secure !== undefined,
      });
    }
  }
  const localStorage = storage ? (har?.log?.pages || []).flatMap(() => []).concat(
    (har?.log?.entries || []).filter((e) => (e.response?.content?.mimeType || '').includes('json')).slice(0, 0).map(() => ({}))
  ) : [];
  return { cookies: normalizeCookies(cookies).cookies, localStorage: localStorage.filter((x) => Object.keys(x).length) };
}

/** Pending session applied to the next page/context created (velox.importSession before launch). */
let pendingSession = null;
export function setPendingSession(session) { pendingSession = session; }
export function takePendingSession() { const s = pendingSession; pendingSession = null; return s; }

export function importSession(input, opts = {}) {
  const session = Array.isArray(input) || (input && input.cookies)
    ? { cookies: normalizeCookies(input.cookies || input).cookies, localStorage: input.localStorage || [] }
    : typeof input === 'string' && input.trim().startsWith('{')
      ? importHAR(input, opts)
      : { cookies: normalizeCookies(parseCurlCookies(input, opts)).cookies, localStorage: [] };
  setPendingSession(session);
  return session;
}

/** Playwright-format storage state from a page/context. */
export async function exportSession(target) {
  if (target?.storageState) return target.storageState();
  const cookies = await target.cookies();
  let origins = [];
  try {
    const st = await target.localStorage();
    const origin = new URL(target.url || target._url || 'http://localhost').origin;
    origins = [{ origin, localStorage: Object.entries(st.local || {}).map(([name, value]) => ({ name, value })) }];
  } catch {}
  return { cookies, origins };
}

/* ───────────────────────────── captcha / widget awareness ───────────────────────────── */

export const WIDGETS = [
  { type: 'turnstile', script: 'challenges\.cloudflare\.com/turnstile', iframe: 'challenges\.cloudflare\.com', key: /(0x4AAAAA[A-Za-z0-9_-]+|[a-zA-Z0-9_-]{20,})/, token: ['input[name="cf-turnstile-response"]', 'textarea[name="cf-turnstile-response"]'], markers: ['#turnstile-container', '.cf-turnstile', '#turnstile-wrapper', '#cf-turnstile'] },
  { type: 'recaptcha', script: 'recaptcha/(api|releases)', iframe: 'recaptcha/api2', key: /[?&]k=([\w-]+)/, token: ['textarea[name="g-recaptcha-response"]', '#g-recaptcha-response'], markers: ['.g-recaptcha', '#g-recaptcha', '#recaptcha-demo'] },
  { type: 'hcaptcha', script: 'hcaptcha\.com', iframe: 'hcaptcha\.com', key: /[?&]sitekey=([\w-]+)/, token: ['textarea[name="h-captcha-response"]', 'input[name="h-captcha-response"]'], markers: ['.h-captcha', '#hcaptcha-demo', '#hcaptcha-container'] },
  { type: 'arkose', script: 'arkoselabs\.com', iframe: 'arkoselabs\.com|funcaptcha', key: /[?&](?:pk|pkey)=([\w-]+)/, token: ['input[name="fc-token"]', 'input[name="arkose-token"]', 'input[name="verification-token"]'], markers: ['#arkose', '#arkose-iframe', '.arkose-challenge'] },
  { type: 'awswaf-grid', script: 'awswaf|aws-waf', iframe: 'awswaf', key: null, token: ['input[name="aws-waf-token"]', '#aws-waf-token'], markers: ['#amzn-captcha-verify-button', '#captcha-container', '#awswaf-iframe'] },
  { type: 'px', script: 'px-cloud|perimeterx', iframe: 'px-cloud|perimeterx', key: null, token: ['input[name="_px3"]', 'input[name="px-token"]'], markers: ['#px-captcha', '.px-captcha'] },
];

/**
 * Structured info about whatever anti-bot widget is on the page.
 *
 * Real pages are ambiguous: hCaptcha in "recaptcha compat" mode also renders a
 * `g-recaptcha-response` field, and Cloudflare mounts Turnstile inside a closed shadow
 * root where a plain `querySelectorAll('iframe')` cannot see it. So evidence is weighted
 * (script/iframe > container > token field), shadow roots are pierced, and the sitekey
 * is read out of the widget's iframe URL when the container carries no data-sitekey.
 */
export async function detectChallenge(page) {
  const probe = await page.eval(`(function(){
    var deep = function(sel){
      var out = Array.prototype.slice.call(document.querySelectorAll(sel));
      var walk = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
      var el;
      while ((el = walk.nextNode())) {
        if (el.shadowRoot) out = out.concat(Array.prototype.slice.call(el.shadowRoot.querySelectorAll(sel)));
        if (el.tagName === 'IFRAME') { try { if (el.contentDocument) out = out.concat(Array.prototype.slice.call(el.contentDocument.querySelectorAll(sel))); } catch (e) {} }
      }
      return out;
    };
    var scripts = Array.prototype.map.call(document.scripts, function(s){ return s.src || ''; }).filter(Boolean);
    var iframes = deep('iframe').map(function(f){ return f.src || ''; }).filter(Boolean);
    var nodes = deep('[id*="captcha"],[class*="captcha"],[id^="turnstile"],[class*="turnstile"],[id^="g-recaptcha"],[id^="hcaptcha"],[id^="arkose"],[id^="px-"],[data-pkey],[data-sitekey]').map(function(e){
      var r = e.getBoundingClientRect();
      return { id: e.id || null, cls: (e.className && String(e.className)) || '', tag: e.tagName.toLowerCase(),
               key: (e.getAttribute && (e.getAttribute('data-sitekey') || e.getAttribute('data-pkey'))) || null,
               w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
    });
    var inputs = Array.prototype.map.call(document.querySelectorAll('input,textarea'), function(i){ return i.name || i.id || ''; });
    return { scripts: scripts, iframes: iframes, nodes: nodes, inputs: inputs, html: document.documentElement.outerHTML.length };
  })()`).catch(() => ({ scripts: [], iframes: [], nodes: [], inputs: [] }));

  const scored = [];
  for (const w of WIDGETS) {
    let score = 0;
    const markers = [];
    const scriptRe = w.script ? new RegExp(w.script, 'i') : null;
    const iframeRe = w.iframe ? new RegExp(w.iframe, 'i') : null;
    const hitScript = scriptRe ? probe.scripts.find((s) => scriptRe.test(s)) : null;
    if (hitScript) { score += 5; markers.push(`script:${hitScript.slice(0, 70)}`); }
    const hitFrame = iframeRe ? probe.iframes.find((s) => iframeRe.test(s)) : null;
    if (hitFrame) { score += 4; markers.push(`iframe:${hitFrame.slice(0, 70)}`); }
    for (const n of probe.nodes) {
      const idHit = n.id && w.markers.some((m) => m.startsWith('#') && n.id.toLowerCase().startsWith(m.slice(1).toLowerCase().replace(/-container.*$/, '')));
      const clsHit = n.cls && w.markers.some((m) => m.startsWith('.') && n.cls.toLowerCase().includes(m.slice(1).toLowerCase().replace(/-container.*$/, '')));
      if (idHit || clsHit) { score += 2; markers.push(`node:${n.id || n.cls}`); }
    }
    if (probe.inputs.some((n) => w.token.some((t) => n && n.toLowerCase().includes(t.replace(/^.*name="?/, '').replace(/"?\]$/, '').toLowerCase())))) { score += 1; markers.push('token-field'); }
    if (score > 0) {
      const node = probe.nodes.find((n) => n.visible) || probe.nodes[0] || {};
      const keyFromUrl = (() => {
        for (const u of [...(hitFrame ? [hitFrame] : []), ...probe.iframes]) {
          const m = w.key ? u.match(w.key) : null;
          if (m) return m[1];
        }
        return null;
      })();
      scored.push({
        type: w.type, score, markers,
        sitekey: node.key || keyFromUrl || null,
        iframeUrl: hitFrame || null,
        containerId: node.id || null,
        visible: !!node.visible,
        scriptLoaded: !!hitScript,
      });
    }
  }
  if (!scored.length) return { type: null };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const winner = WIDGETS.find((w) => w.type === best.type);
  const tokenLength = await page.eval(`(function(){
    var sels = ${JSON.stringify(winner.token)};
    for (var i = 0; i < sels.length; i++) { var e = document.querySelector(sels[i]); if (e) return String(e.value || '').length; }
    return 0;
  })()`).catch(() => 0);
  return { ...best, tokenPresent: tokenLength > 8, tokenLength, competitors: scored.slice(1).map((s) => `${s.type}:${s.score}`) };
}

/**
 * Wait for a captcha token field to populate.
 *
 * On timeout it reports WHICH state it died in — "the widget never rendered" is a very
 * different problem from "the widget rendered but the field stayed empty" — instead of
 * returning null and leaving you guessing. It does not solve the puzzle; it removes the
 * boilerplate around waiting for the token that a real solve produces.
 */
export async function waitForCaptchaToken(page, selector, { timeout = 60000, poll = 250, type } = {}) {
  let sel = selector;
  let widgetType = type || null;
  if (!sel) {
    const info = await detectChallenge(page);
    widgetType = widgetType || info.type;
    const w = WIDGETS.find((x) => x.type === widgetType) || WIDGETS[0];
    sel = w.token.join(',');
  }
  const firstSel = String(sel).split(',')[0];
  const t0 = Date.now();
  let last = { found: false, tokenLength: 0, widget: 0, scriptLoaded: false };
  while (Date.now() - t0 < timeout) {
    const state = await page.eval(`(function(){
      var any = null;
      var sels = ${JSON.stringify(String(sel).split(','))};
      for (var i = 0; i < sels.length; i++) { var e = document.querySelector(sels[i]); if (e) { any = e; break; } }
      var nodes = document.querySelectorAll('iframe, [class*="captcha"], [id^="turnstile"], [id^="g-recaptcha"], [id^="hcaptcha"], [id^="arkose"], [id^="awswaf"], [id^="px-"]');
      return {
        found: !!any,
        tokenLength: any ? String(any.value || '').length : 0,
        widget: nodes.length,
        scriptLoaded: Array.prototype.some.call(document.scripts, function(s){ return /captcha|turnstile|recaptcha|hcaptcha|arkose|waf|px-cloud|arkoselabs/i.test(s.src || ''); }),
      };
    })()`).catch(() => last);
    last = state || last;
    if (state.found && state.tokenLength > 8) {
      return await page.eval(`(function(){var e=document.querySelector(${JSON.stringify(firstSel)}); return e ? e.value : null})()`);
    }
    await sleep(poll);
  }
  const reason = last.found
    ? (last.tokenLength ? 'token field present but stayed empty/too short (challenge not solved)' : 'token field present but never populated')
    : last.widget > 0 ? 'widget present but the token field is missing (wrong selector?)'
      : last.scriptLoaded ? 'captcha script loaded but the widget never rendered'
        : 'captcha script never loaded (blocked, wrong domain, or never requested)';
  const err = new Error(`waitForCaptchaToken: timed out after ${timeout}ms — state: ${reason}`);
  err.state = reason;
  err.detail = last;
  err.widget = widgetType;
  throw err;
}

/* ───────────────────────────────── network ergonomics ───────────────────────────────── */

/** Wrap a captured request entry so bodies are one await away. */
export function asResponse(entry, page) {
  if (!entry) return entry;
  return {
    url: entry.url, status: entry.response?.status ?? null, headers: entry.response?.headers || {},
    method: entry.method, postData: entry.postData, resourceType: entry.resourceType,
    fromCache: entry.response?.fromCache, timing: entry.response?.timing, entry,
    text: () => page.body(entry),
    body: () => page.body(entry),
    json: async () => { const t = await page.body(entry); try { return JSON.parse(t); } catch { return null; } },
  };
}

/* ───────────────────────────────── diagnostics & flow ───────────────────────────────── */

/** Everything needed to diagnose a failure, in one call. */
export async function debugDump(page, dir = 'velox-debug', { fullPage = true } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(dir, stamp);
  mkdirSync(out, { recursive: true });
  const summary = { url: page._url, title: null, errors: [], console: [], requests: 0, cookies: 0, createdAt: new Date().toISOString() };
  try { summary.title = await page.title(); } catch {}
  try { writeFileSync(join(out, 'page.html'), await page.content()); } catch {}
  try {
    const reqs = page.requests().map((r) => ({
      method: r.method, url: r.url, type: r.resourceType,
      status: r.response?.status ?? null, failed: r.failed || null, ms: r.response?.timing?.receiveHeadersEnd ?? null,
    }));
    summary.requests = reqs.length;
    writeFileSync(join(out, 'network.json'), JSON.stringify(reqs, null, 2));
    const bodies = {};
    for (const r of page.requests().slice(0, 40)) {
      if (!r.response || !/json|text|javascript|html/.test(r.response.headers?.['content-type'] || '')) continue;
      bodies[r.url] = await page.body(r).catch(() => null);
    }
    writeFileSync(join(out, 'bodies.json'), JSON.stringify(bodies, null, 2));
  } catch {}
  try {
    summary.console = page.console().map((c) => ({ type: c.type, text: c.text }));
    summary.errors = page.errors().map((e) => ({ text: e.text, url: e.url, line: e.line }));
    writeFileSync(join(out, 'console.log'), page.console().map((c) => `[${c.type}] ${c.text}`).join('\n'));
    writeFileSync(join(out, 'errors.log'), page.errors().map((e) => `${e.text} (${e.url}:${e.line})`).join('\n'));
  } catch {}
  try {
    const cookies = await page.cookies();
    summary.cookies = cookies.length;
    writeFileSync(join(out, 'cookies.json'), JSON.stringify(normalizeCookies(cookies).cookies, null, 2));
    writeFileSync(join(out, 'storage.json'), JSON.stringify(await page.localStorage().catch(() => ({})), null, 2));
  } catch {}
  try { writeFileSync(join(out, 'shot.png'), await page.screenshot({ full: fullPage })); } catch {}
  try { if (page._stealth) { const info = await detectChallenge(page); summary.challenge = info; } } catch {}
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  return { dir: out, ...summary };
}

/** Navigate with backoff — flaky residential proxies are the normal case. */
export async function gotoWithRetry(page, url, { retries = 3, backoff = 400, factor = 2, waitUntil = 'interactive', timeout = 45000, onAttempt, retryOn = null } = {}) {
  const attempts = [];
  let delay = backoff;
  for (let i = 0; i <= retries; i++) {
    const t0 = Date.now();
    try {
      const res = await page.goto(url, { waitUntil, timeout });
      const attempt = { attempt: i + 1, ms: Date.now() - t0, status: res?.status ?? null };
      attempts.push(attempt);
      onAttempt?.(attempt, null);
      return { ...res, attempts };
    } catch (e) {
      const attempt = { attempt: i + 1, ms: Date.now() - t0, error: e.message.slice(0, 160) };
      attempts.push(attempt);
      onAttempt?.(attempt, e);
      const retryable = retryOn ? retryOn(e) : /timeout|ERR_|ECONN|closed|Tunnel|SSL|reset|502|503|504/i.test(e.message);
      if (i === retries || !retryable) { e.attempts = attempts; throw e; }
      await sleep(delay);
      delay *= factor;
    }
  }
}

/* ─────────────────────────────────── attach ─────────────────────────────────── */

export function attachFieldHelpers(page, velox) {
  page.waitForCaptchaToken = (selector, o) => waitForCaptchaToken(page, selector, o);
  page.detectChallenge = () => detectChallenge(page);
  page.netlog = (filter) => {
    let entries = page.requests();
    if (filter) {
      const f = typeof filter === 'function' ? filter : (e) => new RegExp(String(filter).replace(/\*/g, '.*'), 'i').test(e.url) || RegExp(String(filter)).test(e.url);
      entries = entries.filter(f);
    }
    return entries.map((e) => asResponse(e, page));
  };
  page.debugDump = (dir, o) => debugDump(page, dir, o);
  page.gotoWithRetry = (url, o) => gotoWithRetry(page, url, o);
  page.cdp = (method, params = {}) => page.session.send(method, params);
  page.cdpFire = (method, params = {}) => page.session.fire(method, params);
  page.importSession = async (input, o) => {
    const s = importSession(input, o);
    if (s.cookies.length) await page.setCookies(s.cookies);
    if (s.localStorage?.length) await page.restoreStorage({ local: Object.fromEntries(s.localStorage.map((x) => [x.name, x.value])), session: {} }).catch(() => {});
    return { imported: s.cookies.length };
  };
  page.exportSession = () => exportSession(page);
  page.importCurl = (header, o) => page.importSession(parseCurlCookies(header, o), o);
  page.importHAR = (file, o) => page.importSession(importHAR(file, o), o);
  return page;
}
