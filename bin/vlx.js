#!/usr/bin/env node
// vlx — the velox CLI
import velox from '../src/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , cmd, ...rest] = process.argv;

function parse(args) {
  const out = { _: [], headers: {}, cookies: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--js') out.js = true;
    else if (a === '--full') out.full = true;
    else if (a === '--fast') out.fast = true;
    else if (a === '--stealth') out.stealth = true;
    else if (a === '--ads') out.ads = true;
    else if (a === '--headed') out.headless = false;
    else if (a === '--json') out.json = true;
    else if (a === '--html') out.html = true;
    else if (a === '--raw') out.raw = true;
    else if (a === '--md' || a === '--markdown') out.md = true;
    else if (a.startsWith('--engine=') || a.startsWith('--browser=') || a.startsWith('--device=') || a.startsWith('--ua=') || a.startsWith('--locale=') || a.startsWith('--tz=') || a.startsWith('--proxy=') || a.startsWith('--timeout=') || a.startsWith('--out=') || a.startsWith('--wait=') || a.startsWith('--sel=') || a.startsWith('--recipe=') || a.startsWith('--viewport=') || a.startsWith('--format=') || a.startsWith('--cookie-jar=') || a.startsWith('--load-session=')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v;
    } else if (a === '-o' || a === '--out') out.out = args[++i];
    else if (a === '--sel' || a === '--wait' || a === '--recipe' || a === '--engine' || a === '--browser' || a === '--device' || a === '--ua' || a === '--proxy' || a === '--timeout' || a === '--viewport' || a === '--format' || a === '--load-session') out[a.slice(2)] = args[++i];
    else if (a === '--header') { const [k, v] = (args[++i] || '').split(/:(.*)/); out.headers[(k || '').trim()] = (v || '').trim(); }
    else if (a === '--proxy-auth') { const [u, p] = (args[++i] || '').split(':'); out.proxyAuth = { username: u, password: p || '' }; }
    else if (a === '--retries' || a === '--config' || a === '--bandwidth' || a === '--max-bytes' || a === '--cache-dir' || a === '--cache-ttl') out[a.slice(2).replace(/-([a-z])/g, (m, ch) => ch.toUpperCase())] = args[++i];
    else if (a === '--cookie') out.cookies.push(args[++i]);
    else if (a.startsWith('-')) { /* ignore */ }
    else out._.push(a);
  }
  return out;
}

const flags0 = parse(rest);
if (flags0.config) process.env.VELOX_CONFIG = flags0.config;
const die = (msg) => { console.error(msg); process.exit(1); };
const engines = new Set(['auto', 'lite', 'cdp']);

async function openOpts(flags) {
  const exe = process.env.VELOX_BROWSER;
  return {
    engine: flags.js ? 'cdp' : (flags.engine && engines.has(flags.engine) ? flags.engine : 'auto'),
    executablePath: exe || undefined,
    stealth: flags.stealth, ads: flags.ads,
    headless: flags.headless !== false,
    ua: flags.ua, device: flags.device, locale: flags.locale, timezone: flags.tz,
    proxy: flags.proxy ? { server: flags.proxy, ...(flags.proxyAuth || {}) } : undefined,
    retries: flags.retries ? +flags.retries : undefined,
    bandwidth: flags.bandwidth ? (/^\d+$/.test(flags.bandwidth) ? { maxBytes: +flags.bandwidth } : flags.bandwidth) : (flags.maxBytes ? { maxBytes: +flags.maxBytes } : undefined),
    headers: Object.keys(flags.headers).length ? flags.headers : undefined,
    timeout: flags.timeout ? +flags.timeout : undefined,
  };
}

const HELP = `vlx — velox CLI. Browser automation at terminal velocity.

Usage: vlx <command> [url] [options]

Commands:
  detect                       list Chromium-family browsers found on this machine
  open   <url>                 open a URL (auto engine: no browser unless JS needed) and print readable text
  read   <url>                 alias of open
  shot   <url>                 screenshot → out.png        (--full for full page, --sel for element)
  pdf    <url>                 save page as PDF
  links  <url>                 list all links (--json)
  scrape <url>                 structured scrape (--recipe text|links|images|tables|meta|jsonld|all)
  eval   <url> <expr>          evaluate JS in the page and print the result
  cookies <url>                print cookies seen while loading the page
  bench  <url>                 time lite vs browser on the same URL
  check-proxy <proxy>          verify a proxy: status, latency, exit IP (--url, --ip, --json)
  save-session <url> <file>    capture cookies + web storage to a JSON file
  load-session <url> <file>    open URL with a saved session restored first

Options:
  --engine auto|lite|cdp       force engine (default auto)
  --js                         force the browser engine
  --browser <path|name>        which browser to use (default: any found / $VELOX_BROWSER)
  --stealth                    apply anti-fingerprint patches
  --ads                        block known ad/tracker domains
  --device <name>              emulate device (iphone_15, pixel_8, ipad, desktop...)
  --ua, --locale, --tz         overrides
  --proxy <server>             proxy server (http://, https://, socks5://; creds inline or --proxy-auth)
  --proxy-auth user:pass       proxy credentials (alternative to inline creds)
  --retries <n>                retry transient failures n times
  --bandwidth full|lean|minimal|text-only   block resources you don't need (see README)
  --max-bytes <n>              abort response bodies larger than n bytes
  --cache-dir <dir>            keep a conditional-GET cache (ETag/304) between runs
  --cache-ttl <ms>             serve cached pages without revalidating for this long
  --config <file>              load defaults from a JSON config file
  --header "K: V"              extra request header (repeatable)
  --cookie "a=b"               set cookie (repeatable)
  --viewport WxH               browser viewport (default 1280x720)
  --wait <selector>            wait for selector before acting (browser engine)
  --timeout <ms>               overall timeout (default 20000)
  --full / --sel <s> / --fast  screenshot options
  --json / --html / --raw / --md   output format for open
  -o, --out <file>             output file
  --headed                     show the browser window`;

switch (cmd) {
  case undefined:
  case 'help':
  case '--help':
    console.log(HELP);
    break;

  case 'detect': {
    const found = velox.detect();
    if (!found.length) console.log('no Chromium-family browsers found — set VELOX_BROWSER or install any of: Chrome, Chromium, Edge, Brave, Vivaldi, Opera');
    else found.forEach((b) => console.log(`${b.name.padEnd(28)} ${b.path}`));
    break;
  }

  case 'open':
  case 'read': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx open <url>');
    const cache = flags.cacheDir || flags.bandwidth ? velox.createCache({ dir: flags.cacheDir, ttl: flags.cacheTtl ? +flags.cacheTtl : 0 }) : null;
    const s = await velox.open(url, { ...(await openOpts(flags)), ...(cache ? { cache } : {}) }).catch((e) => die(e.message));
    if (cache && flags.json) console.error(`cache: ${JSON.stringify(cache.stats)}`);
    if (process.env.VLX_DEBUG) {
      console.error('[dbg] engine:', s.engine, '| url:', s.url, '| exe:', process.env.VELOX_BROWSER || 'auto');
      console.error('[dbg] title:', await s.title().catch((e) => 'ERR ' + e.message));
    }
    if (flags.cookies.length) { const u = new URL(s.url); await s.setCookies?.(flags.cookies.map((c) => { const [name, value] = c.split('='); return { name, value, url: u.origin }; })).catch(() => {}); }
    const sel = flags.sel;
    if (flags.json) console.log(JSON.stringify(sel ? await s.extract(sel) : { url: s.url, status: s.status, engine: s.engine, title: await s.title(), meta: await s.meta() }, null, 2));
    else if (flags.html) console.log(await s.html());
    else if (flags.raw) console.log(String(await s.html()));
    else if (sel) console.log((await s.extract(sel)).map((e) => e.text ?? JSON.stringify(e)).join('\n'));
    else console.log(`# ${(await s.title()) || s.url}\n\n${await s.readable()}`);
    if (!flags.quiet) {
      const bw = s.raw?.transferred?.();
      if (bw) console.error(`[bandwidth] profile=${bw.profile} transferred=${bw.human} blocked=${Object.values(bw.blocked || {}).reduce((a, b) => a + b, 0)} reqs`);
      else if (cache) console.error(`[bandwidth] cached=${cache.stats.revalidated} saved=${velox.fmtBytes(cache.stats.bytesSaved)}`);
    }
    await s.close?.().catch(() => {});
    break;
  }

  case 'shot': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx shot <url>');
    const out = flags.out || 'shot.png';
    const s = await velox.open(url, { ...(await openOpts(flags)), engine: flags.engine === 'lite' ? 'auto' : 'cdp' }).catch((e) => die(e.message));
    if (flags.viewport) { const [w, h] = flags.viewport.split('x').map(Number); await s.raw.setViewport(w, h); }
    if (flags.wait) await s.waitForSelector(flags.wait, { timeout: flags.timeout ? +flags.timeout : 10000 }).catch(() => {});
    const buf = await s.screenshot({ path: out, full: !!flags.full, ...(flags.sel ? { selector: flags.sel } : {}), ...(flags.fast ? { fast: true } : {}) });
    if (s.engine === 'cdp') await s.close().catch(() => {});
    console.log(`${out}  ${(buf.length / 1024).toFixed(1)} KB`);
    break;
  }

  case 'pdf': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx pdf <url>');
    const out = flags.out || 'page.pdf';
    const s = await velox.open(url, { ...(await openOpts(flags)), engine: 'cdp' }).catch((e) => die(e.message));
    const buf = await s.pdf({ path: out, format: flags.format || 'A4' });
    await s.close().catch(() => {});
    console.log(`${out}  ${(buf.length / 1024).toFixed(1)} KB`);
    break;
  }

  case 'links': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx links <url>');
    const s = await velox.open(url, await openOpts(flags)).catch((e) => die(e.message));
    const links = await s.links();
    if (flags.json) console.log(JSON.stringify(links, null, 2));
    else links.forEach((l) => console.log(`${(l.text || '').trim().slice(0, 60).padEnd(62)} ${l.href}`));
    if (s.engine === 'cdp') await s.close().catch(() => {});
    break;
  }

  case 'scrape': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx scrape <url> [--recipe all|links|images|text|tables|meta|jsonld]');
    const data = await velox.scrape(url, { recipe: flags.recipe || 'all', ...(await openOpts(flags)) }).catch((e) => die(e.message));
    console.log(JSON.stringify(data, null, 2));
    break;
  }

  case 'eval': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx eval <url> <expression>');
    const expr = flags._[1] || die('missing expression');
    const s = await velox.open(url, { ...(await openOpts(flags)), engine: 'cdp' }).catch((e) => die(e.message));
    const val = await s.eval(expr);
    console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
    await s.close().catch(() => {});
    break;
  }

  case 'cookies': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx cookies <url>');
    const s = await velox.open(url, await openOpts(flags)).catch((e) => die(e.message));
    const cookies = await s.cookies();
    console.log(JSON.stringify(cookies, null, 2));
    if (s.engine === 'cdp') await s.close().catch(() => {});
    break;
  }

  case 'save-session': {
    const flags = parse(rest);
    const [url, file] = flags._;
    if (!url || !file) die('usage: vlx save-session <url> <file>');
    const s = await velox.open(url, { ...(await openOpts(flags)), engine: 'cdp' }).catch((e) => die(e.message));
    const data = await s.saveSession(file);
    console.log(`saved ${data.cookies.length} cookies + storage keys → ${file}`);
    await s.close().catch(() => {});
    break;
  }

  case 'load-session': {
    const flags = parse(rest);
    const [url, file] = flags._;
    if (!url || !file) die('usage: vlx load-session <url> <file>');
    const b = await velox.launch({ executablePath: process.env.VELOX_BROWSER, headless: flags.headless !== false }).catch((e) => die(e.message));
    const p = await b.newPage({ stealth: flags.stealth, ads: flags.ads });
    await p.loadSession(file);
    const nav = await p.goto(url, { waitUntil: flags.wait === 'load' ? 'load' : 'interactive' });
    console.log(`status ${nav.status}  title: ${await p.title()}`);
    await b.close();
    break;
  }

  case 'check-proxy': case 'proxy-check': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx check-proxy <proxy-url-or-host:port> [--url <target>] [--json]');
    const { checkProxy } = await import('../src/proxy.js');
    const target = flags.url || 'https://example.com';
    const r = await checkProxy(url, { url: target, ipUrl: flags.ip || undefined, timeout: flags.timeout ? +flags.timeout : 20000 });
    if (flags.json) console.log(JSON.stringify(r, null, 2));
    else console.log(`${r.ok ? '✓ alive' : '✗ dead'}  ${r.proxy}\n  status ${r.status}  ${r.ms}ms${r.ip ? `  exit ip ${r.ip}` : ''}${r.error ? `\n  ${r.error}` : ''}`);
    process.exit(r.ok ? 0 : 1);
  }

  case 'bench': {
    const flags = parse(rest);
    const url = flags._[0] || die('usage: vlx bench <url>');
    let t0 = Date.now();
    const lite = await velox.fetch(url, { headers: flags.headers }).then(() => Date.now() - t0, (e) => `error: ${e.message}`);
    t0 = Date.now();
    const b = await velox.launch({ executablePath: process.env.VELOX_BROWSER }).catch((e) => die(e.message));
    const launchMs = Date.now() - t0;
    t0 = Date.now();
    const p = await b.newPage();
    await p.goto(url, { waitUntil: 'interactive' });
    const cdpMs = Date.now() - t0;
    await p.title();
    await b.close();
    console.log(`lite fetch:      ${lite}ms`);
    console.log(`browser launch:  ${launchMs}ms`);
    console.log(`browser goto:    ${cdpMs}ms`);
    break;
  }

  default:
    die(`unknown command "${cmd}" — try: vlx help`);
}
