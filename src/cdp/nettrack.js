// velox :: cdp/nettrack.js — request/response capture, bodies, HAR export and the
// network wait helpers. Split out of page.js; all are prototype methods on VeloxPage
// operating on the page's capture state (_requests / _reqOrder / _inflight / …).
import { Buffer } from 'node:buffer';
import { globToRe, mapConcurrent } from '../util.js';
import { fmtBytes } from '../bandwidth.js';
import { buildHar } from './har.js';
import { asResponse } from '../field.js';

export function toMatcher(match) {
  if (typeof match === 'function') return match;
  if (match instanceof RegExp) return (u) => match.test(u);
  if (typeof match === 'string' && match.includes('*')) {
    const re = globToRe(match);
    return (u) => re.test(u);
  }
  const s = String(match);
  return (u) => u === s || u.startsWith(s + '?') || u.includes(s);
}

export function _onRequest({ requestId, request, type, frameId, redirectResponse, timestamp, wallTime }) {
  const existing = this._requests.get(requestId);
  if (existing && redirectResponse) {
    // same requestId continues after a redirect: close the hop, chain it, keep counting inflight
    (existing.redirectChain ||= []).push({ url: existing.url, status: redirectResponse.status, headers: redirectResponse.headers });
    existing.response = { status: redirectResponse.status, headers: redirectResponse.headers, url: redirectResponse.url };
    existing.done = true; existing.encodedDataLength = redirectResponse.encodedDataLength;
  }
  if (!existing || redirectResponse) {
    const entry = {
      id: requestId, url: request.url, method: request.method, headers: request.headers,
      resourceType: type, frameId, postData: request.postData, wallTime,
      response: null, done: false, body: undefined, failed: null, page: this,
      ...(existing?.redirectChain ? { redirectChain: existing.redirectChain } : {}),
    };
    this._requests.set(requestId, entry);
    if (!existing) { this._reqOrder.push(requestId); this._inflight++; }
    this.emit('request', entry);
  }
  // main document tracking: requestWillBeSent can beat frameNavigated, so
  // accept Document requests while the main frame id is still unknown
  if (type === 'Document' && !this._docResponse && (frameId === this._mainFrameId || !this._mainFrameId)) {
    this._docResponse = { url: request.url, status: null };
  }
}

export function _onResponse({ requestId, response, timestamp, frameId, type }) {
  const e = this._requests.get(requestId);
  if (!e) return;
  e.response = { status: response.status, statusText: response.statusText, headers: response.headers, url: response.url, remoteIP: response.remoteIPAddress, protocol: response.protocol, timing: response.timing, fromCache: response.fromDiskCache, security: response.securityDetails?.protocol };
  if ((e.resourceType ?? type) === 'Document' && (frameId === this._mainFrameId || !this._mainFrameId)) {
    this._docResponse = { url: response.url, status: response.status, headers: response.headers };
  }
  this.emit('response', e);
}

export function _onDone(requestId, timestamp, encodedDataLength, failInfo) {
  const e = this._requests.get(requestId);
  if (!e || e.done) return;
  e.done = true; e.encodedDataLength = encodedDataLength ?? 0;
  if (failInfo) { e.failed = failInfo.errorText || failInfo.blockedReason || 'failed'; e.canceled = !!failInfo.canceled; }
  this._inflight = Math.max(0, this._inflight - 1);
  this._checkIdle();
  this.emit('requestfinished', e);
}

/** All captured requests (in order). */
export function requests({ filter } = {}) {
  let list = this._reqOrder.map((id) => this._requests.get(id)).filter(Boolean);
  if (filter) list = list.filter(filter);
  return list;
}

export async function body(entryOrId) {
  const e = typeof entryOrId === 'string' ? this._requests.get(entryOrId) : entryOrId;
  if (!e) return null;
  if (e.body !== undefined) return e.body;
  try {
    const { body, base64Encoded } = await this.session.send('Network.getResponseBody', { requestId: e.id });
    e.body = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  } catch { e.body = null; }
  return e.body;
}

export async function har({ withBodies = true } = {}) {
  // bodies are fetched with bounded parallelism — a sequential walk pays one
  // round-trip per entry, which dominates large captures
  const out = await mapConcurrent(this.requests(), 8, async (e) => {
    let content;
    if (withBodies && e.response && !e.failed) {
      try {
        const b = await this.session.send('Network.getResponseBody', { requestId: e.id }).catch(() => null);
        if (b) content = { text: b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body, encoding: b.base64Encoded ? 'base64' : undefined };
      } catch {}
    }
    return { e, content };
  });
  return buildHar(out);
}

/** Bytes actually transferred, grouped by resource type (needs capture on). */
export function transferred() {
  const byType = {};
  let total = 0;
  for (const r of this.requests()) {
    const n = r.encodedDataLength || 0;
    const t = r.resourceType || 'Other';
    byType[t] = (byType[t] || 0) + n;
    total += n;
  }
  return { total, byType, human: fmtBytes(total), blockedBytes: this._bytesBlocked, blocked: { ...this._blockedByType }, profile: this._bw?.name };
}

/** Requests dropped by the bandwidth profile. */
export function blockedRequests() {
  return Object.entries(this._blockedByType).map(([reason, count]) => ({ reason, count }));
}

/** Wait for a request matching url (string/regex/predicate) → request entry. */
export function waitForRequest(match, { timeout = 30000 } = {}) {
  const pred = toMatcher(match);
  return this.waitForEvent('request', { predicate: (e) => pred(e.url), timeout });
}

/**
 * Wait for a response matching url/regex/predicate. Resolves with a response object:
 *   const r = await page.waitForResponse(/checkout\/.*\/pay/);
 *   await r.json() / await r.text() / r.status / r.headers / r.entry
 */
export async function waitForResponse(match, { timeout = 30000 } = {}) {
  const pred = toMatcher(match);
  const entry = await this.waitForEvent('response', { predicate: (e) => pred(e.url), timeout });
  return asResponse(entry, this);
}

export function waitForRequestFinished(match, { timeout = 30000 } = {}) {
  const pred = toMatcher(match);
  return this.waitForEvent('requestfinished', { predicate: (e) => pred(e.url), timeout });
}
