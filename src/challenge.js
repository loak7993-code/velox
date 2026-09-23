// velox :: challenge.js — bot-management awareness: detect, wait for, and (where the
// challenge is interactive) engage Cloudflare / Akamai / PerimeterX.
//
// What this does, honestly:
//   • detects which vendor is challenging you, from headers, cookies and DOM markers
//   • waits for the JS/behavioural challenge to clear (clearance cookies + DOM state)
//   • engages interactive challenges: Turnstile checkbox, PX "press & hold", interstitial
//     buttons — with human-like movement and timing
//   • retries the navigation once clearance is granted, and reports what happened
//
// What it cannot do: beat a hard block (IP reputation), solve an image CAPTCHA, or
// forge a vendor sensor payload. Those are explicitly out of scope — see the docs.

export const VENDORS = {
  cloudflare: {
    name: 'cloudflare',
    clearanceCookies: ['cf_clearance'],
    blockCookies: ['__cf_bm', 'cf_chl_'],
    signals: {
      headers: ['cf-mitigated', 'cf-ray', 'cf-cache-status'],
      dom: ['#challenge-running', '#challenge-stage', '#cf-challenge-running', '.cf-browser-verification', '#turnstile-wrapper', 'iframe[src*="challenges.cloudflare.com"]', 'script[src*="/cdn-cgi/challenge-platform/"]'],
      text: ['Just a moment', 'Checking your browser', 'Attention Required', 'Verify you are human'],
      cookies: ['cf_clearance', '__cf_bm', '__cfruid'],
    },
  },
  akamai: {
    name: 'akamai',
    clearanceCookies: ['_abck'],
    signals: {
      headers: ['x-akamai-transformed', 'akamai-grn', 'server-timing'],
      dom: ['script[src*="/akam/"]', 'script[src*="akamaihd.net"]', 'img[src*="/akam/"]'],
      text: ['Access Denied', 'Reference #'],
      cookies: ['_abck', 'bm_sz', 'ak_bmsc', 'bm_sv'],
    },
  },
  perimeterx: {
    name: 'perimeterx',
    clearanceCookies: ['_px3', '_pxhd'],
    signals: {
      headers: [],
      dom: ['#px-captcha', 'script[src*="px-cloud.net"]', 'script[src*="perimeterx.net"]', 'div[class*="px-"]'],
      text: ['press and hold', 'Press & Hold', 'Verify you are a human'],
      cookies: ['_px', '_pxhd', '_px3', '_pxvid'],
    },
  },
  datadome: {
    name: 'datadome',
    clearanceCookies: ['datadome'],
    signals: { headers: ['x-datadome'], dom: ['script[src*="datadome"]'], text: ['Please enable JS'], cookies: ['datadome'] },
  },
};

const html = (page) => page.content().catch(() => '');

/** Which vendor is challenging this page right now? */
export async function detect(page, { url } = {}) {
  const signals = [];
  let body = '';
  try { body = await html(page); } catch {}
  const title = await page.title().catch(() => '');
  const cookies = await page.cookies([url || page._url].filter(Boolean)).catch(() => []);
  const names = new Set(cookies.map((c) => c.name));
  const last = page.requests().slice(-4).map((r) => r.response?.headers || {});
  const hdr = (name) => last.some((h) => h[name] !== undefined) || page._docResponse?.headers?.[name] !== undefined;

  const found = [];
  for (const v of Object.values(VENDORS)) {
    const hits = [];
    for (const h of v.signals.headers) if (hdr(h)) hits.push(`header:${h}`);
    for (const d of v.signals.dom) if (body.includes(d)) hits.push(`dom:${d}`);
    for (const t of v.signals.text) if (title.includes(t) || body.includes(t)) hits.push(`text:${t}`);
    for (const c of v.signals.cookies) if (names.has(c)) hits.push(`cookie:${c}`);
    if (hits.length) found.push({ vendor: v.name, hits, cleared: v.clearanceCookies.some((c) => names.has(c)) });
  }
  // a clearance cookie with no other markers means we already passed
  const active = found.filter((f) => !f.cleared);
  return {
    vendor: active[0]?.vendor || found[0]?.vendor || null,
    detected: found.map((f) => f.vendor),
    signals: found.flatMap((f) => f.hits),
    cleared: found.length > 0 && found.every((f) => f.cleared),
    challenged: active.length > 0,
    cookies: cookies.map((c) => c.name),
  };
}

/** True once the vendor's clearance cookie is present (or nothing is challenging). */
export async function isCleared(page, vendor, { url } = {}) {
  const info = vendor ? VENDORS[vendor] : null;
  const cookies = await page.cookies([url || page._url].filter(Boolean)).catch(() => []);
  const names = new Set(cookies.map((c) => c.name));
  if (info) return info.clearanceCookies.some((c) => names.has(c));
  return Object.values(VENDORS).some((v) => v.clearanceCookies.some((c) => names.has(c)));
}

/**
 * Engage an interactive challenge if one is present, then wait for clearance.
 * Handles: Cloudflare Turnstile checkbox (in an iframe), PerimeterX press-and-hold,
 * and generic interstitial "verify" buttons.
 */
export async function engage(page, { human = true, vendor, timeout = 30000, poll = 400 } = {}) {
  const info = vendor ? { vendor } : await detect(page);
  const kind = info.vendor;
  const acted = [];
  const t0 = Date.now();

  const clickTurnstile = async () => {
    // the checkbox lives inside a cross-origin iframe; click its centre after a move
    const frames = page.frames ? await page.frames().catch(() => []) : [];
    for (const f of frames) {
      if (!/challenges\.cloudflare\.com|turnstile/.test(f.url || '')) continue;
      const p = await page.eval(`(function(){var f=document.querySelector('iframe[src*="challenges.cloudflare.com"]'); if(!f) return null; var r=f.getBoundingClientRect(); return {x:r.x+r.width*0.5,y:r.y+r.height*0.5}})()`);
      if (p) {
        if (human && page.human) await page.human.clickAt(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
        acted.push('turnstile-click');
        return true;
      }
    }
    // some deployments render the widget inline
    const inline = await page.$$('iframe[src*="challenges.cloudflare.com"], #turnstile-wrapper, .cf-turnstile');
    if (inline.length) {
      const p = await page.eval(`(function(){var e=document.querySelector('#turnstile-wrapper,.cf-turnstile,iframe[src*="challenges.cloudflare.com"]');if(!e)return null;var r=e.getBoundingClientRect();return{x:r.x+r.width*0.5,y:r.y+r.height*0.5}})()`);
      if (p) {
        if (human && page.human) await page.human.clickAt(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
        acted.push('turnstile-click-inline');
        return true;
      }
    }
    return false;
  };

  const pressAndHold = async () => {
    // PerimeterX: "press & hold" — hold for ~10s with jitter, then release
    const p = await page.eval(`(function(){var e=document.querySelector('#px-captcha,[class*="px-captcha"],[data-px-captcha]');if(!e)return null;var r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!p) return false;
    if (human && page.human) await page.human.moveTo(p.x, p.y);
    else await page.mouse.move(p.x, p.y);
    await page.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    const holdMs = 10500;
    const end = Date.now() + holdMs;
    while (Date.now() < end) {
      const jx = p.x + (Math.random() - 0.5) * 2.2;
      const jy = p.y + (Math.random() - 0.5) * 2.2;
      await page.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: jx, y: jy, button: 'left' });
      await new Promise((r) => setTimeout(r, 90 + Math.random() * 120));
    }
    await page.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    acted.push('px-press-hold');
    return true;
  };

  const clickVerifyButton = async () => {
    const sel = 'button:has-text("Verify"), input[type="submit"][value*="Verify"], #challenge-stage button, .cf-button';
    const hit = await page.$eval(sel, (el) => el.textContent).catch(() => null);
    if (!hit) return false;
    if (human && page.human) await page.human.click(sel);
    else await page.click(sel);
    acted.push('verify-button');
    return true;
  };

  if (kind === 'cloudflare' || kind === null) if (await clickTurnstile().catch(() => false)) {}
  if (kind === 'perimeterx') if (await pressAndHold().catch(() => false)) {}
  if (!acted.length) await clickVerifyButton().catch(() => false);

  // wait for clearance
  while (Date.now() - t0 < timeout) {
    if (await isCleared(page, kind)) return { vendor: kind, cleared: true, acted, ms: Date.now() - t0 };
    // keep nudging: some interstitials need a click after the widget loads
    if (Date.now() - t0 > 3000 && acted.length < 3) {
      if (await clickTurnstile().catch(() => false)) {}
      else if (await clickVerifyButton().catch(() => false)) {}
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  return { vendor: kind, cleared: await isCleared(page, kind), acted, ms: Date.now() - t0, timeout: true };
}

/**
 * Navigate and, if a challenge appears, wait/engage it and retry once.
 * Returns { response, challenge } so callers can see what happened.
 */
export async function goto(page, url, { timeout = 45000, waitUntil = 'interactive', retryOnClear = true, human = true, engage: doEngage = true } = {}) {
  let response = await page.goto(url, { waitUntil, timeout }).catch((e) => ({ error: e.message, url }));
  let info = await detect(page);
  if (!info.challenged && !info.vendor) return { response, challenge: info };

  // a challenge (or its remnants) is present: give the JS challenge room to run
  const t0 = Date.now();
  let outcome = { vendor: info.vendor, cleared: info.cleared, acted: [], ms: 0 };
  if (doEngage && !info.cleared) {
    outcome = await engage(page, { human, vendor: info.vendor, timeout: Math.max(5000, timeout - (Date.now() - t0)) });
  }
  if (outcome.cleared && retryOnClear) {
    // cleared → reload to get the real page
    response = await page.goto(url, { waitUntil, timeout }).catch((e) => ({ error: e.message, url }));
    info = await detect(page);
  }
  return { response, challenge: { ...info, outcome } };
}

/** One-call helper: navigate somewhere, handling challenges, returning the page. */
export async function fetchThrough(page, url, opts) {
  const { challenge } = await goto(page, url, opts);
  return { page, challenge, cleared: challenge.cleared || !challenge.challenged };
}

export function attachChallenge(page) {
  const api = {
    detect: (o) => detect(page, o),
    isCleared: (vendor, o) => isCleared(page, vendor, o),
    engage: (o) => engage(page, o),
    goto: (url, o) => goto(page, url, o),
    /** Convenience: navigate, solve if needed, and return the readable page. */
    async open(url, o) {
      const r = await goto(page, url, o);
      return { ...r, text: await page.readable().catch(() => ''), title: await page.title().catch(() => '') };
    },
  };
  page.challenge = api;
  page.gotoThroughChallenges = (url, o) => goto(page, url, o).then((r) => r.response);
  return api;
}
