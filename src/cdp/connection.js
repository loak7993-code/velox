// velox :: cdp/connection.js — from-scratch CDP client.
// Two transports, one API:
//   • pipe   — CDP over stdio fd3/fd4 (--remote-debugging-pipe). Lowest latency. Default for launches.
//   • socket — native WebSocket. Default for remote/connect().
// Commands are fully pipelined: send() returns a promise instantly and never
// waits on the previous command — every call is one frame in, one frame out.
import { Emitter, TimeoutError } from '../util.js';

let nextId = 1;

export class CdpConnection extends Emitter {
  constructor(wsUrl) {
    super();
    this.wsUrl = wsUrl;
    this.ws = null;
    this._write = null;             // (raw: string) => void
    this._pending = new Map();      // id -> {resolve, reject, timer}
    this._sessions = new Map();     // sessionId -> session emitter
    this.closed = false;
    this.transport = 'socket';
    this.stats = { sent: 0, received: 0, events: 0, rttUs: 0 };
  }

  static async connect(wsUrl, { timeout = 15000 } = {}) {
    const c = new CdpConnection(wsUrl);
    await c.openSocket(timeout);
    return c;
  }

  /** CDP over pipes: spawn must use stdio [..., 'pipe', 'pipe'] for fd3/fd4. */
  static pipe(proc) {
    const c = new CdpConnection('pipe://browser');
    c.transport = 'pipe';
    const out = proc.stdio[3];   // we write commands here (browser's fd3)
    const inp = proc.stdio[4];   // browser's responses arrive here (its fd4)
    c._write = (raw) => out.write(raw + '\0');
    let buf = Buffer.alloc(0);
    inp.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0)) !== -1) {
        const frame = buf.subarray(0, i).toString('utf8');
        buf = buf.subarray(i + 1);
        if (frame.trim()) c._recv(frame);
      }
    });
    inp.on('close', () => c._onClose());
    out.on('error', () => c._onClose());
    c._pipeProc = proc;
    return c;
  }

  async openSocket(timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (this.ws) return resolve(this);
      const timer = setTimeout(() => reject(new TimeoutError('CDP websocket open', timeout)), timeout);
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => { clearTimeout(timer); this.ws = ws; this._write = (raw) => ws.send(raw); resolve(this); });
      ws.addEventListener('message', (ev) => this._recv(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')));
      ws.addEventListener('close', () => this._onClose());
      ws.addEventListener('error', () => { clearTimeout(timer); if (!this.ws) reject(new Error(`CDP connect failed: ${this.wsUrl}`)); this._onClose(); });
    });
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    const err = new Error('CDP connection closed');
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this._pending.clear();
    this.emit('disconnect', err);
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch {}
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error('closed')); }
    this._pending.clear();
  }

  _recv(raw) {
    this.stats.received++;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined) {
      const p = this._pending.get(msg.id);
      if (!p) return;
      this._pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message} ${msg.error.data ?? ''}`.trim()));
      else { this.stats.rttUs += Number((process.hrtime.bigint() / 1000n) - p.t0); p.resolve(msg.result); }
      return;
    }
    // event
    this.stats.events++;
    const sid = msg.sessionId;
    if (sid && this._sessions.has(sid)) {
      this._sessions.get(sid).emit(msg.method, msg.params ?? {});
    }
    this.emit(msg.method, msg.params ?? {}, sid); // browser-level broadcast
  }

  /** Send a CDP command. Pipelined: resolves when the response arrives. */
  send(method, params = {}, { sessionId, timeout = 30000 } = {}) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    if (!this._write) return Promise.reject(new Error('CDP connection not open'));
    const id = nextId++;
    const t0 = process.hrtime.bigint() / 1000n;
    return new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => {
        this._pending.delete(id);
        reject(new TimeoutError(`${method}`, timeout));
      }, timeout) : null;
      this._pending.set(id, { resolve, reject, timer, method, t0 });
      this._write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      this.stats.sent++;
    });
  }

  /** Fire-and-forget: send without creating a promise. Fastest path. */
  fire(method, params = {}, { sessionId } = {}) {
    if (this.closed || !this._write) return;
    this._write(JSON.stringify({ id: nextId++, method, params, ...(sessionId ? { sessionId } : {}) }));
  }

  /** Attach to a target; returns a session-bound connection proxy. */
  async attachToTarget(targetId, { flatten = true } = {}) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten });
    return this.session(sessionId);
  }

  session(sessionId) {
    let s = this._sessions.get(sessionId);
    if (s) return s;
    s = new CdpSession(this, sessionId);
    this._sessions.set(sessionId, s);
    return s;
  }

  detach(sessionId) {
    this._sessions.delete(sessionId);
    this.fire('Runtime.runIfWaitingForDebugger', {}, { sessionId });
    this.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }

  /** Await a specific event on the connection or a session. */
  waitForEvent(method, { sessionId, timeout = 30000, predicate } = {}) {
    return new Promise((resolve, reject) => {
      const target = sessionId && this._sessions.has(sessionId) ? this._sessions.get(sessionId) : this;
      const timer = timeout > 0 ? setTimeout(() => { off(); reject(new TimeoutError(`event ${method}`, timeout)); }, timeout) : null;
      const off = target.on(method, (p) => {
        if (predicate && !predicate(p)) return;
        clearTimeout(timer); off(); resolve(p);
      });
    });
  }
}

/** Session-scoped view: send/recv with an implicit sessionId + its own emitter. */
export class CdpSession extends Emitter {
  constructor(conn, sessionId) {
    super();
    this.conn = conn;
    this.sessionId = sessionId;
  }
  send(method, params = {}, opts = {}) { return this.conn.send(method, params, { ...opts, sessionId: this.sessionId }); }
  fire(method, params = {}) { this.conn.fire(method, params, { sessionId: this.sessionId }); }
  waitForEvent(method, opts = {}) { return this.conn.waitForEvent(method, { ...opts, sessionId: this.sessionId }); }
  async detach() { this.conn.detach(this.sessionId); }
}
