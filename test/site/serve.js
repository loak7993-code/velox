// velox :: test site static server (tiny, from scratch). Auto-picks a free port.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };

export function createSite() {
  return http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/data.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ hello: 'world' }));
    }
    if (path === '/api/pixel.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"px":1}');
    }
    if (path === '/slow.html') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><h1>slow page</h1></body></html>');
      }, 1500);
      return;
    }
    if (path === '/redirect.html') { res.writeHead(302, { location: '/page2.html' }); return res.end(); }
    if (path === '/spa.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body><div id="app"></div><script src="/spa.js"></script></body></html>');
    }
    if (path === '/spa.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`setTimeout(()=>{document.getElementById('app').innerHTML='<h1>Rendered by JS</h1><p id="js-done">spa content ready</p>'},400);`);
    }
    const file = path === '/' ? '/index.html' : path;
    try {
      const body = readFileSync(join(DIR, file.slice(1)));
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
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
