// velox :: human.js — human-like interaction. Behaviour layers (Cloudflare, Akamai,
// PerimeterX) score *how* you move and type at least as much as fingerprints do:
// perfectly straight mouse paths and metronomic typing are classic automation tells.
//
//   await page.human.click('#login');
//   await page.human.type('#email', 'me@example.com');
//   await page.human.scroll({ by: 800, read: true });
//   await page.human.idle(1500);
//
// All randomness is seeded so runs are reproducible when you need them to be.
import { sleep } from './util.js';

export function rng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Ease-in-out timing curve — humans accelerate then settle. */
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class HumanBehaviour {
  constructor(page, { seed = Date.now(), speed = 1, jitter = 1 } = {}) {
    this.page = page;
    this.rand = rng(seed);
    this.speed = speed;            // >1 = faster/less patient
    this.jitter = jitter;          // 0 = deterministic, 1 = human
    this._pos = { x: null, y: null };
  }

  _r(min, max) { return min + this.rand() * (max - min); }
  _pause(min, max) { return sleep(Math.round(this._r(min, max) / this.speed)); }
  _j(v) { return v * this.jitter; }

  /** Where the cursor currently is (seeded, inside the viewport if unknown). */
  async position() {
    if (this._pos.x != null) return this._pos;
    const vp = await this.page.eval('[innerWidth, innerHeight]').catch(() => [1280, 720]);
    this._pos = { x: Math.round(vp[0] * this._r(0.2, 0.8)), y: Math.round(vp[1] * this._r(0.2, 0.8)) };
    return this._pos;
  }

  /**
   * Move the cursor along a curved path (two control points + micro jitter), with an
   * optional overshoot then correction, the way hand/eye aiming actually works.
   */
  async moveTo(x, y, { overshoot = 0.25 } = {}) {
    const from = await this.position();
    const dist = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(8, Math.min(60, Math.round(dist / this._r(6, 14))));
    // two control points → a non-linear, non-symmetric curve
    const c1 = { x: from.x + (x - from.x) * this._r(0.2, 0.45) + this._j(this._r(-90, 90)), y: from.y + (y - from.y) * this._r(0.15, 0.4) + this._j(this._r(-70, 70)) };
    const c2 = { x: from.x + (x - from.x) * this._r(0.55, 0.85) + this._j(this._r(-60, 60)), y: from.y + (y - from.y) * this._r(0.5, 0.85) + this._j(this._r(-50, 50)) };
    const target = this.rand() < overshoot ? { x: x + this._j(this._r(-8, 8)), y: y + this._j(this._r(-8, 8)) } : { x, y };
    // anchor: the first event of a gesture is where the cursor already is, so a
    // detector never sees a jump from an assumed origin
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });

    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const u = 1 - t;
      const px = u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * target.x;
      const py = u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * target.y;
      const nx = px + this._j(this._r(-0.8, 0.8));
      const ny = py + this._j(this._r(-0.8, 0.8));
      await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny, button: 'none' });
      // velocity profile: slower at the ends, quicker mid-flight
      await sleep(Math.max(2, Math.round((this._r(6, 18) * (0.6 + Math.abs(0.5 - i / steps))) / this.speed)));
    }
    // settle on the exact point
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    this._pos = { x, y };
    return this;
  }

  /** Click a selector the human way: move, dwell, press, hold briefly, release. */
  async click(sel, { hold, button = 'left', dwell } = {}) {
    const p = await this.page.eval(`__vlx.point(${JSON.stringify(sel)})`);
    if (!p) throw new Error(`human.click: not clickable ${sel}`);
    await this.moveTo(p.x, p.y);
    await this._pause(dwell ?? 60, dwell ?? 220);                       // settle before pressing
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, clickCount: 1 });
    await this._pause(hold ?? 45, hold ?? 140);                         // humans hold the button
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, clickCount: 1 });
    return this.page;
  }

  async clickAt(x, y, { button = 'left', hold } = {}) {
    await this.moveTo(x, y);
    await this._pause(50, 180);
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await this._pause(hold ?? 40, hold ?? 130);
    await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
    return this.page;
  }

  /** Type with a per-key cadence, word-boundary pauses and occasional corrections. */
  async type(sel, text, { cps, mistakes = 0.02 } = {}) {
    await this.page.eval(`__vlx.focus(${JSON.stringify(sel)})`);
    const keys = String(text);
    const base = cps ? 1000 / cps : null;
    for (let i = 0; i < keys.length; i++) {
      const ch = keys[i];
      // occasional typo then backspace, like a real person
      if (this.rand() < this._j(mistakes) && /[a-z]/i.test(ch)) {
        const wrong = String.fromCharCode(97 + Math.floor(this.rand() * 26));
        await this.page.keyboard.sendChar(wrong);
        await this._pause(40, 160);
        await this.page.keyboard.press('Backspace');
        await this._pause(30, 120);
      }
      if (ch === ' ') await this.page.keyboard.press('Space');
      else if (ch === '\n') await this.page.keyboard.press('Enter');
      else await this.page.keyboard.sendChar(ch);
      if (base) await this._pause(base * 0.6, base * 1.5);
      else if (ch === ' ') await this._pause(60, 220);                  // between words
      else await this._pause(28, 145);                                  // between keys
      if (this.rand() < 0.03 * this.jitter) await this._pause(250, 900); // hesitation
    }
    return this.page;
  }

  /** Scroll with wheel momentum and optional reading pauses. */
  async scroll({ by = 600, read = false, to } = {}) {
    if (to != null) {
      const cur = await this.page.eval('scrollY');
      by = to - cur;
    }
    const dir = Math.sign(by) || 1;
    let left = Math.abs(by);
    while (left > 0) {
      const chunk = Math.min(left, Math.round(this._r(120, 380)));
      // a wheel gesture is a burst of small deltas that decays
      const ticks = Math.round(this._r(4, 9));
      for (let i = 0; i < ticks; i++) {
        const decay = 1 - i / ticks;
        await this.page.mouse.wheel(0, dir * Math.round((chunk / ticks) * decay));
        await sleep(Math.round(this._r(8, 26) / this.speed));
      }
      left -= chunk;
      if (read) await this._pause(180, 800);                            // "reading"
    }
    return this;
  }

  /** Idle like a person: small drift movements, no clicks. */
  async idle(ms = 1500) {
    const until = Date.now() + ms;
    const from = await this.position();
    while (Date.now() < until) {
      const x = Math.max(5, Math.min(from.x + this._j(this._r(-40, 40)), from.x + 40));
      const y = Math.max(5, Math.min(from.y + this._j(this._r(-30, 30)), from.y + 30));
      await this.page.session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      this._pos = { x, y };
      await sleep(Math.round(this._r(220, 900) / this.speed));
    }
    return this;
  }

  /** A believable reading beat for a page whose text you just loaded. */
  async readText(sel, { wpm = 220 } = {}) {
    const text = await this.page.text(sel).catch(() => '');
    const words = String(text || '').split(/\s+/).filter(Boolean).length;
    const ms = Math.min(12000, Math.max(300, (words / wpm) * 60000 * this._r(0.6, 1.3) / this.speed));
    await this.idle(ms);
    return ms;
  }
}

export function attachHuman(page, opts) {
  const human = new HumanBehaviour(page, opts);
  // small convenience accessors that keep the Locator ergonomics
  page.human = human;
  return human;
}
