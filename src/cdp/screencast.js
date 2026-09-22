// velox :: cdp/screencast.js — page video recording: CDP screencast frames →
// palette-mapped indices → from-scratch GIF encoder. Zero dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, shrink } from './png.js';
import { buildPalette, mapToIndices, encodeGif } from './gif.js';

export class VideoRecorder {
  constructor(page, { width = 720, maxFrames = 300, maxBytes = 96 << 20, everyNthFrame = 1 } = {}) {
    this.page = page;
    this.opts = { width, maxFrames, maxBytes, everyNthFrame };
    this.frames = [];       // [{indices, delayMs}]
    this._palette = null;
    this._lastTs = null;
    this._recording = false;
    this._frameCount = 0;
    this._bytes = 0;
    this._handlers = [];
  }

  get path() { return this._path; }
  get frameCount() { return this.frames.length; }

  async start({ path, dir } = {}) {
    if (this._recording) return this;
    this._recording = true;
    this._path = path || join(dir || '.', `velox-${Date.now()}.gif`);
    this._onFrame = (params) => this._handleFrame(params);
    this.page.session.on('Page.screencastFrame', this._onFrame);
    this._handlers.push(['Page.screencastFrame', this._onFrame]);
    await this.page.session.send('Page.startScreencast', {
      format: 'png',
      everyNthFrame: this.opts.everyNthFrame,
      maxWidth: this.opts.width * 2,
      maxHeight: 4096,
    }).catch(() => {});
    return this;
  }

  async _handleFrame({ data, metadata, sessionId }) {
    // ack immediately so the stream keeps flowing
    this.page.session.fire('Page.screencastFrameAck', { sessionId });
    this.page.conn.fire('Page.screencastFrameAck', { sessionId });
    if (!this._recording) return;
    const ts = metadata?.timestamp ?? Date.now() / 1000;
    const delayMs = this._lastTs == null ? 100 : Math.max(30, Math.min(10000, (ts - this._lastTs) * 1000));
    this._lastTs = ts;
    if (this.frames.length >= this.opts.maxFrames) return;
    try {
      const img = shrink(decodePng(Buffer.from(data, 'base64')), this.opts.width);
      if (!this._palette) this._palette = buildPalette(img.rgba);
      const indices = mapToIndices(img.rgba, this._palette);
      this._bytes += indices.length;
      this._w = img.width; this._h = img.height;
      this.frames.push({ indices, delayMs });
      if (this._bytes > this.opts.maxBytes) await this.stop();
    } catch { /* unsupported png variant — skip frame */ }
  }

  /** Stop and write the GIF. Returns the file path. */
  async stop() {
    if (!this._recording) return this._path;
    this._recording = false;
    for (const [ev, fn] of this._handlers) this.page.session.off(ev, fn);
    await this.page.session.send('Page.stopScreencast', {}).catch(() => {});
    if (this.frames.length) {
      const gif = encodeGif(this._w, this._h, this._palette, this.frames);
      mkdirSync(dirname(this._path), { recursive: true });
      writeFileSync(this._path, gif);
    }
    return this._path;
  }
}

export function videoApi(page) {
  let recorder = null;
  return {
    /** page.video.start({ path, width }) → recorder */
    async start(opts = {}) {
      if (recorder && recorder._recording) return recorder;
      recorder = new VideoRecorder(page, opts);
      await recorder.start(opts);
      return recorder;
    },
    /** stop and save; resolves to the gif path */
    async stop() { return recorder ? recorder.stop() : null; },
    get recorder() { return recorder; },
  };
}
