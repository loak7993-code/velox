// velox :: test/site/proxy.js — from-scratch proxy servers used to VERIFY proxy support.
//   • HTTP proxy: absolute-form requests + CONNECT tunnelling (+ optional basic auth)
//   • SOCKS5 proxy: CONNECT (+ optional username/password auth)
// Both count traffic and can inject latency or refuse connections, so tests can
// assert routing, auth, health checks and failure ejection for real.
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';

const b64 = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

/* ------------------------------------------------------------------ http proxy */
export function startHttpProxy({ id = 'p1', username, password, fail = false, delay = 0 } = {}) {
  const stats = { requests: 0, connects: 0, https: 0, denied: 0, id };
  const needsAuth = !!(username || password);
  const authorized = (req) => !needsAuth || req.headers['proxy-authorization'] === b64(username, password);

  const server = http.createServer((req, res) => {
    if (fail) return res.socket?.destroy();
    if (!authorized(req)) {
      stats.denied++;
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="velox-proxy"' });
      return res.end('proxy auth required');
    }
    stats.requests++;
    const send = () => {
      let target;
      try { target = new URL(req.url); } catch { res.writeHead(400); return res.end('bad absolute-form url'); }
      const up = http.request({
        hostname: target.hostname, port: target.port || 80, path: target.pathname + target.search,
        method: req.method, headers: { ...req.headers, host: target.host },
      }, (r) => {
        res.writeHead(r.statusCode, { ...r.headers, 'x-vx-proxy-id': stats.id });
        r.pipe(res);
      });
      up.on('error', () => { try { res.writeHead(502); res.end('upstream error'); } catch {} });
      req.pipe(up);
    };
    delay ? setTimeout(send, delay) : send();
  });

  server.on('connect', (req, clientSocket, head) => {
    if (fail) return clientSocket.destroy();
    if (!authorized(req)) {
      stats.denied++;
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="velox-proxy"\r\n\r\n');
      return clientSocket.destroy();
    }
    stats.connects++;
    const [host, port] = String(req.url).split(':');
    const upstream = net.connect(Number(port) || 443, host, () => {
      stats.https++;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, stats, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/* ---------------------------------------------------------------- socks5 proxy */
export function startSocks5Proxy({ id = 's1', username, password, fail = false } = {}) {
  const stats = { connects: 0, denied: 0, id };
  const needsAuth = !!(username || password);

  const server = net.createServer((socket) => {
    if (fail) return socket.destroy();
    let buf = Buffer.alloc(0);
    let stage = 'greeting';

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return socket.destroy();
        const n = buf[1];
        if (buf.length < 2 + n) return;
        const methods = buf.subarray(2, 2 + n);
        buf = buf.subarray(2 + n);
        if (needsAuth) {
          if (!methods.includes(0x02)) { socket.write(Buffer.from([0x05, 0xff])); return socket.destroy(); }
          socket.write(Buffer.from([0x05, 0x02]));
          stage = 'auth';
        } else {
          if (!methods.includes(0x00)) { socket.write(Buffer.from([0x05, 0xff])); return socket.destroy(); }
          socket.write(Buffer.from([0x05, 0x00]));
          stage = 'request';
        }
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ul = buf[1];
        if (buf.length < 2 + ul + 1) return;
        const uname = buf.subarray(2, 2 + ul).toString();
        const pl = buf[2 + ul];
        if (buf.length < 3 + ul + pl) return;
        const pass = buf.subarray(3 + ul, 3 + ul + pl).toString();
        buf = buf.subarray(3 + ul + pl);
        if (uname === username && pass === password) { socket.write(Buffer.from([0x01, 0x00])); stage = 'request'; }
        else { stats.denied++; socket.write(Buffer.from([0x01, 0x01])); return socket.destroy(); }
      }
      if (stage === 'request') {
        if (buf.length < 4) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x01) { socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); return socket.destroy(); }
        const atyp = buf[3];
        let host, off;
        if (atyp === 0x01) { if (buf.length < 10) return; host = buf.subarray(4, 8).join('.'); off = 8; }
        else if (atyp === 0x03) { if (buf.length < 5) return; const len = buf[4]; if (buf.length < 5 + len + 2) return; host = buf.subarray(5, 5 + len).toString(); off = 5 + len; }
        else if (atyp === 0x04) { if (buf.length < 22) return; host = Array.from({ length: 8 }, (_, i) => buf.readUInt16BE(4 + i * 2).toString(16)).join(':'); off = 20; }
        else { socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); return socket.destroy(); }
        const port = buf.readUInt16BE(off);
        socket.removeListener('data', onData);
        const remote = net.connect(port, host, () => {
          stats.connects++;
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          remote.pipe(socket); socket.pipe(remote);
        });
        remote.on('error', () => { try { socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); } catch {} socket.destroy(); });
        socket.on('error', () => remote.destroy());
      }
    };
    socket.on('data', onData);
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, stats, port, url: `socks5://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
