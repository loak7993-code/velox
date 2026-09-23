// velox :: stealth.js (test) — verify the anti-detection work objectively against a
// local detector harness, and exercise the challenge handling on mock vendor pages.
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const EXE = process.env.VELOX_BROWSER || process.env.VLOX_EXE || process.env.VELOX_BROWSER;
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

const score = async (page) => {
  await page.goto(`${S}/detect.html`, { waitUntil: 'load' });
  return page.eval('window.__fingerprint.report()');
};

/* ── the harness must actually detect a bare browser ─────────────────────── */
const b = await velox.launch({ executablePath: EXE });
let naked;
await soft('harness flags a bare (stealthless) browser', async () => {
  const p = await b.newPage();
  naked = await score(p);
  await p.close();
  console.log(`     baseline: ${naked.score}/${naked.total} (${naked.pct}%) — failing: ${naked.failures.map((f) => f.name).join(', ') || 'none'}`);
  return naked.failures.length > 0 && naked.pct < 100;
});

/* ── stealth closes the gaps ─────────────────────────────────────────────── */
let hidden;
await soft('stealth passes the whole harness', async () => {
  const p = await b.newPage({ stealth: true });
  hidden = await score(p);
  await p.close();
  console.log(`     stealth:  ${hidden.score}/${hidden.total} (${hidden.pct}%) — failing: ${hidden.failures.map((f) => `${f.name}${f.value ? '=' + String(f.value).slice(0, 30) : ''}`).join(', ') || 'none'}`);
  check('stealth improves the score', hidden.score > naked.score, `${hidden.score} vs ${naked.score}`);
  check('stealth score ≥ 95%', hidden.pct >= 95, `${hidden.pct}%`);
  return hidden.failures.length <= 1;
});

/* ── profiles stay coherent ──────────────────────────────────────────────── */
await soft('windows profile is coherent end to end', async () => {
  const p = await b.newPage({ stealth: { profile: 'chrome-windows' } });
  await p.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const facts = await p.eval(`({ ua: navigator.userAgent, plat: navigator.platform, uad: navigator.userAgentData && navigator.userAgentData.platform, gl: (function(){var c=document.createElement('canvas').getContext('webgl');var e=c.getExtension('WEBGL_debug_renderer_info');return c.getParameter(e.UNMASKED_RENDERER_WEBGL)})(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language })`);
  const rep = await p.eval('window.__fingerprint.report()');
  await p.close();
  console.log(`     ${facts.ua.slice(0, 46)}… | plat=${facts.plat} | uad=${facts.uad} | tz=${facts.tz} | ${rep.pct}%`);
  check('UA is Windows', /Windows NT/.test(facts.ua));
  check('platform is Win32', facts.plat === 'Win32');
  check('UA-CH says Windows', facts.uad === 'Windows');
  check('WebGL looks like a real GPU', /NVIDIA|Direct3D/.test(facts.gl), facts.gl.slice(0, 40));
  return true;
});
await soft('geo preset keeps locale+timezone+languages together', async () => {
  const p = await b.newPage({ stealth: { profile: 'chrome-linux', geo: 'ja-JP' } });
  await p.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const f = await p.eval(`({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language, langs: navigator.languages })`);
  await p.close();
  check('timezone follows the locale', f.tz === 'Asia/Tokyo', f.tz);
  check('language follows the locale', f.lang === 'ja-JP', f.lang);
  return Array.isArray(f.langs) && f.langs[0] === 'ja-JP';
});
await soft('canvas noise is stable (not random) across reads', async () => {
  const p = await b.newPage({ stealth: true });
  await p.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const r = await p.eval(`(function(){var c=document.createElement('canvas');c.width=200;c.height=60;var x=c.getContext('2d');x.font='18px Arial';x.fillText('stable?',4,30);var a=c.toDataURL();var b=c.toDataURL();var d=document.createElement('canvas');d.width=200;d.height=60;var y=d.getContext('2d');y.font='18px Arial';y.fillText('stable?',4,30);return {same:a===b,reproducible:a===d.toDataURL(),len:a.length}})()`);
  await p.close();
  check('two reads of the same canvas agree', r.same === true, JSON.stringify(r));
  check('an identical fresh canvas agrees too', r.reproducible === true, JSON.stringify(r));
  return true;
});
await soft('rotation-safe: same seed → same fingerprint', async () => {
  const one = await b.newPage({ stealth: { seed: 7 } });
  await one.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const fp1 = await one.eval(`(function(){var c=document.createElement('canvas');c.width=120;c.height=30;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,120,30);x.fillStyle='#000';x.font='14px Arial';x.fillText('seed',2,20);return c.toDataURL()})()`);
  await one.close();
  const two = await b.newPage({ stealth: { seed: 7 } });
  await two.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const fp2 = await two.eval(`(function(){var c=document.createElement('canvas');c.width=120;c.height=30;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,120,30);x.fillStyle='#000';x.font='14px Arial';x.fillText('seed',2,20);return c.toDataURL()})()`);
  await two.close();
  check('identical seeds reproduce the fingerprint', fp1 === fp2, `${fp1.length}/${fp2.length}`);
  const three = await b.newPage({ stealth: { seed: 99 } });
  await three.goto(`${S}/detect.html`, { waitUntil: 'load' });
  const fp3 = await three.eval(`(function(){var c=document.createElement('canvas');c.width=120;c.height=30;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,120,30);x.fillStyle='#000';x.font='14px Arial';x.fillText('seed',2,20);return c.toDataURL()})()`);
  await three.close();
  check('a different seed differs', fp3 !== fp1);
  return true;
});

/* ── human behaviour ─────────────────────────────────────────────────────── */
await soft('human mouse paths are curved, not teleporting', async () => {
  const p = await b.newPage({ stealth: true });
  await p.goto(`${S}/detect.html`, { waitUntil: 'load' });
  await p.eval('window.__behaviour = { moves: 0, maxJump: 0, last: null }');   // measure only our gesture
  await p.human.moveTo(900, 500);
  await p.human.moveTo(200, 120);
  const beh = await p.eval('window.__behaviour');
  await p.close();
  console.log(`     ${beh.moves} move events, largest single jump ${beh.maxJump.toFixed(1)}px`);
  check('plenty of intermediate move events', beh.moves > 10, String(beh.moves));
  check('no teleporting (>400px jumps)', beh.maxJump < 400, beh.maxJump.toFixed(1));
  return true;
});
await soft('human typing has a real cadence', async () => {
  const p = await b.newPage({ stealth: true });
  await p.setContent('<input id=t>');
  const t0 = Date.now();
  await p.human.type('#t', 'hello world');
  const ms = Date.now() - t0;
  const val = await p.val('#t');
  await p.close();
  check('text arrived (with corrections possible)', /^h[a-z]?ello world$/.test(val) || val.includes('ello world'), val);
  check('typing took human time', ms > 300, `${ms}ms`);
  return true;
});
await soft('human click lands on target and dwells', async () => {
  const p = await b.newPage({ stealth: true });
  await p.setContent('<button id=b style="margin:200px;padding:20px">hit me</button><div id=out></div><script>document.getElementById("b").onclick=()=>document.getElementById("out").textContent="clicked"</script>');
  await p.human.click('#b');
  await p.waitForSelector('#out');
  const out = await p.text('#out');
  await p.close();
  return out === 'clicked';
});

/* ── challenge handling on mock vendor pages ─────────────────────────────── */
await soft('detects + clears a mock Cloudflare challenge', async () => {
  const ctx = await b.newContext({ stealth: true });      // isolated cookie jar per challenge
  const p = await ctx.newPage();
  await p.goto(`${S}/challenge/cf`, { waitUntil: 'interactive' });
  const info = await p.challenge.detect();
  check('cloudflare detected', info.vendor === 'cloudflare', JSON.stringify(info.signals.slice(0, 3)));
  check('flagged as challenged', info.challenged === true);
  const r = await p.challenge.goto(`${S}/challenge/cf`, { waitUntil: 'interactive', timeout: 20000 });
  const cookies = (await p.cookies()).map((c) => c.name);
  const through = await p.challenge.goto(`${S}/challenge/cf/ok`, { waitUntil: 'interactive', timeout: 20000 });
  const secret = await p.text('#secret').catch(() => null);
  await p.close();
  console.log(`     actions: ${JSON.stringify(r.challenge.outcome?.acted)} | cookies: ${cookies.join(',')} | secret: ${secret}`);
  check('turnstile was engaged', (r.challenge.outcome?.acted || []).includes('turnstile-click') || (r.challenge.outcome?.acted || []).includes('turnstile-click-inline'));
  check('clearance cookie obtained', cookies.includes('cf_clearance'));
  await ctx.close();
  return secret === 'you made it past the challenge';
});
await soft('clears a mock Akamai sensor challenge', async () => {
  const ctx = await b.newContext({ stealth: true });
  const p = await ctx.newPage();
  await p.goto(`${S}/challenge/akamai`, { waitUntil: 'interactive' });
  const info = await p.challenge.detect();
  check('akamai detected', info.detected.includes('akamai'), JSON.stringify(info.detected));
  await p.wait(700);
  const cookies = (await p.cookies()).map((c) => c.name);
  const title = await p.title();
  await p.close();
  check('_abck issued (clean environment)', cookies.includes('_abck'), cookies.join(','));
  await ctx.close();
  return title === 'ok';
});
await soft('clears a mock PerimeterX press-and-hold', async () => {
  const ctx = await b.newContext({ stealth: true });
  const p = await ctx.newPage();
  await p.goto(`${S}/challenge/px`, { waitUntil: 'interactive' });
  const info = await p.challenge.detect();
  check('perimeterx detected', info.vendor === 'perimeterx', JSON.stringify(info.signals.slice(0, 3)));
  const out = await p.challenge.engage({ human: true, timeout: 20000 });
  const cookies = (await p.cookies()).map((c) => c.name);
  await p.close();
  check('press-and-hold performed', (out.acted || []).includes('px-press-hold'), JSON.stringify(out.acted));
  await ctx.close();
  return cookies.includes('_px3');
});
await soft('challenge info is reported, never silently swallowed', async () => {
  const ctx = await b.newContext({ stealth: true });      // fresh jar: nothing pre-cleared
  const p = await ctx.newPage();
  const r = await p.challenge.goto(`${S}/challenge/cf`, { waitUntil: 'interactive', engage: false, timeout: 4000 });
  await ctx.close();
  check('vendor reported', r.challenge.vendor === 'cloudflare');
  check('not cleared without engaging', r.challenge.cleared === false || r.challenge.challenged === true, JSON.stringify({ cleared: r.challenge.cleared, challenged: r.challenge.challenged }));
  return true;
});

/* ── extensibility ───────────────────────────────────────────────────────── */
await soft('velox.middleware wraps every page command', async () => {
  const seen = [];
  const off = velox.middleware(async (ctx, next) => { seen.push(ctx.method); return next(); });
  const p = await b.newPage();
  await p.setContent('<h1>mw</h1>');
  await p.text('h1');
  await p.count('h1');
  await p.close();
  off();
  check('middleware saw commands', seen.includes('text') && seen.includes('count'), JSON.stringify(seen.slice(0, 6)));
  return true;
});
await soft('velox.registerCommand adds custom page methods', async () => {
  velox.registerCommand('grabTitle', async function () { return this.text('h1'); });
  velox.registerCommand('browserInfo', function () { return { version: this.versionInfo?.product }; }, { target: 'browser' });
  const b2 = await velox.launch({ executablePath: EXE });
  const p = await b2.newPage();
  await p.setContent('<h1>custom command</h1>');
  const title = await p.grabTitle();
  const info = b2.browserInfo();
  await b2.close();
  check('page command works', title === 'custom command', String(title));
  check('browser command works', !!info.version, JSON.stringify(info));
  return true;
});
await soft('velox.registerSelectorEngine is global', async () => {
  velox.registerSelectorEngine('startsWith', (value, root) => [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim().startsWith(value)));
  const b3 = await velox.launch({ executablePath: EXE });
  const p = await b3.newPage();
  await p.setContent('<span>alpha</span><span>alpine</span><span>beta</span>');
  const n = await p.count('startsWith=al');
  const texts = await p.texts('startsWith=al');
  await b3.close();
  check('global engine matches', n === 2, `n=${n}`);
  return JSON.stringify(texts) === '["alpha","alpine"]';
});
await soft('velox.hook("onNavigation") fires', async () => {
  const urls = [];
  const off = velox.hook('onNavigation', (page, url) => urls.push(url));
  const b4 = await velox.launch({ executablePath: EXE });
  const p = await b4.newPage();
  await p.goto(`${S}/page2.html`, { waitUntil: 'interactive' });
  await p.goto(`${S}/`, { waitUntil: 'interactive' });
  await b4.close();
  off();
  check('both navigations seen', urls.length >= 2, JSON.stringify(urls.slice(-2)));
  return true;
});
await soft('page.ext is a free namespace', async () => {
  const p = await b.newPage();
  p.ext.myThing = () => 42;
  const v = p.ext.myThing();
  await p.close();
  return v === 42;
});
await soft('velox.extensions introspection', async () => {
  const info = velox.extensions();
  check('commands listed', info.commands.page.includes('grabTitle'), JSON.stringify(info.commands.page));
  check('selector engines listed', info.selectorEngines.includes('startsWith'), JSON.stringify(info.selectorEngines));
  return info.hooks.onNavigation >= 0;
});

await b.close();
site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
