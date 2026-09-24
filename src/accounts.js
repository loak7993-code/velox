// velox :: accounts.js — run account-creation flows for onboarding/fraud-control testing.
//
// What decides a signup score (and therefore what this runner controls):
//   1. fingerprint coherence   → stealth profile per identity (stealth 2.0)
//   2. identity-data coherence → velox.identity (generated + validated)
//   3. behavioural regularity  → human typing/mouse (velox.human), not synthetic cadence
//   4. cross-account linkage   → a FRESH context (cookies/storage/fingerprint seed) per account
//   5. velocity                → pacing between attempts, per-exit rotation
//
// The runner executes a declarative plan per identity, records what the target said about
// the attempt (score / verification / block markers found in responses), and proves the
// isolation between accounts so runs can't be linked by accident.
import { generateIdentity, generateIdentities, identityStealth, identityGeo, checkIdentity, DISPOSABLE_EMAIL_DOMAINS } from './identity.js';
import { sleep, randInt } from './util.js';

/** Resolve `@identity.email` / `@run.index` style references inside a plan. */
function resolve(value, ctx) {
  if (typeof value !== 'string' || !value.startsWith('@')) return value;
  const path = value.slice(1).split('.');
  let cur = { identity: ctx.identity, run: ctx.run, step: ctx.step };
  for (const p of path) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
const resolveDeep = (v, ctx) => (typeof v === 'string' ? resolve(v, ctx) : v);

const RISK_KEY = /(risk|score|trust|fraud|abuse|blocked|denied|challenge|verification|captcha|review|suspend|limited)/i;

/**
 * Pull whatever the target revealed about the attempt: the score it computed (response
 * body or `x-risk-*` headers), its reasons, the status, and any verification demand.
 * Knowing the score and the reasons is the whole point — that is what tells you which
 * signal to fix, instead of guessing.
 */
export async function readRiskReport(page, { urlFilter = /signup|register|account|create|onboard|verify|auth|graphql|api/i, maxBodies = 6 } = {}) {
  const report = { score: null, reasons: [], status: null, markers: [], url: null, ok: null, verificationRequired: null, bodies: 0 };
  for (const entry of page.requests()) {
    if (!entry.response || !urlFilter.test(entry.url)) continue;
    const h = entry.response.headers || {};
    for (const [k, v] of Object.entries(h)) {
      if (/^x-(risk|fraud|abuse|trust|score|bot)/i.test(k)) report.markers.push(`${k}: ${v}`);
    }
    if (![200, 201, 202].includes(entry.response.status)) report.status = entry.response.status;
    if (report.bodies >= maxBodies) continue;
    if (!/json/.test(String(h['content-type'] || ''))) continue;
    report.bodies++;
    const body = await page.body(entry).catch(() => null);
    if (!body) continue;
    try {
      const j = JSON.parse(body);
      if (typeof j.score === 'number' && report.score == null) { report.score = j.score; report.url = entry.url; }
      if (!report.reasons.length && Array.isArray(j.reasons)) report.reasons = j.reasons.slice(0, 20);
      if (j.ok !== undefined && report.ok == null) report.ok = j.ok;
      if (j.verificationRequired !== undefined) report.verificationRequired = j.verificationRequired;
    } catch { /* not JSON, skip */ }
  }
  return report;
}

export class AccountRunner {
  /**
   * @param opts.browser        a launched browser (all accounts share the process, not the context)
   * @param opts.launch         launch options used when no browser is given
   * @param opts.pool           optional ProxyPool: one exit per account
   * @param opts.contextOpts    extra context options for every account
   * @param opts.paceMs         [min,max] pause between accounts (velocity control)
   * @param opts.maxPerHour     hard cap on accounts per rolling hour
   * @param opts.onEvent        (event, payload) progress hook
   */
  constructor(opts = {}) {
    this.opts = { paceMs: [900, 2600], maxPerHour: 12, keepPages: false, ...opts };
    this.browser = opts.browser || null;
    this.records = [];
    this._startedAt = [];
    this.onEvent = opts.onEvent || (() => {});
  }

  async _ensureBrowser() {
    if (this.browser) return this.browser;
    const { Browser } = await import('./cdp/browser.js');
    this.browser = await Browser.launch(this.opts.launch || {});
    this._ownsBrowser = true;
    return this.browser;
  }

  /** Rolling-hour throttle: returns how long to wait before the next account. */
  _velocityDelay() {
    const now = Date.now();
    this._startedAt = this._startedAt.filter((t) => now - t < 3600_000);
    if (this._startedAt.length < this.opts.maxPerHour) return 0;
    return this._startedAt[0] + 3600_000 - now;
  }

  /**
   * Run one account-creation attempt.
   * @param plan.url        signup page
   * @param plan.steps      declarative steps (see docs; `{ call }` for custom logic)
   * @param plan.identity   an identity object, or generation options
   * @param plan.expect     { selector } or { text } that proves success
   */
  async register(plan, { index = 0, proxy } = {}) {
    const browser = await this._ensureBrowser();
    const identity = plan.identity && plan.identity.email ? plan.identity : generateIdentity(plan.identity || {});
    const ctxOpts = {
      ...(this.opts.contextOpts || {}),
      stealth: identityStealth(identity, plan.stealth || {}),
      ...(proxy ? { proxy: typeof proxy.toProxy === 'function' ? proxy.toProxy() : proxy } : {}),
    };
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    const record = {
      index, identity, url: plan.url, steps: [], ok: false, signals: [], error: null,
      startedAt: new Date().toISOString(), proxy: ctxOpts.proxy?.server || null,
      fingerprintSeed: identity.device?.seed ?? null,
      extracted: {},
    };
    const ctx = { identity, run: { index }, page, context, record, sleep };

    this.onEvent('account:start', { index, email: identity.email, country: identity.country });
    try {
      if (identity.coherence && !identity.coherence.ok) {
        record.identityIssues = identity.coherence.issues;
        this.onEvent('account:identity-issues', { index, issues: identity.coherence.issues });
      }
      if (plan.url) {
        const t0 = Date.now();
        await page.goto(plan.url, { waitUntil: plan.waitUntil || 'interactive', timeout: plan.timeout || 45000 });
        record.steps.push({ step: 'goto', ok: true, ms: Date.now() - t0 });
      }
      // warm the session like a person arriving at a landing page
      if (plan.warmup !== false && page.human) {
        await page.human.warmup(typeof plan.warmup === 'object' ? plan.warmup : { mouse: 2, scroll: 1, dwellMs: 600 });
        record.steps.push({ step: 'warmup', ok: true, ms: 0 });
      }
      for (const raw of plan.steps || []) {
        const step = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolveDeep(v, ctx)]));
        const t0 = Date.now();
        try {
          await this._runStep(page, step, ctx);
          record.steps.push({ step: Object.keys(step)[0], ok: true, ms: Date.now() - t0 });
          this.onEvent('account:step', { index, step: Object.keys(step)[0], ms: Date.now() - t0 });
        } catch (e) {
          record.steps.push({ step: Object.keys(step)[0], ok: false, ms: Date.now() - t0, error: e.message.slice(0, 200) });
          if (step.optional) { this.onEvent('account:step-skipped', { index, step: Object.keys(step)[0], error: e.message }); continue; }
          throw e;
        }
      }
      record.risk = await readRiskReport(page, plan.riskFilter ? { urlFilter: plan.riskFilter } : {});
      record.signals = record.risk.markers.map((m) => ({ kind: 'header', value: m }))
        .concat(record.risk.status ? [{ kind: 'status', value: record.risk.status }] : []);
      // success evidence
      const expect = plan.expect || {};
      if (expect.selector) record.ok = await page.count(expect.selector).then((n) => n > 0).catch(() => false);
      else if (expect.text) record.ok = await page.readable().then((t) => t.includes(expect.text)).catch(() => false);
      else if (expect.check) record.ok = !!(await expect.check(ctx));
      else record.ok = true;
      // what the target said, if it said anything structured
      for (const step of (plan.steps || [])) {
        if (step.extract) {
          const key = step.as || step.extract;
          record.extracted[key] = await page.text(step.extract).catch(() => null);
        }
      }
      record.cookies = (await page.cookies().catch(() => [])).map((c) => `${c.name}@${c.domain}=${String(c.value).slice(0, 24)}`).sort();
      record.localStorageKeys = Object.keys((await page.localStorage().catch(() => ({ local: {} }))).local || {}).sort();
      record.ua = await page.eval('navigator.userAgent').catch(() => null);
    } catch (e) {
      record.error = e.message.slice(0, 300);
      this.onEvent('account:error', { index, error: record.error });
    } finally {
      record.finishedAt = new Date().toISOString();
      record.ms = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
      if (this.opts.keepPages) record.page = page;
      else await context.close().catch(() => {});
      if (proxy && this.opts.pool) this.opts.pool.release(proxy, { ok: record.ok });
    }
    this.records.push(record);
    this.onEvent('account:done', { index, ok: record.ok, email: identity.email, ms: record.ms });
    return record;
  }

  async _runStep(page, step, ctx) {
    if (step.goto) return page.goto(step.goto, { waitUntil: step.waitUntil || 'interactive', timeout: step.timeout || 45000 });
    if (step.waitFor) return page.waitForSelector(step.waitFor, { timeout: step.timeout || 15000 });
    if (step.waitForText) return page.waitForFunction(`document.body && document.body.innerText.includes(${JSON.stringify(step.waitForText)})`, { timeout: step.timeout || 15000 });
    if (step.waitForCaptchaToken !== undefined) return page.waitForCaptchaToken(step.waitForCaptchaToken || undefined, { timeout: step.timeout || 60000 });
    if (step.waitMs) return sleep(step.waitMs);
    if (step.fill !== undefined) return page.fill(step.fill, step.value ?? '', { timeout: step.timeout });
    if (step.type !== undefined) return page.human ? page.human.type(step.fill || step.type, step.value ?? '', { cps: step.cps }) : page.type(step.type, step.value ?? '', { human: true });
    if (step.humanClick !== undefined) return page.human ? page.human.click(step.humanClick) : page.click(step.humanClick);
    if (step.click !== undefined) return page.click(step.click, { timeout: step.timeout || 10000, inPage: !!step.inPage });
    if (step.check !== undefined) return page.locator(step.check).check();
    if (step.select !== undefined) return page.locator(step.select).selectOption(step.value);
    if (step.press !== undefined) return page.press(step.press, {});
    if (step.scroll !== undefined) return page.human ? page.human.scroll({ by: step.scroll }) : page.scrollBy(0, step.scroll);
    if (step.waitForResponse !== undefined) return page.waitForResponse(step.waitForResponse, { timeout: step.timeout || 30000 });
    if (step.assert !== undefined) { const v = await step.assert(ctx); if (!v) throw new Error(`assertion failed: ${step.name || 'assert'}`); return v; }
    if (step.extract !== undefined) { ctx.record.extracted[step.as || step.extract] = await page.text(step.extract); return; }
    if (step.call !== undefined) return step.call(ctx);
    throw new Error(`unknown step: ${JSON.stringify(step).slice(0, 80)}`);
  }

  /** Rotate identities × proxies through one plan, with pacing and a velocity cap. */
  async farm(plan, { count = 1, concurrency = 1, identities, pace } = {}) {
    await this._ensureBrowser();
    const ids = identities || generateIdentities(count, plan.identity || {});
    const paceMs = pace || this.opts.paceMs;
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= ids.length) return;
        const wait = this._velocityDelay();
        if (wait > 0) { this.onEvent('account:throttled', { wait }); await sleep(wait); }
        if (i > 0 || concurrency > 1) await sleep(randInt(paceMs[0], paceMs[1]));
        this._startedAt.push(Date.now());
        const proxy = plan.proxy || (this.opts.pool ? this.opts.pool.next() : null);
        results[i] = await this.register({ ...plan, identity: ids[i] }, { index: i, proxy });
      }
    });
    await Promise.all(workers);
    this.onEvent('farm:done', { count: results.length });
    return results;
  }

  /**
   * Prove that accounts are not linkable: no shared cookies, storage keys, UA or
   * fingerprint seed between records (beyond what the site itself sets per account).
   */
  verifyIsolation(records = this.records) {
    const issues = [];
    const notes = [];
    const seen = { cookie: new Map(), ls: new Map(), ua: new Map(), seed: new Map(), device: new Map() };
    for (const rec of records) {
      for (const c of rec.cookies || []) {
        // record cookies as name@domain=value: two accounts legitimately receive the same
        // cookie NAME from the site; linkage is the same VALUE (a shared device id)
        const key = c;
        if (seen.cookie.has(key) && seen.cookie.get(key) !== rec.index) issues.push({ kind: 'shared-cookie-value', value: c, accounts: [seen.cookie.get(key), rec.index] });
        else seen.cookie.set(key, rec.index);
      }
      for (const k of rec.localStorageKeys || []) {
        if (seen.ls.has(k) && seen.ls.get(k) !== rec.index) issues.push({ kind: 'shared-localStorage', value: k, accounts: [seen.ls.get(k), rec.index] });
        else seen.ls.set(k, rec.index);
      }
      // an identical UA string is NOT linkage (millions of machines share one) — it is
      // reported as a note; linkage is a shared seed or a shared cookie VALUE
      if (rec.ua) {
        const h = rec.ua.replace(/\s+/g, '');
        if (seen.ua.has(h) && seen.ua.get(h) !== rec.index) notes.push({ kind: 'same-ua', value: rec.ua.slice(0, 40), accounts: [seen.ua.get(h), rec.index] });
        else seen.ua.set(h, rec.index);
      }
      if (rec.fingerprintSeed != null) {
        if (seen.seed.has(rec.fingerprintSeed) && seen.seed.get(rec.fingerprintSeed) !== rec.index) issues.push({ kind: 'identical-fingerprint-seed', value: rec.fingerprintSeed, accounts: [seen.seed.get(rec.fingerprintSeed), rec.index] });
        else seen.seed.set(rec.fingerprintSeed, rec.index);
      }
    }
    return { ok: issues.length === 0, issues, notes, accounts: records.length };
  }

  /** One-row-per-account summary for eyeballing a run. */
  summary(records = this.records) {
    return records.map((r) => ({
      '#': r.index, email: r.identity?.email, country: r.identity?.country, ok: r.ok,
      score: r.risk?.score ?? null, reasons: (r.risk?.reasons || []).length,
      verification: r.risk?.verificationRequired ?? null,
      ms: r.ms, proxy: r.proxy, error: r.error,
      identityIssues: (r.identityIssues || []).length,
    }));
  }

  async close() {
    if (this._ownsBrowser && this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
  }
}

/* ─────────────────────────── scoring-signal toolkit ─────────────────────────── */

/**
 * Behavioural regularity: uniform intervals across keystrokes/mouse moves are the
 * signature of synthetic input. Returns a 0..1 "machine-likeness" score plus the
 * measurements, so a run can be judged instead of guessed.
 */
export async function behaviouralRegularity(page) {
  const data = await page.eval(`(function(){
    const d = window.__vxBehaviour;
    if (!d) return null;
    const stdev = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
    const keys = d.keyIntervals || [], moves = d.moveIntervals || [];
    const uniq = (a) => new Set(a.map((x) => Math.round(x / 5))).size;
    return {
      keys: keys.length, moves: moves.length,
      keyStdev: stdev(keys), keyMean: keys.length ? keys.reduce((a, b) => a + b, 0) / keys.length : 0,
      moveStdev: stdev(moves), uniqKeyBuckets: uniq(keys), uniqMoveBuckets: uniq(moves),
    };
  })()`).catch(() => null);
  if (!data) return { score: null, reason: 'no behaviour recorder installed on the page' };
  // machine-like: near-zero variance, or everything falling into very few timing buckets
  let score = 0;
  if (data.keys >= 5) {
    const cv = data.keyMean ? data.keyStdev / data.keyMean : 0;
    if (cv < 0.08) score += 0.5;                                  // metronome typing
    if (data.uniqKeyBuckets <= Math.max(2, data.keys / 8)) score += 0.3;
  }
  if (data.moves >= 5 && data.moveStdev < 1.5) score += 0.2;
  return { score: Math.min(1, score), measurements: data };
}

export function attachAccountRunner(velox, opts) { return new AccountRunner(opts); }
export { generateIdentity, generateIdentities, identityStealth, identityGeo, checkIdentity, DISPOSABLE_EMAIL_DOMAINS };
