// velox :: cdp/capture.js — screenshots (element / fullpage / clip / mask) and PDF
// printing. Split out of page.js; these are prototype methods on VeloxPage.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sleep } from '../util.js';

export async function screenshot({ path, full = false, selector, type = 'png', quality = 80, fast = false, clip, mask, animations } = {}) {
  let maskId = null, froze = false;
  try {
    if (animations === 'disabled') { froze = true; await this.evalSync('__vlx.freezeAnimations()'); }
    if (mask?.length) { maskId = await this.evalSync(`__vlx.mask(${JSON.stringify(mask)})`); }
    let clipArg = clip || undefined;
    if (selector) {
      const r = await this.evalSync(this._x('rect', selector));
      if (!r) throw new Error(`No element for screenshot: ${selector}`);
      const [sx, sy] = await this.evalSync('[scrollX, scrollY]');
      clipArg = { x: r.x + sx, y: r.y + sy, width: r.width, height: r.height, scale: 1 };
    } else if (full) {
      let cs = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const m = await this.session.send('Page.getLayoutMetrics');
        cs = m.cssContentSize || m.contentSize;
        if (cs && cs.width > 0 && cs.height > 0) break;
        await sleep(120); // layout not ready yet (page just navigated)
      }
      if (!cs || cs.width <= 0 || cs.height <= 0) {
        const v = await this.session.send('Page.getLayoutMetrics');
        cs = v.cssVisualViewport || v.contentSize || { width: 1280, height: 720 };
      }
      clipArg = { x: 0, y: 0, width: Math.max(1, Math.ceil(cs.width)), height: Math.max(1, Math.ceil(cs.height)), scale: 1 };
    }
    const { data } = await this.session.send('Page.captureScreenshot', {
      format: type, quality: type === 'jpeg' ? quality : undefined,
      ...(clipArg ? { clip: clipArg, captureBeyondViewport: true } : {}),
      ...(fast && type === 'png' ? { optimizeForSpeed: true } : {}),
    });
    if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(data, 'base64')); }
    return Buffer.from(data, 'base64');
  } finally {
    if (maskId) await this.evalSync(`__vlx.unmask(${JSON.stringify(maskId)})`).catch(() => {});
    if (froze) await this.evalSync('__vlx.unfreezeAnimations()').catch(() => {});
  }
}

const PAPER = { A4: [8.27, 11.69], Letter: [8.5, 11], Legal: [8.5, 14], Tabloid: [11, 17] };

export async function pdf({ path, format = 'A4', landscape = false, printBackground = true, margin, scale = 1, headerTemplate, footerTemplate, preferCSSPageSize = false } = {}) {
  const [w, h] = PAPER[format] || (typeof format === 'object' ? format : PAPER.A4);
  const { data } = await this.session.send('Page.printToPDF', {
    landscape, printBackground, scale, preferCSSPageSize,
    paperWidth: w, paperHeight: h,
    marginTop: margin?.top ?? 0.4, marginBottom: margin?.bottom ?? 0.4,
    marginLeft: margin?.left ?? 0.4, marginRight: margin?.right ?? 0.4,
    displayHeaderFooter: !!(headerTemplate || footerTemplate),
    headerTemplate: headerTemplate || '<span></span>', footerTemplate: footerTemplate || '<span></span>',
  });
  if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(data, 'base64')); }
  return Buffer.from(data, 'base64');
}
