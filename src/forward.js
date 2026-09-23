// velox :: forward.js — a local forwarding proxy that injects upstream credentials.
//
// Why: Chrome's proxy auth through CDP (Fetch.authRequired → continueWithAuth) does not
// work with every browser build or every upstream proxy (Bright Data / IPRoyal style
// authenticated gateways are the common failure). A local forwarder sidesteps the whole
// problem: the browser talks to 127.0.0.1 with no auth, and velox adds
// Proxy-Authorization for the upstream hop itself.
//
//   const px = await velox.proxyForward({ server: 'http://geo.iproyal.com:12321', username, password });
//   await velox.launch({ proxy: px });        // px = { server: 'http://127.0.0.1:PORT', direct: false }
//
// Also works with no upstream at all (`direct: true`) — a plain local proxy for anything
// that needs one.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { normalizeProxy } from './proxy.js';
import { connectViaSocks5, connectViaHttpProxy } from './lite/proxy-agent.js';
import { Emitter } from './util.js';

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p ?? ''}`).toString('base64');

/**
 * Start a local proxy in front of `upstream` (or a direct tunnel when there is none).
 * @returns {Promise<{server,port,url,stats,close,direct}>}
 */
export async function proxyForward(upstream, { host = '127.0.0.1', port = 0, auth = null } = {}) {
  const up = upstream ? normalizeProxy(upstream) : null;
  const stats = { connects: 0, requests: 0, bytesUp: 0, bytesDown: 0, denied: 0, errors: 0 };
  const emitter = new Emitter();

  const connectUpstream = (dstHost, dstPort) => {
    if (!up) {
      // no upstream: plain tunnel (localhost as a "proxy" for tools that demand one)
      return new Promise((resolve, reject) => {
        const s = net.connect(dstPort, dstHost, () => resolve(s));
        s.once('error', reject);
      });
    }
    const timeout = 20000;
    return up.scheme.startsWith('socks')
      ? connectViaSocks5(up, dstHost, dstPort, timeout)
      : connectViaHttpProxy(up, dstHost, dstPort, timeout);
  };

  /** absolute-form HTTP GET through an HTTP upstream (or a tunnel otherwise) */
  const handleHttp = async (req, res) => {
    if (auth && !authorized(req)) {
      stats.denied++;
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="velox-forward"' });
      return res.end('proxy auth required');
    }
    stats.requests++;
    if (up && !up.scheme.startsWith('socks')) {
      // send it to the upstream proxy with credentials attached
      const u = new URL(req.url);
      const headers = { ...req.headers, host: u.host, ...(up.username ? { 'proxy-authorization': basic(up.username, up.password) } : {}) };
      const upReq = http.request({
        host: new URL(up.server).hostname,
        port: Number(new URL(up.server).port) || 80,
        method: req.method, path: req.url, headers,
      }, (upRes) => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); });
      upReq.on('error', () => { stats.errors++; try { res.writeHead(502); res.end('upstream error'); } catch {} });
      req.pipe(upReq);
      return;
    }
    // SOCKS / direct: tunnel then speak HTTP over it
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400); return res.end('absolute-form required'); }
    const sock = await connectUpstream(target.hostname, Number(target.port) || 80).catch(() => null);
    if (!sock) { stats.errors++; res.writeHead(502); return res.end('cannot reach upstream'); }
    const head = `${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n` +
      Object.entries({ ...req.headers, host: target.host }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
    sock.write(head);
    req.pipe(sock);
    sock.on('data', (c) => { stats.bytesDown += c.length; if (!res.headersSent) res.writeHead(200); res.write(c); });
    sock.on('end', () => res.end());
    sock.on('error', () => { stats.errors++; try { res.end(); } catch {} });
  };

  const authorized = (req) => {
    const h = req.headers['proxy-authorization'];
    return h === basic(auth.username, auth.password);
  };

  const server = http.createServer((req, res) => { handleHttp(req, res).catch(() => { stats.errors++; try { res.destroy(); } catch {} }); });

  // CONNECT (https through us): tunnel to the upstream, then pipe
  server.on('connect', async (req, clientSocket, head) => {
    if (auth && !authorized(req)) {
      stats.denied++;
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="velox-forward"\r\n\r\n');
      return clientSocket.destroy();
    }
    stats.connects++;
    const [dstHost, dstPort] = String(req.url).split(':');
    const upstreamSock = await connectUpstream(dstHost, Number(dstPort) || 443).catch((e) => {
      stats.errors++;
      emitter.emit('error', e);
      return null;
    });
    if (!upstreamSock) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return clientSocket.destroy();
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstreamSock.write(head);
    clientSocket.on('data', (c) => { stats.bytesUp += c.length; });
    upstreamSock.on('data', (c) => { stats.bytesDown += c.length; });
    upstreamSock.pipe(clientSocket);
    clientSocket.pipe(upstreamSock);
    const kill = () => { try { upstreamSock.destroy(); } catch {} try { clientSocket.destroy(); } catch {} };
    clientSocket.on('error', kill);
    upstreamSock.on('error', kill);
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const actualPort = server.address().port;
  return {
    server: `http://${host}:${actualPort}`,
    port: actualPort,
    direct: !up,
    upstream: up ? up.server : null,
    stats,
    on: (ev, fn) => emitter.on(ev, fn),
    close: () => new Promise((r) => { try { server.close(() => r()); } catch { r(); } setTimeout(r, 500); }),
  };
}
