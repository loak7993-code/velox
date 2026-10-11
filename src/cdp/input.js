// velox :: cdp/input.js — trusted keyboard / mouse / touch input over CDP Input.*.
// Split out of page.js: pure builders that take the page and produce the input API
// object (cached per page by the page's getters, so handlers can hold references).
import { sleep, randInt, humanDelay } from '../util.js';

export const KEYMAP = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16, location: 1 },
  control: { key: 'Control', code: 'ControlLeft', keyCode: 17, location: 1 },
  alt: { key: 'Alt', code: 'AltLeft', keyCode: 18, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91, location: 1 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

export function normKey(k, dir) {
  const raw = String(k);
  const lower = raw.toLowerCase();
  const m = KEYMAP[lower];
  if (m) return { key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode, ...(dir === 'down' && m.text ? { text: m.text } : {}) };
  const upper = raw.toUpperCase();
  return { key: raw, code: /^[a-z0-9]$/i.test(raw) ? 'Key' + upper : undefined, windowsVirtualKeyCode: upper.charCodeAt(0) || undefined, ...(dir === 'down' && raw.length === 1 ? { text: raw } : {}) };
}

/** Keyboard API: trusted key events (the `keyboard` getter on VeloxPage). */
export function keyboardOf(page) {
  const send = (type, args) => page.session.send('Input.dispatchKeyEvent', { type, ...args });
  return {
    async down(k) { return send('rawKeyDown', normKey(k, 'down')); },
    async up(k) { return send('keyUp', normKey(k, 'up')); },
    async press(k) {
      const km = KEYMAP[String(k).toLowerCase()];
      await send('rawKeyDown', normKey(k, 'down'));
      if (km?.text) await send('keyDown', { ...normKey(k, 'down'), text: km.text });
      await send('keyUp', normKey(k, 'up'));
    },
    async sendChar(ch) {
      const code = /[a-z0-9]/i.test(ch) ? 'Key' + ch.toUpperCase() : undefined;
      await send('keyDown', {
        key: ch, text: ch, unmodifiedText: ch,
        windowsVirtualKeyCode: ch.length === 1 ? ch.toUpperCase().charCodeAt(0) : undefined, ...(code ? { code } : {}),
      });
      await send('keyUp', { key: ch, ...(code ? { code } : {}) });
    },
    async type(text, { delay = 0, human = false } = {}) {
      for (const ch of String(text)) { await this.sendChar(ch); if (human) await humanDelay(delay || 60); else if (delay) await sleep(delay); }
    },
    async insertText(text) { return page.session.send('Input.insertText', { text: String(text) }); },
  };
}

const MOUSE_BUTTON = { left: 1, middle: 4, right: 2, none: 0 };
const MODIFIER_BIT = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/** Mouse API: moves, clicks, wheel, bezier humanMove (the `mouse` getter on VeloxPage). */
export function mouseOf(page) {
  const dispatch = (args) => page.session.send('Input.dispatchMouseEvent', args);
  return {
    async move(x, y, { steps = 1 } = {}) {
      const from = { ...page._mouse };
      for (let i = 1; i <= steps; i++) {
        const nx = from.x + (x - from.x) * (i / steps), ny = from.y + (y - from.y) * (i / steps);
        await dispatch({ type: 'mouseMoved', x: nx, y: ny, button: 'none' });
      }
      page._mouse = { x, y };
    },
    async click(x, y, { button = 'left', clicks = 1, modifiers = [], delay = 10 } = {}) {
      const mod = modifiers.reduce((m, k) => m | (MODIFIER_BIT[k] || 0), 0);
      await this.move(x, y, { steps: 2 });
      for (let c = 0; c < clicks; c++) {
        await dispatch({ type: 'mousePressed', x, y, button, clickCount: 1, modifiers: mod });
        if (delay) await sleep(delay);
        await dispatch({ type: 'mouseReleased', x, y, button, clickCount: 1, modifiers: mod });
        if (c < clicks - 1 && delay) await sleep(delay * 2);
      }
    },
    async dblclick(x, y, o = {}) { return this.click(x, y, { ...o, clicks: 2 }); },
    async down(button = 'left') { return dispatch({ type: 'mousePressed', x: page._mouse.x, y: page._mouse.y, button, clickCount: 1 }); },
    async up(button = 'left') { return dispatch({ type: 'mouseReleased', x: page._mouse.x, y: page._mouse.y, button, clickCount: 1 }); },
    async wheel(dx, dy) { return dispatch({ type: 'mouseWheel', x: page._mouse.x, y: page._mouse.y, deltaX: dx, deltaY: dy }); },
    async humanMove(x, y, { steps } = {}) {
      // bezier-ish human cursor path
      const n = steps || randInt(15, 30);
      const from = { ...page._mouse };
      const cx = (from.x + x) / 2 + randInt(-80, 80), cy = (from.y + y) / 2 + randInt(-80, 80);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const nx = u * u * from.x + 2 * u * t * cx + t * t * x;
        const ny = u * u * from.y + 2 * u * t * cy + t * t * y;
        await dispatch({ type: 'mouseMoved', x: nx, y: ny, button: 'none' });
        await sleep(randInt(4, 14));
      }
      page._mouse = { x, y };
    },
  };
}

/** Touch API: tap + swipe (the `touch` getter on VeloxPage). */
export function touchOf(page) {
  const dispatch = (args) => page.session.send('Input.dispatchTouchEvent', args);
  return {
    async tap(x, y) {
      await dispatch({ type: 'touchStart', touchPoints: [{ x, y }] });
      await dispatch({ type: 'touchEnd', touchPoints: [] });
    },
    async swipe(x1, y1, x2, y2, { steps = 12 } = {}) {
      await dispatch({ type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
      for (let i = 1; i <= steps; i++) {
        await dispatch({
          type: 'touchMove',
          touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }],
        });
        await sleep(16);
      }
      await dispatch({ type: 'touchEnd', touchPoints: [] });
    },
  };
}
