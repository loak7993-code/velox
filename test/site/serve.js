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
