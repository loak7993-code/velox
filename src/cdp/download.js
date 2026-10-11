// velox :: cdp/download.js — the Download object handed to page.on('download') /
// page.waitForDownload(). Split out of page.js.
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TimeoutError, cookieHeader } from '../util.js';

export class Download {
  constructor(page, guid, url, suggestedFilename) {
    this.page = page;
    this.guid = guid;
    this.url = url;
    this.suggestedFilename = suggestedFilename;
    this.state = 'inProgress';
    this.receivedBytes = 0;
    this.totalBytes = 0;
    this._done = null;
    this._path = null;
  }
  _update(p) {
    if (p.state) this.state = p.state;
    if (p.receivedBytes != null) this.receivedBytes = p.receivedBytes;
    if (p.totalBytes != null) this.totalBytes = p.totalBytes;
    if ((p.state === 'completed' || p.state === 'canceled') && this._done) { this._done(); this._done = null; }
  }
  /** Resolves when the download finishes. */
  finished(timeout = 30000) {
    if (this.state === 'completed' || this.state === 'canceled') return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new TimeoutError('download', timeout)), timeout);
      this._done = () => { clearTimeout(t); resolve(this); };
    });
  }
  /** Where the browser is writing it (allowAndName: guid file inside the download dir). */
  path() {
    const dir = this.page._downloads;
    return dir ? join(dir, this.guid) : null;
  }
  /** Copy to a friendly filename once complete. */
  async saveAs(target) {
    if (this.state !== 'completed') await this.finished();
    if (this.state === 'canceled') throw new Error('download canceled');
    const src = this.path();
    if (!src) throw new Error('download dir not configured');
    // Chrome renames its .crdownload temp to the guid name shortly AFTER reporting
    // 'completed' — poll for it first.
    const deadline = Date.now() + 15000;
    while (!existsSync(src) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(src)) {
      copyFileSync(src, target);
    } else {
      // Fallback: headless browsers occasionally finish a download without landing the
      // file (seen with --remote-debugging-pipe). Fetch the bytes ourselves with the
      // page's cookies so saveAs() is deterministic instead of mysteriously empty.
      const { fetch: liteFetch } = await import('../lite/engine.js');
      const cookies = await this.page.cookies([this.url]).catch(() => []);
      const cookie = cookieHeader(cookies);
      const res = await liteFetch(this.url, {
        timeout: 60000,
        headers: { ...(cookie ? { cookie } : {}) },
        maxRedirects: 10,
      });
      writeFileSync(target, res.body);
      this._fetchedDirectly = true;
    }
    this._path = target;
    return target;
  }
  async cancel() {
    await this.page.conn.send('Browser.cancelDownload', { guid: this.guid }).catch(() => {});
    this.state = 'canceled';
    if (this._done) { this._done(); this._done = null; }
  }
  get filename() { return this.suggestedFilename; }
}
