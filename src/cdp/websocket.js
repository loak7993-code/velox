// velox :: cdp/websocket.js — WebSocket tracker handed to page.on('websocket', ws).
// Split out of page.js.
import { Emitter } from '../util.js';

export class WebSocketTracker extends Emitter {
  constructor(page, id, url) {
    super();
    this.page = page;
    this.id = id;
    this.url = url;
    this.framesSent = [];
    this.framesReceived = [];
    this.headers = null;
    this.closedAt = null;
  }
  handshake(response) { this.headers = response?.headers || null; this.status = response?.status; }
  frame(dir, payload, timestamp) {
    let text = null;
    try { text = Buffer.from(payload.payloadData, 'base64').toString('utf8'); } catch { text = payload.payloadData; }
    const rec = { dir, text, opcode: payload.opcode, timestamp, ws: this };
    (dir === 'sent' ? this.framesSent : this.framesReceived).push(rec);
    this.emit(dir === 'sent' ? 'framesent' : 'framereceived', rec);
  }
  closed(timestamp) { this.closedAt = timestamp ?? Date.now() / 1000; this.emit('close', this); }
  get isClosed() { return this.closedAt != null; }
}
