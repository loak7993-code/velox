// velox :: test/ipfighter.js — LIVE suite against a real bot-detection + fingerprint site.
//
// Answers the question "what happens when a website fingerprints the browser?" with their
// own numbers instead of ours: the score they assign, and which fingerprint components
// differ between two identities (components that match across accounts are what link them).
//
//   npm run ipfighter        (network required; skips cleanly when offline)
import velox from '../src/index.js';

const DETECT = 'https://ipfighter.com/bot-detection';
const FINGERPRINT = 'https://ipfighter.com/browser-fingerprint';
const SHELL = process.env.VELOX_BROWSER || process.env.VLOX_EXE;
const FULL = process.env.VELOX_FULL_BROWSER || '/usr/bin/chromium-browser';

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};

try {
  const head = await fetch(DETECT, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
  if (head.status >= 500) throw new Error('status ' + head.status);
} catch (e) {
  console.log(`no network egress to ${DETECT} (${e.message}) — live suite skipped`);
  process.exit(0);
}

/* ── 1. the score they assign, against a genuine browser as the control ───── */
const READ_SCORE = `(function () {
  var val = document.querySelector('#bd-score-val');
  var lab = document.querySelector('#bd-score-label');
  var banner = document.querySelector('.bd-banner');
  var rows = [].slice.call(document.querySelectorAll('.bd-check'));
  var fails = rows.map(function (row) {
    var l = row.querySelector('.bd-check-label');
    var d = row.querySelector('.bd-check-detail');
    var m = (row.className || '').match(/bd-check--(\\w+)/);
    return { name: l ? l.textContent.trim() : '?', detail: d ? d.textContent.trim().slice(0, 28) : '', state: m ? m[1] : '?' };
  });
  return {
    score: val ? parseInt(val.textContent, 10) : null,
    label: lab ? lab.textContent.trim() : null,
    banner: banner ? banner.textContent.replace(/\\s+/g, ' ').trim().slice(0, 70) : null,
    passCount: fails.filter(function (f) { return f.state === 'pass'; }).length,
    total: fails.length,
    fails: fails.filter(function (f) { return f.state === 'fail'; }).map(function (f) { return f.name + ' → ' + f.detail; }),
  };
})()`;

const scoreOf = async (exe, opts, label) => {
  const b = await velox.launch({ executablePath: exe });
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  try {
    await p.goto(DETECT, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.wait(7000);
    const r = await p.eval(READ_SCORE);
    console.log(`  ${label}: ${r.score}% ${r.label} · ${r.passCount}/${r.total} checks pass · ${r.banner}`);
    for (const f of r.fails) console.log(`      fail: ${f}`);
    return r;
  } finally { await b.close(); }
};

console.log('── bot-detection scores');
const bare = await scoreOf(SHELL, {}, 'no stealth        ');
const hidden = await scoreOf(SHELL, { stealth: true }, 'velox stealth     ');
const clean = (await import('node:fs')).existsSync(FULL) ? await scoreOf(FULL, {}, 'clean chromium    ') : null;

check('stealth raises the pass count', hidden.passCount > bare.passCount, `${hidden.passCount} vs ${bare.passCount}`);
check('stealth leaves no failing automation check',
  !hidden.fails.some((f) => /webdriver|selenium|cypress|phantom|nightmare|cefsharp|getter|getter integrity/i.test(f)),
  hidden.fails.join(' | '));
if (clean) {
  // their score is confidence that the visitor is human: higher is better
  // (velox 98% = 1 suspicious signal, a genuine clean Chromium 90% = 5)
  check('velox scores at least as human as a genuine browser', hidden.score >= clean.score, `${hidden.score}% vs clean ${clean.score}%`);
  check('velox flags no more checks than a genuine browser', hidden.fails.length <= clean.fails.length,
    `${hidden.fails.length} vs ${clean.fails.length}`);
  // a clean browser has no chrome.runtime on a normal page: if their heuristic wants one,
  // that check is a false positive we inherit by being browser-accurate
  const inherited = hidden.fails.filter((f) => clean.fails.includes(f));
  console.log(`     remaining flags a genuine browser also gets: ${inherited.length ? inherited.join('; ') : 'none'}`);
}

/* ── 2. which fingerprint components link two identities together ─────────── */
console.log('\n── fingerprint components (per identity)');
const READ_COMPONENTS = `(function () {
  var out = {};
  document.querySelectorAll('span[id]').forEach(function (s) {
    var v = (s.textContent || '').trim();
    if (/^-?[0-9a-f]{6,64}$/i.test(v)) out[s.id] = v;
  });
  return out;
})()`;

const b = await velox.launch({ executablePath: SHELL });
const ids = {};
for (const seed of [1111, 2222]) {
  const ctx = await b.newContext({ stealth: { seed } });
  const p = await ctx.newPage();
  await p.goto(FINGERPRINT, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.wait(9000);
  ids[seed] = await p.eval(READ_COMPONENTS);
  await ctx.close();
}
await b.close();

const components = ['Canvas', 'WebGL', 'Audio', 'ClientRects', 'Fonts'];
const rotates = components.filter((k) => ids[1111][k] && ids[2222][k] && ids[1111][k] !== ids[2222][k]);
const shared = components.filter((k) => ids[1111][k] && ids[2222][k] && ids[1111][k] === ids[2222][k]);
console.log(`  ${rotates.length}/${components.length} components differ between identities: ${rotates.join(', ') || 'none'}`);
if (shared.length) console.log(`  shared (linkable): ${shared.join(', ')}`);
for (const k of components) console.log(`     ${k.padEnd(12)} ${ids[1111][k] || '—'}   ${ids[2222][k] || '—'}`);

check('canvas fingerprint rotates per identity', rotates.includes('Canvas'), `shared: ${shared.join(',')}`);
check('rendered WebGL image rotates per identity', rotates.includes('WebGL'), `shared: ${shared.join(',')}`);
check('audio fingerprint rotates per identity', rotates.includes('Audio'), `shared: ${shared.join(',')}`);
check('element geometry rotates per identity', rotates.includes('ClientRects'), `shared: ${shared.join(',')}`);

const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed  (live)`);
process.exit(fails.length ? 1 : 0);
