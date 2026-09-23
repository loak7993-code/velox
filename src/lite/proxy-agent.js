// velox :: lite/proxy-agent.js — proxy transports for the from-scratch HTTP client.
// Implements, with no dependencies: HTTP absolute-form, HTTPS CONNECT tunnelling
// and SOCKS5 (with optional username/password auth). Used by velox.fetch/fetchAll
// so scraping can go through proxies without ever starting a browser.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import { normalizeProxy } from '../proxy.js';

const authHeader = (p) => (p.username ? 'Basic ' + Buffer.from(`${p.username}:${p.password ?? ''}`).toString('base64') : null);
const isSocks = (scheme) => scheme.startsWith('socks');

/* ------------------------------------------------------------------ CONNECT tunnel */
function connectViaHttpProxy(proxy, host, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(new URL(proxy.server).port) || 80, new URL(proxy.server).hostname);
    const done = (err, s) => { sock.removeAllListeners(); err ? reject(err) : resolve(s); };
    sock.setTimeout(timeout, () => { sock.destroy(); done(new Error('proxy CONNECT timeout')); });
    sock.on('error', (e) => done(new Error(`proxy connect failed: ${e.message}`)));
    sock.on('connect', () => {
      const auth = authHeader(proxy);
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`);
    });
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      const status = Number((buf.match(/^HTTP\/1\.\d (\d{3})/) || [])[1]);
      if (status !== 200) { sock.destroy(); return done(new Error(`proxy refused CONNECT (HTTP ${status})`)); }
      sock.setTimeout(0);
      done(null, sock);
    };
    sock.on('data', onData);
  });
}

/* ---------------------------------------------------------------------- SOCKS5 */
/** RFC 1928 CONNECT, with optional RFC 1929 username/password auth. */
function connectViaSocks5(proxy, host, port, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(proxy.server);
    const sock = net.connect(Number(u.port) || 1080, u.hostname);
    const fail = (e) => { sock.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    sock.setTimeout(timeout, () => fail(new Error('SOCKS5 timeout')));
    sock.on('error', (e) => fail(new Error(`SOCKS5 connect failed: ${e.message}`)));
    sock.on('close', () => fail(new Error('SOCKS5 connection closed')));

    const wantAuth = !!proxy.username;
    let stage = 'greeting';       // greeting → (auth) → request → reply
    let buf = Buffer.alloc(0);
    let done = false;

    const finish = (sockResolved) => { done = true; sock.setTimeout(0); sock.removeListener('data', onData); sock.removeListener('close', fail); resolve(sockResolved); };

    const step = () => {
      if (done) return;
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return fail(new Error(`SOCKS5: bad version ${buf[0]}`));
        const chosen = buf[1];
        buf = buf.subarray(2);
        if (chosen === 0xff) return fail(new Error('SOCKS5: proxy rejected all offered auth methods'));
        if (wantAuth && chosen !== 0x02) return fail(new Error(`SOCKS5: proxy chose method ${chosen}, expected username/password`));
        if (!wantAuth && chosen !== 0x00) return fail(new Error(`SOCKS5: proxy requires auth (method ${chosen}); pass credentials`));
        stage = wantAuth ? 'auth' : 'request';
        if (stage === 'auth') {
          const u2 = Buffer.from(proxy.username || ''), p2 = Buffer.from(proxy.password || '');
          sock.write(Buffer.concat([Buffer.from([0x01, u2.length]), u2, Buffer.from([p2.length]), p2]));
          return;   // wait for the auth reply
        }
        return step();
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ok = buf[1] === 0x00;
        buf = buf.subarray(2);
        if (!ok) return fail(new Error('SOCKS5: authentication rejected'));
        stage = 'request';
        return step();
      }
      if (stage === 'request') {
        const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
        const addr = ipv4
          ? Buffer.from([0x01, ...host.split('.').map(Number)])
          : Buffer.concat([Buffer.from([0x03, Buffer.byteLength(host)]), Buffer.from(host)]);
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addr, Buffer.from([port >> 8, port & 0xff])]));
        stage = 'reply';
        return;
      }
      if (stage === 'reply') {
        if (buf.length < 4) return;
        const rep = buf[1];
        const atyp = buf[3];
        const addrLen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? 1 + buf[4] : 0;
        if (buf.length < 4 + addrLen + 2) return;
        if (rep !== 0x00) return fail(new Error(`SOCKS5: connect failed (code ${rep})`));
        if (buf.length > 4 + addrLen + 2) sock.unshift(buf.subarray(4 + addrLen + 2));
        return finish(sock);
      }
    };

    const onData = (chunk) => { buf = Buffer.concat([buf, chunk]); step(); };
    sock.on('data', onData);
    sock.on('connect', () => {
      // greeting: one method — username/password when we have credentials, else no-auth
      sock.write(Buffer.from(wantAuth ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]));
    });
  });
}

/* ------------------------------------------------------------------- agents */
/**
 * Proxy agents, split by request protocol because Node validates the agent class:
 *   • http target  + http/https proxy → absolute-form requests over a socket to the proxy
 *   • http target  + socks proxy      → tunnel through SOCKS, then plain HTTP
 *   • https target (any proxy)        → CONNECT (or SOCKS) tunnel, then TLS over it
 */
function tunnelTo(proxy, timeout, host, port) {
  return isSocks(proxy.scheme)
    ? connectViaSocks5(proxy, host, port, timeout)
    : connectViaHttpProxy(proxy, host, port, timeout);
}

class HttpsViaProxyAgent extends https.Agent {
  constructor(proxy, opts) {
    super({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
    this.proxy = proxy;
    this.timeout = opts?.timeout ?? 30000;
  }
  createConnection(options, cb) {
    const host = options.host || options.hostname;
    const port = Number(options.port) || 443;
    tunnelTo(this.proxy, this.timeout, host, port).then((sock) => {
      const tlsSock = tls.connect({ socket: sock, servername: options.servername || host, ALPNProtocols: ['http/1.1'] });
      tlsSock.once('secureConnect', () => cb(null, tlsSock));
      tlsSock.once('error', (e) => cb(e));
    }, (e) => cb(e));
  }
}

class HttpViaSocksAgent extends http.Agent {
  constructor(proxy, opts) {
    super({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
    this.proxy = proxy;
    this.timeout = opts?.timeout ?? 30000;
  }
  createConnection(options, cb) {
    const host = options.host || options.hostname;
    const port = Number(options.port) || 80;
    tunnelTo(this.proxy, this.timeout, host, port).then((sock) => cb(null, sock), (e) => cb(e));
  }
}

/** http targets through an http proxy: connect to the PROXY, request absolute-form. */
class AbsoluteHttpAgent extends http.Agent {
  constructor(proxy, opts) {
    super({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
    this.proxy = proxy;
    this.timeout = opts?.timeout ?? 30000;
  }
  createConnection(_options, cb) {
    const u = new URL(this.proxy.server);
    const sock = net.connect(Number(u.port) || 80, u.hostname);
    sock.setTimeout(this.timeout, () => { sock.destroy(); cb(new Error('proxy connect timeout')); });
    sock.once('connect', () => { sock.setTimeout(0); cb(null, sock); });
    sock.once('error', (e) => cb(new Error(`proxy connect failed: ${e.message}`)));
  }
}

/** Build the agent pair (http + https targets) for a proxy. */
export function agentsFor(proxy, { timeout = 30000 } = {}) {
  const p = normalizeProxy(proxy);
  if (!p) return null;
  const socks = isSocks(p.scheme);
  return {
    proxy: p,
    http: socks ? new HttpViaSocksAgent(p, { timeout }) : new AbsoluteHttpAgent(p, { timeout }),
    https: new HttpsViaProxyAgent(p, { timeout }),
    authHeader: authHeader(p),
  };
}

export { HttpsViaProxyAgent, HttpViaSocksAgent, AbsoluteHttpAgent, connectViaHttpProxy, connectViaSocks5 };
