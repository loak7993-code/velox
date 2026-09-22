// velox :: cdp/handles.js — remote-object handles (evaluateHandle / elementHandle)
export class JSHandle {
  constructor(page, objectId, preview) {
    this.page = page;
    this.session = page.session;
    this.objectId = objectId;
    this._preview = preview || 'JSHandle';
    this._disposed = false;
  }
  toString() { return this._preview; }

  /** Evaluate a function with this handle as the first argument. */
  async evaluate(fn, arg) {
    let functionDeclaration;
    const args = [{ objectId: this.objectId }];
    if (typeof fn === 'function') {
      functionDeclaration = `function(el, arg){ return (${fn.toString()})(el, arg) }`;
      args.push({ value: arg ?? null });
    } else {
      functionDeclaration = `function(el){ return (${fn}) }`;
    }
    const { result, exceptionDetails } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration,
      objectId: this.objectId,
      arguments: args,
      returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(`Handle eval error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    return result?.value;
  }

  async jsonValue() {
    const { result } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function(){return this}',
      objectId: this.objectId, returnByValue: true, awaitPromise: false,
    }).catch(() => ({ result: undefined }));
    if (result?.value !== undefined) return result.value;
    // objects: serialize via JSON.stringify inside the page
    const j = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function(){ try { return JSON.stringify(this) } catch (e) { return null } }',
      objectId: this.objectId, returnByValue: true,
    }).catch(() => ({ result: { value: null } }));
    return j.result?.value != null ? JSON.parse(j.result.value) : null;
  }

  async getProperties() {
    const { result } = await this.session.send('Runtime.getProperties', { objectId: this.objectId, ownProperties: true });
    const out = {};
    for (const p of result || []) {
      if (!p.enumerable) continue;
      out[p.name] = p.value?.objectId ? new JSHandle(this.page, p.value.objectId, p.value.description) : p.value?.value;
    }
    return out;
  }

  async getProperty(name) { return (await this.getProperties())[name]; }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    await this.session.send('Runtime.releaseObject', { objectId: this.objectId }).catch(() => {});
  }
}

export class ElementHandle extends JSHandle {
  /** click at the element's center (trusted input) */
  async click({ button = 'left', clicks = 1, modifiers = [], delay = 0 } = {}) {
    const p = await this.point();
    if (!p) throw new Error('Element not visible for click');
    await this.page.mouse.click(p.x, p.y, { button, clicks, modifiers, delay });
    return this.page;
  }
  async point() {
    const { result } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function(){var el=this; if(!el.getBoundingClientRect) return null; var r=el.getBoundingClientRect(); if(r.width===0||r.height===0) return null; var inView=r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0; if(!inView){el.scrollIntoView({block:"center"}); r=el.getBoundingClientRect();} return {x:r.x+r.width/2,y:r.y+r.height/2}}',
      objectId: this.objectId, returnByValue: true,
    });
    return result?.value ?? null;
  }
  async boundingBox() {
    const { result } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: 'function(){var r=this.getBoundingClientRect(); return r?{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}:null}',
      objectId: this.objectId, returnByValue: true,
    });
    return result?.value ?? null;
  }
  async text() { return this.evaluate((el) => (el.textContent || '').trim()); }
  async attr(name) { return this.evaluate((el) => el.getAttribute(name)); }
  async html() { return this.evaluate((el) => el.innerHTML); }
  async fill(value) {
    return this.evaluate((el, v) => {
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, value);
  }
  async type(text, { delay = 0 } = {}) {
    const p = await this.point();
    if (p) await this.page.mouse.click(p.x, p.y);
    await this.page.keyboard.type(text, { delay });
    return this.page;
  }
  async press(key) {
    await this.evaluate((el) => el.focus());
    return this.page.press(key);
  }
  async focus() { return this.evaluate((el) => el.focus()); }
  async scrollIntoView() { return this.evaluate((el) => el.scrollIntoView({ block: 'center' })); }
  /** query inside the element → new handle */
  async $(sel) {
    const { result } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: `function(){ return this.querySelector(${JSON.stringify(sel)}) }`,
      objectId: this.objectId, returnByValue: false,
    });
    if (!result?.objectId) return null;
    return new ElementHandle(this.page, result.objectId, `element(${sel})`);
  }
  async $$(sel) {
    const { result } = await this.session.send('Runtime.callFunctionOn', {
      functionDeclaration: `function(){ return Array.from(this.querySelectorAll(${JSON.stringify(sel)})) }`,
      objectId: this.objectId, returnByValue: false,
    });
    if (!result?.objectId) return [];
    const arr = new JSHandle(this.page, result.objectId, 'array');
    const props = await arr.getProperties();
    await arr.dispose();
    return Object.values(props).filter((h) => h instanceof JSHandle)
      .map((h) => new ElementHandle(this.page, h.objectId, h._preview));
  }
  async contentFrame() {
    const doc = await this.evaluate((el) => (el.tagName === 'IFRAME' ? el.contentDocument : null));
    if (!doc) return null;
    return this.page.frameLocator(this._frameSel || '');
  }
  async screenshot(opts = {}) {
    const box = await this.boundingBox();
    if (!box) throw new Error('No box for element screenshot');
    const [sx, sy] = await this.page.eval('[scrollX, scrollY]');
    return this.page.screenshot({ ...opts, clip: { x: box.x - sx, y: box.y - sy, width: box.width, height: box.height } });
  }
}

/** Serialize for Runtime.evaluate: supports real functions with one Node-side arg. */
export function buildEvalExpr(fnOrExpr, arg) {
  if (typeof fnOrExpr === 'function') {
    return `(${fnOrExpr.toString()})(${JSON.stringify(arg ?? null)})`;
  }
  return fnOrExpr;
}
