// velox :: platforms.mjs — LIVE probe against real bot-management platforms.
// Prints the actual DOM shapes so detection is written against reality, not mocks.
import velox from '/tmp/opencode/velox/src/index.js';
import { startSite } from './site/serve.js';

const EXE = process.env.VELOX_BROWSER;
const local = await startSite();
const targets = [
  ['arkose (real script, public test key)', `${local.url}/arkose.html`, 9000],
  ['cloudflare turnstile (official demo)', 'https://demo.turnstile.workers.dev/', 6000],
  ['hcaptcha (official demo)', 'https://accounts.hcaptcha.com/demo', 6000],
  ['recaptcha v2 (official demo)', 'https://www.google.com/recaptcha/api2/demo', 6000],
];

const b = await velox.launch({ executablePath: EXE });
const p = await b.newPage({ stealth: true });

for (const [label, url, waitMs] of targets) {
  console.log(`\n═══ ${label}\n    ${url}`);
  try {
    const nav = await p.goto(url, { waitUntil: 'interactive', timeout: 45000 });
    await p.wait(waitMs);
    const probe = await p.eval(`(function(){
      const sel = '[id*="captcha"],[class*="captcha"],[id^="turnstile"],[class*="turnstile"],[id^="g-recaptcha"],[id^="hcaptcha"],[id^="arkose"],[id^="px-"],[data-pkey],[data-sitekey],iframe';
      const nodes = [...document.querySelectorAll(sel)].slice(0, 25).map(e => ({
        tag: e.tagName.toLowerCase(), id: e.id || null, cls: (e.className && String(e.className).slice(0,60)) || null,
        src: e.src ? e.src.slice(0, 150) : null, sitekey: e.getAttribute && (e.getAttribute('data-sitekey') || e.getAttribute('data-pkey')) || null,
        w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height),
      }));
      const scripts = [...document.scripts].map(s => s.src).filter(s => /arkose|turnstile|recaptcha|hcaptcha|cloudflare|waf|px-cloud|datadome/i.test(s)).slice(0,6);
      return { nodes, scripts, inputs: [...document.querySelectorAll('input,textarea')].map(i => i.name || i.id).filter(n => /captcha|token|turnstile|g-recaptcha|fc-|px|waf/i.test(n)) };
    })()`);
    console.log('    scripts:', JSON.stringify(probe.scripts));
    for (const n of probe.nodes) console.log(`    node: <${n.tag}> id=${n.id} cls=${n.cls} ${n.w}x${n.h} key=${n.sitekey} src=${n.src ? n.src.slice(0, 110) : ''}`);
    console.log('    token inputs:', JSON.stringify(probe.inputs));
    const det = await p.detectChallenge();
    console.log('    → detectChallenge():', JSON.stringify(det));
  } catch (e) {
    console.log('    ✗ error:', e.message.slice(0, 140));
  }
}

// third-party verdicts on the environment itself
for (const [label, url, waitMs] of [
  ['sannysoft bot detector', 'https://bot.sannysoft.com/', 7000],
  ['creepjs fingerprint', 'https://abrahamjuliot.github.io/creepjs/', 9000],
  ['pixelscan consistency', 'https://pixelscan.net/', 11000],
]) {
  console.log(`\n═══ ${label}\n    ${url}`);
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.wait(waitMs);
    const verdict = await p.eval(`(function(){
      const text = document.body ? document.body.innerText : '';
      const failed = [...document.querySelectorAll('td,span,div')].filter(e => /^failed$/i.test((e.textContent||'').trim())).length;
      const passed = [...document.querySelectorAll('td,span,div')].filter(e => /^passed$/i.test((e.textContent||'').trim())).length;
      const trust = (text.match(/(trust score|bot score|score)\\D{0,12}(\\d{1,3})/i) || [])[0] || null;
      const flagged = (text.match(/(you are (a )?(bot|human)|headless|detected|consistent|inconsistent)[^\\n]{0,60}/gi) || []).slice(0, 5);
      return { title: document.title, failed, passed, trust, flagged, len: text.length };
    })()`);
    console.log('    ', JSON.stringify(verdict).slice(0, 400));
  } catch (e) {
    console.log('    ✗ error:', e.message.slice(0, 140));
  }
}

await b.close();
local.server.close();
process.exit(0);
