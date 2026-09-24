// velox :: accounts.js (test) — account-creation scoring, verified against the local
// risk scorer in test/site. Each signal family has a control: the thing that should be
// flagged IS flagged, and the velox-configured flow passes.
import velox from '../src/index.js';
import { startSite, siteStats } from './site/serve.js';
import { startHttpProxy } from './site/proxy.js';

const EXE = process.env.VELOX_BROWSER || process.env.VLOX_EXE;
velox.config({ navRetries: 1, retryDelay: 250 });
const site = await startSite();
const S = site.url;

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};
const soft = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`… ${name} `);
  try { const v = await fn(); process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, v === undefined || v === true || !!v); }
  catch (e) { process.stdout.write(`(${Date.now() - t}ms)\n`); check(name, false, e.message.slice(0, 170)); }
};

const b = await velox.launch({ executablePath: EXE });

/* ── 1. identity coherence ─────────────────────────────────────────────────── */
await soft('identities are internally coherent across 11 countries', async () => {
  const bad = [];
  for (const country of Object.keys(velox.identity.countries)) {
    for (let i = 0; i < 4; i++) {
      const id = velox.identity.generate({ country, seed: i * 13 + country.length });
      if (!id.coherence.ok) bad.push(`${country}: ${id.coherence.issues.map((x) => x.why).join('; ')}`);
    }
  }
  check('no contradictions generated', bad.length === 0, bad.slice(0, 2).join(' | '));
  return true;
});
await soft('coherence checks catch planted contradictions', async () => {
  const us = velox.identity.generate({ country: 'US', seed: 5 });
  const cases = [
    ['phone from another country', { phone: '+49 30 5550123' }],
    ['postal code not in the city', { address: { ...us.address, postalCode: '99999' } }],
    ['region mismatched to city', { address: { ...us.address, region: 'ZZ' } }],
    ['timezone from another country', { timezone: 'Asia/Tokyo' }],
    ['disposable email domain', { email: 'a@mailinator.com', emailDomain: 'mailinator.com' }],
    ['email unrelated to the name', { email: 'zz9q7x@example.com', emailLocal: 'zz9q7x' }],
  ];
  const caught = [];
  for (const [label, patch] of cases) {
    const res = velox.identity.check({ ...us, ...patch });
    caught.push(`${label}:${res.ok ? 'MISSED' : 'ok'}`);
  }
  check('all planted contradictions caught', caught.every((c) => c.endsWith('ok')), caught.join(' '));
  console.log('     ' + caught.join('  '));
  return true;
});
await soft('identity supplies the matching browser environment', async () => {
  const id = velox.identity.generate({ country: 'JP', seed: 9 });
  const st = velox.identity.stealth(id);
  const geo = velox.identity.geo(id);
  check('locale follows the identity', st.locale === 'ja-JP' && geo.locale === 'ja-JP', JSON.stringify(st));
  check('timezone follows the identity', st.timezone === id.timezone && geo.timezone.startsWith('Asia/Tokyo'), st.timezone);
  // apply it for real and confirm the browser agrees
  const p = await b.newPage({ stealth: st });
  await p.goto(`${S}/signup.html`, { waitUntil: 'interactive' });
  const seen = await p.eval(`({ lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })`);
  await p.close();
  check('browser language matches', seen.lang === 'ja-JP', seen.lang);
  check('browser timezone matches', seen.tz === id.timezone, seen.tz);
  return true;
});

/* ── 2. naive automation is scored and blocked (the control) ──────────────── */
await soft('naive automation is flagged by every family', async () => {
  const p = await b.newPage();                       // no stealth, no human input
  await p.goto(`${S}/signup.html`, { waitUntil: 'interactive' });
  const fill = async (sel, v) => { await p.fill(sel, v); };
  const id = velox.identity.generate({ country: 'US', seed: 11 });
  await fill('#name', 'x9f2k');                      // nonsensical name
  await fill('#email', `${id.emailLocal}@mailinator.com`);
  await fill('#phone', '+49 30 5550123');            // wrong country
  await fill('#line1', '1 Nowhere');
  await fill('#city', 'Nowhere');
  await fill('#postalCode', 'abc123');               // invalid format
  await fill('#dob', '2014-01-01');                  // underage
  await fill('#password', 'hunter2!A');
  await p.eval(`document.getElementById('tos').checked = true`);
  await p.eval(`document.getElementById('signup').requestSubmit()`);   // no click, no typing
  await p.wait(900);
  const report = await velox.readRiskReport(p);
  const blocked = await p.count('#blocked').catch(() => 0);
  await p.close();
  console.log(`     score ${report.score} · ${report.reasons.length} reasons · blocked=${blocked > 0}`);
  console.log('     ' + report.reasons.slice(0, 5).join('\n     '));
  check('score is low', report.score !== null && report.score < 35, String(report.score));
  check('multiple reason families tripped', report.reasons.length >= 6, String(report.reasons.length));
  check('fired for automation signals', report.reasons.some((r) => /automation|headless|webdriver/i.test(r)));
  check('fired for identity signals', report.reasons.some((r) => /phone does not match|disposable|under 18/i.test(r)));
  check('fired for behavioural signals', report.reasons.some((r) => /keystroke|pointer|without a click|script/i.test(r)));
  return blocked > 0;
});

/* ── 3. the configured flow passes ────────────────────────────────────────── */
let goodRecord = null;
await soft('identity + stealth + human behaviour creates the account', async () => {
  const runner = new velox.AccountRunner({ browser: b, paceMs: [0, 0] });
  const id = velox.identity.generate({ country: 'US', seed: 777 });
  goodRecord = await runner.register({
    url: `${S}/signup.html`,
    identity: id,
    expect: { selector: '#welcome' },
    steps: [
      { fill: '#name', value: '@identity.fullName' },
      { type: '#email', value: '@identity.email', cps: 6 },      // human cadence
      { type: '#phone', value: '@identity.phone', cps: 6 },
      { fill: '#line1', value: '@identity.address.line1' },
      { fill: '#city', value: '@identity.address.city' },
      { fill: '#postalCode', value: '@identity.address.postalCode' },
      { select: '#country', value: '@identity.country' },
      { fill: '#dob', value: '@identity.dob' },
      { fill: '#password', value: '@identity.password' },
      { check: '#tos' },
      { humanClick: '#submit' },
      { waitFor: '#welcome, #verify, #blocked', optional: true },
    ],
  }, { index: 0 });
  console.log(`     score ${goodRecord.risk.score} · reasons ${goodRecord.risk.reasons.length} · ok=${goodRecord.ok}`);
  check('account created', goodRecord.ok === true, goodRecord.error || JSON.stringify(goodRecord.steps.filter((s) => !s.ok)));
  check('risk score is high', goodRecord.risk.score >= 80, String(goodRecord.risk.score));
  check('no reasons raised', goodRecord.risk.reasons.length === 0, JSON.stringify(goodRecord.risk.reasons.slice(0, 3)));
  check('identity had no contradictions', (goodRecord.identityIssues || []).length === 0);
  check('signup graded every step', goodRecord.steps.length >= 8, String(goodRecord.steps.length));
  return true;
});

/* ── 4. cross-account linkage: isolation vs the same context ─────────────── */
await soft('fresh context per account avoids device linkage', async () => {
  const runner = new velox.AccountRunner({ browser: b, paceMs: [0, 0] });
  const ids = velox.identity.generateMany(2, { country: 'US', seed: 3000 });
  const mk = (id) => ({
    url: `${S}/signup.html`, identity: id, expect: { selector: '#welcome' },
    steps: [
      { fill: '#name', value: '@identity.fullName' },
      { type: '#email', value: '@identity.email', cps: 8 },
      { fill: '#phone', value: '@identity.phone' },
      { fill: '#line1', value: '@identity.address.line1' },
      { fill: '#city', value: '@identity.address.city' },
      { fill: '#postalCode', value: '@identity.address.postalCode' },
      { select: '#country', value: '@identity.country' },
      { fill: '#dob', value: '@identity.dob' },
      { fill: '#password', value: '@identity.password' },
      { check: '#tos' },
      { humanClick: '#submit' },
      { waitFor: '#welcome, #verify, #blocked', optional: true },
    ],
  });
  await velox.fetch(`${S}/api/signup-reset`);
  const r1 = await runner.register(mk(ids[0]), { index: 0 });
  const r2 = await runner.register(mk(ids[1]), { index: 1 });
  const iso = runner.verifyIsolation([r1, r2]);
  console.log(`     scores ${r1.risk.score} / ${r2.risk.score} · isolation issues: ${iso.issues.length}`);
  check('both accounts created', r1.ok && r2.ok, `${r1.error || ''} ${r2.error || ''}`);
  check('second account not flagged as duplicate device', !(r2.risk.reasons || []).some((r) => /already created an account/i.test(r)), JSON.stringify(r2.risk.reasons));
  check('isolation proof is clean', iso.ok === true, JSON.stringify(iso.issues.slice(0, 2)));
  return true;
});
await soft('reusing one context IS linkable (so the signal is real)', async () => {
  // control: two signups from the SAME context share the device cookie + fingerprint
  const ctx = await b.newContext({ stealth: true });
  const attempt = async (id) => {
    const p = await ctx.newPage();
    await p.goto(`${S}/signup.html`, { waitUntil: 'interactive' });
    await p.fill('#name', id.fullName);
    await p.fill('#email', id.email);
    await p.fill('#phone', id.phone);
    await p.fill('#line1', id.address.line1);
    await p.fill('#city', id.address.city);
    await p.fill('#postalCode', id.address.postalCode);
    await p.eval(`document.getElementById('country').value=${JSON.stringify(id.country)}`);
    await p.fill('#dob', id.dob);
    await p.fill('#password', id.password);
    await p.eval(`document.getElementById('tos').checked = true`);
    await p.eval(`document.getElementById('signup').requestSubmit()`);
    await p.wait(700);
    const rep = await velox.readRiskReport(p);
    await p.close();
    return rep;
  };
  const ids = velox.identity.generateMany(2, { country: 'US', seed: 4200 });
  const a1 = await attempt(ids[0]);
  const a2 = await attempt(ids[1]);
  await ctx.close();
  console.log(`     same-context scores ${a1.score} / ${a2.score}`);
  check('second attempt in the same context is flagged', (a2.reasons || []).some((r) => /already created an account|velocity/i.test(r)), JSON.stringify((a2.reasons || []).slice(0, 2)));
  return true;
});

/* ── 5. velocity ─────────────────────────────────────────────────────────── */
await soft('velocity control: rapid-fire trips, pacing passes', async () => {
  const runner = new velox.AccountRunner({ browser: b, paceMs: [0, 0], maxPerHour: 100 });
  const mk = (id, i) => ({
    url: `${S}/signup.html`, identity: id, expect: { selector: '#welcome' },
    steps: [
      { fill: '#name', value: '@identity.fullName' },
      { type: '#email', value: '@identity.email', cps: 10 },
      { fill: '#phone', value: '@identity.phone' },
      { fill: '#line1', value: '@identity.address.line1' },
      { fill: '#city', value: '@identity.address.city' },
      { fill: '#postalCode', value: '@identity.address.postalCode' },
      { select: '#country', value: '@identity.country' },
      { fill: '#dob', value: '@identity.dob' },
      { fill: '#password', value: '@identity.password' },
      { check: '#tos' },
      { humanClick: '#submit' },
      { waitFor: '#welcome, #verify, #blocked', optional: true },
    ],
  });
  await velox.fetch(`${S}/api/signup-reset`);            // isolate this scenario's velocity window
  const ids = velox.identity.generateMany(5, { country: 'GB', seed: 5100 });
  const rapid = [];
  for (let i = 0; i < 4; i++) rapid.push(await runner.register(mk(ids[i], i), { index: i }));   // no pacing
  const flagged = rapid.filter((r) => (r.risk.reasons || []).some((x) => /velocity/i.test(x))).length;
  console.log(`     rapid-fire scores: ${rapid.map((r) => r.risk.score).join(', ')} · velocity flags: ${flagged}`);
  check('velocity flagged on rapid fire', flagged >= 1, String(flagged));
  // paced run through the same runner honouring the pool of identities
  await velox.fetch(`${S}/api/signup-reset`);            // fresh window: this measures pacing, not the rapid run
  const pacedRunner = new velox.AccountRunner({ browser: b, paceMs: [1100, 1300], maxPerHour: 100 });
  const t0 = Date.now();
  const paced = await pacedRunner.farm(mk(ids[4], 4), { count: 2, identities: velox.identity.generateMany(2, { country: 'GB', seed: 5200 }) });
  const elapsed = Date.now() - t0;
  console.log(`     paced scores: ${paced.map((r) => r.risk.score).join(', ')} in ${elapsed}ms`);
  check('pacing inserted a real gap', elapsed > 1000, `${elapsed}ms`);
  check('paced accounts did not trip velocity', paced.every((r) => !(r.risk.reasons || []).some((x) => /velocity/i.test(x))), JSON.stringify(paced.map((r) => r.risk.reasons)));
  return true;
});

/* ── 6. behavioural regularity detector ──────────────────────────────────── */
await soft('behavioural regularity separates scripted from human input', async () => {
  const page = await b.newPage();
  await page.goto(`${S}/signup.html`, { waitUntil: 'interactive' });
  // scripted: inject perfectly regular timings
  await page.eval(`window.__vxBehaviour.keyIntervals = Array.from({length:40},()=>100); window.__vxBehaviour.moveIntervals = Array.from({length:40},()=>10); window.__vxBehaviour.downs = 1; window.__vxBehaviour.ups = 1;`);
  const scripted = await velox.behaviouralRegularity(page);
  // human: real typing through the human module
  await page.eval(`window.__vxBehaviour.keyIntervals = []; window.__vxBehaviour.moveIntervals = [];`);
  await page.human.type('#name', 'Maria Garcia');
  await page.human.moveTo(300, 220);
  await page.human.moveTo(420, 260);
  const human = await velox.behaviouralRegularity(page);
  await page.close();
  console.log(`     scripted machine-likeness ${scripted.score} · human ${human.score}`);
  check('scripted input scores as machine-like', scripted.score >= 0.7, String(scripted.score));
  check('human input does not', human.score < 0.5, String(human.score));
  check('detector reports measurements', !!human.measurements && human.measurements.keys > 5, JSON.stringify(human.measurements));
  return true;
});

/* ── 7. the runner's own reporting ───────────────────────────────────────── */
await soft('runner reports steps, scores, reasons and a summary table', async () => {
  const runner = new velox.AccountRunner({ browser: b });
  const rows = runner.summary([goodRecord]);
  const s = rows[0];
  check('summary row has the score', typeof s.score === 'number' && s.score >= 80, JSON.stringify(s));
  check('summary row has the identity', typeof s.email === 'string' && s.email.includes('@'), s.email);
  check('per-step timing recorded', goodRecord.steps.every((x) => typeof x.ms === 'number'), JSON.stringify(goodRecord.steps.slice(0, 2)));
  check('cookies captured for the record', Array.isArray(goodRecord.cookies) && goodRecord.cookies.length > 0, JSON.stringify(goodRecord.cookies));
  return true;
});


/* ── 8. fingerprint surfaces: what a site can link identities by ──────────── */
// A site does not fingerprint "the browser" — it concatenates component hashes. Two accounts
// that differ on ANY of them are two visitors; accounts that match on all of them are one.
const surfaceProbe = `(function () {
  var c = document.createElement('canvas');
  var gl = c.getContext('webgl');
  var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  var box = document.body;
  return {
    webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : String(gl && gl.getParameter(gl.RENDERER)),
    webglVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '',
    maxTexture: gl ? gl.getParameter(3379) : 0,
    maxVarying: gl ? gl.getParameter(35660) : 0,
    extFirst: gl && gl.getSupportedExtensions() ? gl.getSupportedExtensions()[0] : '',
    rect: (function () { var r = box.getBoundingClientRect(); return r.x.toFixed(3) + ',' + r.width.toFixed(3); })(),
    audio: String(typeof OfflineAudioContext === 'function'),
    screen: screen.width + 'x' + screen.height + '@' + screen.colorDepth,
    ua: navigator.userAgent,
  };
})()`;

const fingerprints = {};
// a fresh context's first navigation can resolve a tick before the new document is live,
// so wait for the document to exist before reading surfaces out of it
const probeSurfaces = async (page) => {
  for (let i = 0; i < 20; i++) {
    const ready = await page.eval('!!document.body').catch(() => false);
    if (ready) return page.eval(surfaceProbe);
    await new Promise((r) => setTimeout(r, 100));
  }
  return page.eval(surfaceProbe);
};
await soft('each identity gets its own fingerprint surfaces', async () => {
  for (const seed of [101, 202, 303, 404]) {
    const ctx = await b.newContext({ stealth: { seed } });
    const page = await ctx.newPage();
    await page.goto(`${site.url}/signup.html`, { waitUntil: 'domcontentloaded' });
    fingerprints[seed] = await probeSurfaces(page);
    // the same identity must stay itself
    await page.reload({ waitUntil: 'domcontentloaded' });
    const again = await probeSurfaces(page);
    check(`identity ${seed} is stable across reloads`, JSON.stringify(again) === JSON.stringify(fingerprints[seed]), 'surfaces changed on reload');
    await ctx.close();
  }
  const all = Object.values(fingerprints);
  const distinct = (key) => new Set(all.map((f) => f[key])).size;
  console.log(`     distinct across 4 identities: webgl=${distinct('webglRenderer')} maxTex=${distinct('maxTexture')} maxVarying=${distinct('maxVarying')} extOrder=${distinct('extFirst')} rects=${distinct('rect')}`);
  check('GPU identity varies per account', distinct('webglRenderer') >= 3, String(distinct('webglRenderer')));
  check('GPU limits vary per account', distinct('maxTexture') >= 2 || distinct('maxVarying') >= 2, `${distinct('maxTexture')}/${distinct('maxVarying')}`);
  check('extension order varies per account', distinct('extFirst') >= 2, String(distinct('extFirst')));
  check('element geometry varies per account', distinct('rect') === 4, String(distinct('rect')));
  const rasteriser = all.filter((f) => /swiftshader|llvmpipe|software/i.test(f.webglRenderer));
  check('no identity claims a software rasteriser', rasteriser.length === 0, JSON.stringify(rasteriser.map((f) => f.webglRenderer)));
  return true;
});

await b.close();
site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
