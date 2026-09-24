// velox :: test site v2 — endpoints for the playwright-parity suite
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export const siteStats = { conditional: 0, notModified: 0 };
const etagOf = (buf) => '"' + createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';

const DIR = new URL('.', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css', '.bin': 'application/octet-stream' };

export function createSite() {
  return http.createServer((req, res) => {
    const path = req.url.split('?')[0];

    if (path === '/api/data.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ hello: 'world' })); }
    if (path === '/api/pixel.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"px":1}'); }
    // resets the connection on the first hit, then succeeds — exercises retry logic
    if (path === '/flaky-reset') { globalThis.__flaky = 0; res.writeHead(200); return res.end('reset'); }
    if (path === '/flaky') {
      globalThis.__flaky = (globalThis.__flaky || 0) + 1;
      if (globalThis.__flaky === 1) return void req.socket.destroy();
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><head><title>Flaky</title></head><body><h1 id="flaky">recovered</h1></body></html>');
    }
    if (path === '/api/delay') {
      const ms = Math.min(2000, Number(new URL(req.url, 'http://x').searchParams.get('ms') || 0));
      return void setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }, ms);
    }
    if (path === '/big.bin') {
      const size = Math.min(20 << 20, Number(new URL(req.url, 'http://x').searchParams.get('mb') || 2) << 20);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size });
      return res.end(Buffer.alloc(size, 9));
    }
    if (path === '/heavy.html') {
      const n = 120;
      const port = req.socket.localPort;
      const body = '<!doctype html><html><head><title>Heavy Page</title></head><body><h1 id="heavy">heavy</h1>'
        + Array.from({ length: n }, (_, i) => `<img src="/res/${i}.bin" alt="r${i}">`).join('')
        + `<link rel="stylesheet" href="/res/style.css">`
        + `<img src="//localhost:${port}/res/3rdparty.bin" alt="third">`
        + '<script src="/res/js.js"></script>'
        + '<script>fetch("/api/data.json")</script></body></html>';
      res.writeHead(200, { 'content-type': 'text/html', etag: etagOf(Buffer.from(body)) });
      return res.end(body);
    }
    if (path.startsWith('/res/')) {
      const isJs = path.endsWith('.js'), isCss = path.endsWith('.css');
      const payload = isJs ? 'window.__heavy=true' : isCss ? '.x{color:#123456}'.repeat(40) : Buffer.alloc(4096, 3);
      res.writeHead(200, { 'content-type': isJs ? 'text/javascript' : isCss ? 'text/css' : 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(payload);
    }
    if (path === '/api/echo' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ got: body, ct: req.headers['content-type'] || '' })); });
      return;
    }
    if (path === '/setcookie') { res.writeHead(200, { 'set-cookie': 'fromserver=yes; Path=/; Max-Age=3600', 'content-type': 'text/html' }); return res.end('<html><body>cookie set</body></html>'); }
    if (path === '/auth.html') {
      const auth = req.headers.authorization;
      if (!auth || auth !== 'Basic ' + Buffer.from('user:pass').toString('base64')) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' });
        return res.end('auth required');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body><h1 id="authed">Authenticated!</h1></body></html>');
    }
    if (path === '/csp.html') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'" });
      return res.end('<html><head><title>CSP Page</title></head><body><div id="csp-target">static</div></body></html>');
    }
    if (path === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end("self.addEventListener('install', (e) => self.skipWaiting()); self.addEventListener('fetch', () => {});");
    }
    if (path === '/download.bin') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="payload.bin"' });
      return res.end(Buffer.alloc(2048, 7));
    }
    if (path === '/drag.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><body>
        <style>#dropzone{width:200px;height:100px;border:2px solid #333;margin-top:20px}</style>
        <div id="draggable" draggable="true">Drag me</div>
        <div id="dropzone">Drop here</div>
        <div id="drag-result">none</div>
        <script>
          var d = document.getElementById('draggable');
          d.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', 'payload'); });
          var z = document.getElementById('dropzone');
          z.addEventListener('dragover', function (e) { e.preventDefault(); });
          z.addEventListener('drop', function (e) {
            e.preventDefault();
            document.getElementById('drag-result').textContent = 'dropped:' + e.dataTransfer.getData('text/plain');
          });
          // mouse-based alternative (HTML5 DnD needs native events)
          z.addEventListener('mouseup', function () { document.getElementById('drag-result').textContent = 'dropped:mouse'; });
        </script></body></html>`);
    }
    if (path === '/clock.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><body>
        <div id="clock">unpatched</div>
        <div id="timer">pending</div>
        <script>
          function render() { document.getElementById('clock').textContent = new Date().toISOString(); }
          render(); setInterval(render, 500);
          setTimeout(function () { document.getElementById('timer').textContent = 'fired'; }, 30000);
        </script></body></html>`);
    }
    // ── signup risk scorer: implements the signal families real engines use ──
    // (fingerprint coherence · identity-data coherence · behavioural regularity ·
    //  device/IP linkage · velocity). Lets velox's account tooling be verified offline.
    if (path === '/api/signup-reset') { globalThis.__signups = { devices: new Map(), recent: [], emails: new Set(), postal: new Map() }; res.writeHead(200); return res.end('reset'); }
    if (path === '/api/signup' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let p = {};
        try { p = JSON.parse(body); } catch {}
        const f = p.form || {}, d = p.device || {}, b = p.behaviour || {};
        const reasons = [];
        let score = 100;

        // ── fingerprint coherence ──
        if (d.webdriver !== null && d.webdriver !== undefined) { reasons.push('automation: navigator.webdriver present'); score -= 25; }
        if (d.headless) { reasons.push('automation: headless user agent'); score -= 25; }
        if (!d.plugins) { reasons.push('fingerprint: no plugins (stripped browser)'); score -= 10; }
        if (!d.chrome) { reasons.push('fingerprint: window.chrome missing'); score -= 10; }
        if (d.gl && /swiftshader|llvmpipe|software|mesa/i.test(String(d.gl.renderer))) { reasons.push('fingerprint: software WebGL renderer'); score -= 20; }
        if (!d.userAgentData) { reasons.push('fingerprint: no userAgentData (UA/CH mismatch)'); score -= 8; }
        if (d.ua && d.userAgentData === 'Windows' && !/Windows NT/.test(d.ua)) { reasons.push('fingerprint: UA says non-Windows but Client Hints say Windows'); score -= 15; }
        if (d.storage === false) { reasons.push('fingerprint: storage blocked'); score -= 5; }

        // ── identity-data coherence ──
        const phones = { US: /^\+1[\s-]/, GB: /^\+44/, DE: /^\+49/, FR: /^\+33/, BR: /^\+55/, IN: /^\+91/, JP: /^\+81/, ES: /^\+34/, NL: /^\+31/, PL: /^\+48/, ID: /^\+62/ };
        if (f.country && phones[f.country] && !phones[f.country].test(String(f.phone || '').trim())) { reasons.push('identity: phone does not match the selected country'); score -= 20; }
        if (f.country === 'US' && !/^\d{5}(-\d{4})?$/.test(String(f.postalCode || ''))) { reasons.push('identity: US postal code format invalid'); score -= 12; }
        if (f.country === 'GB' && !/^[A-Z]{1,2}\d/.test(String(f.postalCode || '').toUpperCase())) { reasons.push('identity: UK postcode format invalid'); score -= 12; }
        if (f.country === 'DE' && !/^\d{5}$/.test(String(f.postalCode || ''))) { reasons.push('identity: German PLZ must be 5 digits'); score -= 12; }
        if (!f.dob) { reasons.push('identity: no date of birth'); score -= 8; }
        else {
          const age = (Date.now() - Date.parse(f.dob)) / 31557600000;
          if (age < 18) { reasons.push('identity: under 18'); score -= 25; }
          else if (age > 95) { reasons.push('identity: implausible age'); score -= 15; }
        }
        const local = String(f.email || '').split('@')[0].toLowerCase();
        const nameBits = String(f.name || '').toLowerCase().split(/\s+/).map((x) => x.replace(/[^a-z]/g, '')).filter(Boolean);
        if (local && nameBits.length && !nameBits.some((n) => n && (local.includes(n) || n.includes(local.slice(0, 4))))) { reasons.push('identity: email local-part unrelated to the name'); score -= 10; }
        if (/mailinator|guerrillamail|10minutemail|tempmail|yopmail|trashmail/i.test(String(f.email || ''))) { reasons.push('identity: disposable email domain'); score -= 25; }
        if (!f.tos) { reasons.push('identity: terms not accepted'); score -= 5; }

        // ── behavioural regularity ──
        const ki = b.keyIntervals || [], mi = b.moveIntervals || [];
        const stdev = (a) => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
        const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const uniq = (a) => new Set(a.map((x) => Math.round(x / 5))).size;
        if (ki.length < 5) { reasons.push('behaviour: almost no keystroke timing (filled by script)'); score -= 25; }
        else if (mean(ki) > 0 && stdev(ki) / mean(ki) < 0.08) { reasons.push('behaviour: metronomic typing (constant interval)'); score -= 25; }
        if (mi.length < 5) { reasons.push('behaviour: no pointer movement'); score -= 15; }
        else if (stdev(mi) < 1.5) { reasons.push('behaviour: perfectly regular pointer movement'); score -= 10; }
        if ((b.downs || 0) === 0 || (b.ups || 0) === 0) { reasons.push('behaviour: form submitted without a click'); score -= 10; }
        if (b.firstInputMs != null && b.firstInputMs < 250) { reasons.push('behaviour: typed within 250ms of load'); score -= 12; }
        if ((b.paste || 0) > 0) { reasons.push('behaviour: paste into the form'); score -= 8; }

        // ── device linkage + velocity ──
        globalThis.__signups = globalThis.__signups || { devices: new Map(), recent: [], emails: new Set(), postal: new Map() };
        const S = globalThis.__signups;
        const deviceKey = [d.ua, d.canvas, d.gl && d.gl.renderer, d.screen && d.screen.join('x'), d.timezone].join('|');
        const deviceHash = createHash('sha1').update(deviceKey).digest('hex').slice(0, 12);
        if (S.devices.has(deviceHash)) { reasons.push('linkage: this device fingerprint already created an account'); score -= 30; }
        S.devices.set(deviceHash, (S.devices.get(deviceHash) || 0) + 1);
        if (S.emails.has(String(f.email).toLowerCase())) { reasons.push('linkage: email already used'); score -= 20; }
        S.emails.add(String(f.email).toLowerCase());
        // velocity per exit (IP), like a real engine: same fingerprint OR same IP too fast
        const now = Date.now();
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').toString();
        S.recent = S.recent.filter((e) => now - e.t < 60000 && e.ip === ip);
        const perDevice = S.recent.filter((e) => e.device === deviceHash).length;
        S.recent.push({ t: now, ip, device: deviceHash });
        if (S.recent.length > 3) { reasons.push(`velocity: ${S.recent.length} signups from this exit in the last minute`); score -= 20; }
        else if (perDevice > 2) { reasons.push(`velocity: this device created ${perDevice + 1} accounts in the last minute`); score -= 20; }
        const addrKey = [f.line1, f.postalCode].join('|');
        if (S.postal.has(addrKey)) { reasons.push('linkage: address already used by another account'); score -= 15; }
        S.postal.set(addrKey, (S.postal.get(addrKey) || 0) + 1);

        score = Math.max(0, Math.min(100, score));
        const ok = score >= 60;
        const verificationRequired = score >= 35 && score < 60;
        const out = { ok, score, verificationRequired, reasons, deviceHash };
        const headers = {
          'content-type': 'application/json',
          'x-risk-score': String(score),
          'x-risk-reasons': String(reasons.length),
          ...(ok ? { 'set-cookie': [`sid=${Math.random().toString(36).slice(2)}; Path=/`, `device_id=${deviceHash}; Path=/; Max-Age=86400`] } : {}),
        };
        res.writeHead(ok ? 201 : verificationRequired ? 202 : 403, headers);
        res.end(JSON.stringify(out));
      });
      return;
    }

    // ── mock bot-management challenges (local, deterministic) ────────────────
    // Cloudflare-like: JS challenge that inspects the environment, then a fake
    // Turnstile widget whose checkbox must be clicked before the clearance cookie lands
    if (path === '/challenge/cf') {
      const body = `<!doctype html><html><head><title>Just a moment...</title></head><body>
        <h1>Checking your browser before accessing the site.</h1>
        <div id="challenge-running">Verifying you are human. This may take a few seconds.</div>
        <div id="turnstile-wrapper" style="width:300px;height:65px;border:1px solid #ccc;margin-top:20px;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <span id="ts-label">Verify you are human</span>
        </div>
        <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
        <script>
          // "sensor" checks a real challenge performs before issuing clearance
          window._cf_chl_opt = { cvId: '3', cZone: 'mock' };
          const webdriver = navigator.webdriver;
          const headless = /HeadlessChrome/.test(navigator.userAgent);
          const noPlugins = !navigator.plugins || navigator.plugins.length === 0;
          const badGl = (() => { try { const c=document.createElement('canvas').getContext('webgl'); const e=c.getExtension('WEBGL_debug_renderer_info'); return /swiftshader|llvmpipe/i.test(c.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch(e){ return true; } })();
          const clean = webdriver === undefined && !headless && !noPlugins && !badGl;
          window.__cf_state = { webdriver, headless, noPlugins, badGl, clean };
          let clicked = false;
          document.getElementById('turnstile-wrapper').addEventListener('click', () => {
            clicked = true;
            document.getElementById('ts-label').textContent = 'Verifying…';
            setTimeout(() => {
              if (clean || clicked) {
                document.cookie = 'cf_clearance=mock-clearance-' + Date.now() + '; path=/; max-age=3600';
                document.getElementById('challenge-running').textContent = 'Success. Redirecting…';
              } else {
                document.getElementById('challenge-running').textContent = 'Verification failed.';
              }
            }, 400);
          });
        </script></body></html>`;
      res.writeHead(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge', 'cf-ray': 'mock-ray-1' });
      return res.end(body);
    }
    if (path === '/challenge/cf/ok') {
      // the "real" page, served only once clearance is present
      const ok = /cf_clearance=/.test(req.headers.cookie || '');
      res.writeHead(ok ? 200 : 403, { 'content-type': 'text/html' });
      return res.end(ok ? '<html><head><title>Protected content</title></head><body><h1 id="secret">you made it past the challenge</h1></body></html>'
                        : '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">nope</div></body></html>');
    }
    // Akamai-like: sensor script sets _abck only for a plausible environment
    if (path === '/challenge/akamai') {
      const body = `<!doctype html><html><head><title>Access Denied</title></head><body>
        <h1>Access Denied</h1><p>Reference #18.mock</p>
        <script src="/akam/13/mock"></script>
        <script>
          const ok = navigator.webdriver === undefined && !!window.chrome && navigator.plugins.length > 0;
          if (ok) { document.cookie = '_abck=mock~-1~-1~-1; path=/; max-age=3600'; document.title = 'ok'; }
          else { document.cookie = '_abck=mock~0~-1~-1; path=/'; }
        </script></body></html>`;
      res.writeHead(200, { 'content-type': 'text/html', 'server': 'AkamaiGHost' });
      return res.end(body);
    }
    // PerimeterX-like: press & hold captcha, then _px3
    if (path === '/challenge/px') {
      const body = `<!doctype html><html><head><title>Verify you are a human</title></head><body>
        <div id="px-captcha" style="width:320px;height:120px;background:#eee;display:flex;align-items:center;justify-content:center">Press &amp; Hold</div>
        <script src="/mock/px-cloud/client.js"></script>
        <script>
          const el = document.getElementById('px-captcha');
          let downAt = 0;
          el.addEventListener('mousedown', () => { downAt = Date.now(); });
          el.addEventListener('mouseup', () => {
            const held = Date.now() - downAt;
            document.title = 'held:' + held;
            if (held > 1500) { document.cookie = '_px3=mock-px3; path=/; max-age=3600'; document.title = 'ok:' + held; }
          });
        </script></body></html>`;
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(body);
    }
    if (path === '/workers.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><body>
        <div id="w-out">none</div>
        <script>
          try {
            var w = new Worker('/worker.js');
            w.onmessage = function (e) { document.getElementById('w-out').textContent = 'worker:' + e.data; };
            w.postMessage('ping');
          } catch (e) { document.getElementById('w-out').textContent = 'no worker'; }
        </script></body></html>`);
    }
    if (path === '/worker.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end("self.onmessage = function(e){ postMessage(e.data + '-pong') };");
    }
    if (path === '/aria.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><head><title>ARIA Test</title></head><body>
        <nav aria-label="main"><a href="/">Home</a></nav>
        <h1>Form test</h1>
        <form>
          <label for="email">Email address</label>
          <input id="email" placeholder="you@example.com" />
          <button type="button" id="subscribe">Subscribe</button>
        </form>
        <img src="/logo.svg" alt="Velox logo" />
        <div id="role-out">none</div>
        <script>
          document.getElementById('subscribe').addEventListener('click', function () {
            document.getElementById('role-out').textContent = 'clicked:' + document.getElementById('email').value;
          });
        </script></body></html>`);
    }
    if (path === '/spa.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body><div id="app"></div><script src="/spa.js"></script></body></html>');
    }
    if (path === '/spa.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`setTimeout(()=>{document.getElementById('app').innerHTML='<h1>Rendered by JS</h1><p id="js-done">spa content ready</p>'},400);`);
    }
    if (path === '/slow.html') {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><h1>slow page</h1></body></html>'); }, 1500);
      return;
    }
    if (path === '/redirect.html') { res.writeHead(302, { location: '/page2.html' }); return res.end(); }

    const file = path === '/' ? '/index.html' : path;
    try {
      const body = readFileSync(join(DIR, file.slice(1)));
      const etag = etagOf(body);
      if (req.headers['if-none-match']) {
        siteStats.conditional++;
        if (req.headers['if-none-match'] === etag) {
          siteStats.notModified++;
          res.writeHead(304, { etag });
          return res.end();
        }
      }
      if (req.headers['if-modified-since']) siteStats.conditional++;
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', etag, 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('nope');
    }
  });
}

export function startSite() {
  return new Promise((resolve) => {
    const server = createSite();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('serve.js')) {
  const { url } = await startSite();
  console.log('test site on', url);
}
