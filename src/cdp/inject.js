// velox :: cdp/inject.js — the in-page engine, injected once per document.
// Everything (find / wait / point / extract / element state) runs inside the
// page in ONE protocol round-trip. No polling loops over the wire.
//
// Selector syntax:
//   css:            'div.card > a'            (default)
//   xpath:          'xpath=//a[@href]'
//   text:           'text=Sign in'  'text*=sign'  'text^=Sign'  'text$=in'
//   role:           'role=button'  'role=button@Sign in'  'role=button@=Exact'   (@= exact)
//   label:          'label=Email'   placeholder=Search   alt=Logo   title=Close
//   testid:         'testid=submit'            (attr configurable: V.testIdAttr)
//   id:             'id=main'      tag=div     nth=3
//   chain (shadow+iframe pierce): 'div.host >> button.primary'
//   filters:        'button:visible'  'a:has-text("read more")'
import { compactSource } from '../util.js';
export const ENGINE_SOURCE_RAW = String.raw`
(function () {
  if (window.__vlx) return;
  var V = {};
  V.testIdAttr = 'data-testid';

  function visible(el) {
    if (!el.isConnected) return false;
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function textMatch(el, want, mode) {
    var t = (el.childElementCount ? Array.prototype.map.call(el.childNodes, function (n) {
      return n.nodeType === 3 ? n.textContent : '';
    }).join('') : el.textContent) || '';
    t = t.trim().replace(/\s+/g, ' ');
    want = String(want).trim().replace(/\s+/g, ' ');
    if (mode === '^') return t.toLowerCase().indexOf(want.toLowerCase()) === 0;
    if (mode === '$') return t.toLowerCase().lastIndexOf(want.toLowerCase()) === t.length - want.length && t.length >= want.length;
    if (mode === '*') return t.toLowerCase().indexOf(want.toLowerCase()) !== -1;
    return t.toLowerCase() === want.toLowerCase();
  }
  function strMatch(have, want, exact) {
    if (have == null) return false;
    have = String(have).trim(); want = String(want).trim();
    if (exact) return have === want;
    return have.toLowerCase().indexOf(want.toLowerCase()) !== -1;
  }

  /* ---------------- accessibility roles & names (for role=/label=) ---------------- */
  function accRole(el) {
    var r = el.getAttribute('role');
    if (r) return r.trim().split(/\s+/)[0].toLowerCase();
    var t = el.tagName.toLowerCase();
    if (t === 'a') return el.getAttribute('href') != null ? 'link' : 'generic';
    if (t === 'input') {
      var ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'text' || ty === 'email' || ty === 'tel' || ty === 'url' || ty === 'password' || ty === '') return 'textbox';
      return { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', search: 'searchbox', number: 'spinbutton', range: 'slider', image: 'button' }[ty] || 'textbox';
    }
    if (t === 'select') return el.hasAttribute('multiple') ? 'listbox' : 'combobox';
    return { button: 'button', textarea: 'textbox', img: 'img', form: 'form', nav: 'navigation', main: 'main', aside: 'complementary', header: 'banner', footer: 'contentinfo', ul: 'list', ol: 'list', li: 'listitem', table: 'table', fieldset: 'group', datalist: 'listbox', option: 'option', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', details: 'group', summary: 'button' }[t] || null;
  }
  function accName(el) {
    var s = el.getAttribute('aria-label'); if (s && s.trim()) return s.trim();
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var t = lb.split(/\s+/).map(function (id) { return document.getElementById(id); }).filter(Boolean)
        .map(function (e) { return (e.textContent || '').trim(); }).join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      try { var l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) return (l.textContent || '').trim(); } catch (e) {}
    }
    var pl = el.closest ? el.closest('label') : null; if (pl) return (pl.textContent || '').trim();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      var p = el.getAttribute('placeholder'); if (p) return p;
      if (el.type === 'submit' || el.type === 'button') return el.value || '';
    }
    var ti = el.getAttribute('title'); if (ti) return ti;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return '';
    return (el.textContent || '').trim().replace(/\s+/g, ' ');
  }
  function labelOf(el) {
    if (el.id) {
      try { var l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'); if (l) return (l.textContent || '').trim(); } catch (e) {}
    }
    var pl = el.closest ? el.closest('label') : null; if (pl) return (pl.textContent || '').trim();
    return null;
  }
  function allElems(root) {
    return Array.prototype.slice.call(root.getElementsByTagName('*'));
  }
  function formControls(root) {
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    var el;
    while ((el = walker.nextNode())) {
      var t = el.tagName;
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'BUTTON' || el.isContentEditable) out.push(el);
    }
    return out;
  }

  /* ---------------- selector parsing ---------------- */
  function splitFilters(part) {
    var filters = { visible: false, hasText: null };
    part = part.replace(/:visible\b/g, function () { filters.visible = true; return ''; });
    part = part.replace(/:has-text\((['"])(.*?)\1\)/g, function (_, q, t) { filters.hasText = t; return ''; });
    return [part.trim() || '*', filters];
  }

  V.custom = {};   // user-registered selector engines: name → fn(value, root) → elements

  function matchPart(root, part) {
    var out = [];
    part = String(part).trim();
    // custom engine: "name=value" (registered via page.addSelectorEngine)
    var eq = part.indexOf('=');
    if (eq > 0 && V.custom[part.slice(0, eq)]) {
      try {
        var res = V.custom[part.slice(0, eq)](part.slice(eq + 1), root);
        return Array.prototype.slice.call(res || []);
      } catch (e) { return []; }
    }
    if (part.indexOf('xpath=') === 0) {
      var it = document.evaluate(part.slice(6), root, null, 7, null);
      var n; while ((n = it.iterateNext())) out.push(n);
      return out;
    }
    var mode = null;
    if (part.indexOf('text*=') === 0) { mode = '*'; part = part.slice(6); }
    else if (part.indexOf('text^=') === 0) { mode = '^'; part = part.slice(6); }
    else if (part.indexOf('text$=') === 0) { mode = '$'; part = part.slice(6); }
    else if (part.indexOf('text==') === 0) { mode = '='; part = part.slice(6); }
    else if (part.indexOf('text=') === 0) { mode = '*'; part = part.slice(5); }
    if (mode) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      var el;
      var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
      while ((el = walker.nextNode())) {
        if (SKIP[el.tagName]) continue;
        if (textMatch(el, part, mode)) out.push(el);
      }
      return out;
    }
    // role=button | role=button@Name | role=button@=ExactName
    function decVal(t) { t = t.replace(/\\(.)/g, '$1'); try { return decodeURIComponent(t); } catch (e) { return t; } }
    var rm = part.match(/^role=([a-zA-Z-]+)(?:@(=?)((?:\\.|[^@])*))?$/);
    if (rm) {
      var wantRole = rm[1].toLowerCase(), exact = rm[2] === '=';
      var wantName = rm[3] != null ? decVal(rm[3]) : null;
      return allElems(root).filter(function (el) {
        var r = accRole(el); if (!r || r !== wantRole) return false;
        if (wantName == null) return true;
        return strMatch(accName(el), wantName, exact);
      });
    }
    if (part.indexOf('label==') === 0) { var lv0 = decVal(part.slice(7)); return formControls(root).filter(function (el) { var l = labelOf(el); return l != null && l === lv0; }); }
    if (part.indexOf('label=') === 0) { var lv1 = decVal(part.slice(6)); return formControls(root).filter(function (el) { var l = labelOf(el); return l != null && l.toLowerCase().indexOf(lv1.toLowerCase()) !== -1; }); }
    if (part.indexOf('placeholder==') === 0) { var pv0 = decVal(part.slice(13)); return allElems(root).filter(function (el) { return el.getAttribute('placeholder') === pv0; }); }
    if (part.indexOf('placeholder=') === 0) { var pv1 = decVal(part.slice(12)); return allElems(root).filter(function (el) { var p = el.getAttribute('placeholder'); return p != null && p.toLowerCase().indexOf(pv1.toLowerCase()) !== -1; }); }
    if (part.indexOf('alt==') === 0) { var av0 = decVal(part.slice(5)); return allElems(root).filter(function (el) { return (el.tagName === 'IMG' || el.tagName === 'AREA') && el.getAttribute('alt') === av0; }); }
    if (part.indexOf('alt=') === 0) { var av1 = decVal(part.slice(4)); return allElems(root).filter(function (el) { var a = el.getAttribute('alt'); return a != null && a.toLowerCase().indexOf(av1.toLowerCase()) !== -1; }); }
    if (part.indexOf('title==') === 0) { var tv0 = decVal(part.slice(7)); return allElems(root).filter(function (el) { return el.getAttribute('title') === tv0; }); }
    if (part.indexOf('title=') === 0) { var tv1 = decVal(part.slice(6)); return allElems(root).filter(function (el) { var t = el.getAttribute('title'); return t != null && t.toLowerCase().indexOf(tv1.toLowerCase()) !== -1; }); }
    if (part.indexOf('testid=') === 0) {
      var tv = decVal(part.slice(7));
      return allElems(root).filter(function (el) { return el.getAttribute(V.testIdAttr) === tv; });
    }
    if (part.indexOf('id=') === 0) { var byId = root.getElementById ? root.getElementById(part.slice(3)) : null; return byId ? [byId] : []; }
    if (part.indexOf('tag=') === 0) return Array.prototype.slice.call(root.getElementsByTagName(part.slice(4)));
    if (part.indexOf('nth=') === 0) { var ix = +part.slice(4); var all = matchPart(root, '*'); return all[ix] ? [all[ix]] : []; }

    var cssSel = part, filters;
    var split = V._cachedFilters(cssSel); cssSel = split[0]; filters = split[1];
    var els;
    try { els = Array.prototype.slice.call(root.querySelectorAll(cssSel)); }
    catch (e) { return out; }
    if (filters.visible) els = els.filter(visible);
    if (filters.hasText != null) els = els.filter(function (el) { return (el.textContent || '').toLowerCase().indexOf(filters.hasText.toLowerCase()) !== -1; });
    return els;
  }

  // deep query: pierce shadow roots of everything under root (and root's own shadow root)
  function deepMatch(root, part) {
    var out = matchPart(root, part).slice();
    var seen = new Set(out);
    function scanScope(scope, querySelf) {
      if (!scope) return;
      if (querySelf) matchPart(scope, part).forEach(function (e) { if (!seen.has(e)) { seen.add(e); out.push(e); } });
      var walk;
      try { walk = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT); } catch (e) { return; }
      var el;
      while ((el = walk.nextNode())) {
        if (el.shadowRoot) scanScope(el.shadowRoot, true);
        if (el.tagName === 'IFRAME') { try { if (el.contentDocument) scanScope(el.contentDocument, true); } catch (e) {} }
      }
    }
    scanScope(root.nodeType === 9 ? root.documentElement : root, false);
    if (root.shadowRoot) scanScope(root.shadowRoot, true);
    return out;
  }

  // selector parsing is cached — the hot loop (extract / wait / click point) re-uses
  // the parsed parts instead of re-splitting and re-parsing the same strings
  V._parseCache = {};
  V._split = function (sel) {
    var c = V._parseCache[sel];
    if (!c) { c = String(sel).split(/\s*>>\s*/); V._parseCache[sel] = c; }
    return c;
  };
  V._filterCache = {};
  V._cachedFilters = function (sel) {
    var c = V._filterCache[sel];
    if (!c) { c = splitFilters(sel); V._filterCache[sel] = c; }
    return c;
  };

  V.match = function (sel, root) {
    root = root || document;
    if (sel && typeof sel === 'object') return [sel];
    var parts = V._split(sel);
    var cur = [root];
    for (var i = 0; i < parts.length; i++) {
      var next = [];
      var seen = new Set();
      for (var j = 0; j < cur.length; j++) {
        var found = (parts.length > 1) ? deepMatch(cur[j], parts[i]) : matchPart(cur[j], parts[i]);
        for (var k = 0; k < found.length; k++) if (!seen.has(found[k])) { seen.add(found[k]); next.push(found[k]); }
      }
      cur = next;
      if (!cur.length) return [];
    }
    return cur;
  };
  V.all = V.match;
  V.one = function (sel, root) { var m = V.match(sel, root); return m.length ? m[0] : null; };

  // pick with locator filters: {index (neg ok), hasText, has, visible}
  function applyFilters(m, opts) {
    if (!opts) return m;
    if (opts.visible) m = m.filter(visible);
    if (opts.hasText != null) m = m.filter(function (el) { return (el.textContent || '').toLowerCase().indexOf(String(opts.hasText).toLowerCase()) !== -1; });
    if (opts.has) m = m.filter(function (el) {
      try { return el.querySelector(opts.has) != null; } catch (e) { return false; }
    });
    return m;
  }
  V.pick = function (sel, opts) {
    var m = applyFilters(V.match(sel), opts);
    if (opts && opts.index != null) {
      var i = opts.index < 0 ? m.length + opts.index : opts.index;
      return m[i] || null;
    }
    return m[0] || null;
  };
  V.pickCount = function (sel, opts) { return applyFilters(V.match(sel), opts).length; };

  var resolve = function (x, root) { return (x && typeof x === 'object') ? x : V.one(x, root); };

  V.count = function (sel, root) { return V.match(sel, root).length; };
  V.exists = function (sel, root) { return V.count(sel, root) > 0; };

  // wait with MutationObserver: resolves true on found, 'timeout' on expiry (never throws)
  function waitOn(pickFn, timeout, state) {
    state = state || 'visible';
    function ok() {
      var el = pickFn();
      if (!el) return false;
      if (state === 'attached') return true;
      if (state === 'hidden') return false;
      return visible(el);
    }
    return new Promise(function (resolve) {
      if (ok()) return resolve(true);
      var done = false, t0 = Date.now();
      function finish(v) { if (done) return; done = true; mo.disconnect(); clearInterval(poll); resolve(v); }
      var mo = new MutationObserver(function () { if (ok()) finish(true); });
      try { mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) {}
      var poll = setInterval(function () {
        if (ok()) return finish(true);
        if (Date.now() - t0 > (timeout || 10000)) finish('timeout');
      }, 60);
    });
  }
  V.wait = function (sel, timeout, state, root) {
    return waitOn(function () { return V.one(sel, root); }, timeout, state);
  };
  V.waitPick = function (sel, opts, timeout, state) {
    return waitOn(function () { return V.pick(sel, opts); }, timeout, state);
  };

  // wait for arbitrary JS expr to be truthy (polled in-page)
  V.waitExpr = function (expr, timeout) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function check() {
        var v;
        try { v = Function('"use strict"; return (' + expr + ');')(); } catch (e) { return reject(new Error(e.message)); }
        if (v) return resolve(v);
        if (Date.now() - t0 > (timeout || 10000)) return reject(new Error('waitExpr timeout: ' + expr));
        setTimeout(check, 50);
      })();
    });
  };

  V.rect = function (sel, root) { var el = resolve(sel, root); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };

  // center point of first visible match, scrolled into view
  V.point = function (sel, root) {
    var m = (sel && typeof sel === 'object') ? [sel] : V.match(sel, root);
    for (var i = 0; i < m.length; i++) {
      var el = m[i];
      if (!visible(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var inView = r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
      if (!inView) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  };

  // batch extraction in ONE round-trip: {text, attrs, html, value, tag, ownText, limit}
  V.extract = function (sel, spec, root) {
    spec = spec || {};
    var m = (sel && typeof sel === 'object') ? [sel] : V.match(sel, root);
    if (spec.limit) m = m.slice(0, spec.limit);
    return m.map(function (el) {
      var o = {};
      if (spec.text) o.text = (el.textContent || '').trim();
      if (spec.ownText) o.ownText = Array.prototype.map.call(el.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : ''; }).join('').trim();
      if (spec.html) o.html = el.innerHTML;
      if (spec.outerHtml) o.outerHtml = el.outerHTML;
      if (spec.tag) o.tag = el.tagName.toLowerCase();
      if (spec.checked !== false && 'checked' in el) o.checked = !!el.checked;
      if (spec.value !== false && ('value' in el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) o.value = el.value;
      if (spec.attrs) for (var i = 0; i < spec.attrs.length; i++) o[spec.attrs[i]] = el.getAttribute(spec.attrs[i]);
      return o;
    });
  };

  V.texts = function (sel, limit, root) { return V.extract(sel, { text: true, limit: limit }, root).map(function (o) { return o.text; }); };
  V.attrs = function (sel, name, limit, root) { return V.extract(sel, { attrs: [name], limit: limit }, root).map(function (o) { return o[name]; }); };
  V.attr = function (sel, name, root) { var el = resolve(sel, root); return el ? el.getAttribute(name) : null; };
  V.text = function (sel, root) { var el = resolve(sel, root); return el ? (el.textContent || '').trim() : null; };
  V.html = function (sel, root) { var el = resolve(sel, root); return el ? el.innerHTML : null; };
  V.val = function (sel, root) { var el = resolve(sel, root); return el ? el.value : null; };

  /* ---------------- form element state & ops ---------------- */
  V.states = function (sel, root) {
    var el = resolve(sel, root); if (!el) return null;
    return {
      visible: visible(el),
      checked: 'checked' in el ? !!el.checked : null,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      readonly: !!el.readOnly,
      editable: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? !el.disabled && !el.readOnly : !el.disabled && el.isContentEditable === true,
      required: !!el.required,
      expanded: el.getAttribute('aria-expanded') === 'true',
      selected: 'selected' in el ? !!el.selected : null,
    };
  };
  V.setChecked = function (sel, state, root) {
    var el = resolve(sel, root); if (!el) return false;
    if ('checked' in el && !!el.checked !== !!state) el.click();
    return true;
  };
  V.selectOption = function (sel, wanted, root) {
    var el = resolve(sel, root); if (!el || el.tagName !== 'SELECT') return null;
    var list = Array.isArray(wanted) ? wanted : [wanted];
    var chosen = [];
    el.querySelectorAll('option').forEach(function (opt) {
      var hit = list.some(function (w) {
        if (w == null) return false;
        if (typeof w === 'object') {
          if (w.value !== undefined && opt.value !== String(w.value)) return false;
          if (w.label !== undefined && opt.textContent.trim() !== String(w.label)) return false;
          if (w.index !== undefined && opt.index !== w.index) return false;
          return true;
        }
        return opt.value === String(w) || opt.textContent.trim() === String(w);
      });
      if (el.multiple) opt.selected = hit;
      else if (hit) el.value = opt.value;
      if (hit) chosen.push(opt.value);
    });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return chosen;
  };
  V.selectText = function (sel, root) {
    var el = resolve(sel, root); if (!el) return false;
    if (el.select) { el.select(); return true; }
    var rng = document.createRange(); rng.selectNodeContents(el);
    var sel2 = getSelection(); sel2.removeAllRanges(); sel2.addRange(rng);
    return true;
  };

  V.fill = function (sel, value, root) {
    var el = resolve(sel, root); if (!el) return false;
    el.focus();
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  V.focus = function (sel, root) { var el = resolve(sel, root); if (el) { el.focus(); return true; } return false; };
  V.blur = function (sel, root) { var el = resolve(sel, root); if (el) { el.blur(); return true; } return false; };
  V.remove = function (sel, root) { V.match(sel, root).forEach(function (el) { el.remove(); }); };
  V.clickInPage = function (sel, root) { var el = resolve(sel, root); if (el) { el.click(); return true; } return false; };
  V.scrollIntoView = function (sel, root) { var el = resolve(sel, root); if (el) { el.scrollIntoView({ block: 'center' }); return true; } return false; };
  V.scrollBy = function (x, y) { scrollBy(x, y); return [scrollX, scrollY]; };
  V.scrollTop = function () { return [scrollX, scrollY, document.documentElement.scrollHeight, document.documentElement.scrollHeight > innerHeight]; };
  V.storage = function () {
    var o = { local: {}, session: {} };
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o.local[k] = localStorage.getItem(k); } } catch (e) {}
    try { for (var j = 0; j < sessionStorage.length; j++) { var k2 = sessionStorage.key(j); o.session[k2] = sessionStorage.getItem(k2); } } catch (e) {}
    return o;
  };
  V.restoreStorage = function (data) {
    try {
      localStorage.clear();
      Object.keys(data.local || {}).forEach(function (k) { localStorage.setItem(k, data.local[k]); });
      sessionStorage.clear();
      Object.keys(data.session || {}).forEach(function (k) { sessionStorage.setItem(k, data.session[k]); });
    } catch (e) { return false; }
    return true;
  };

  /* ---------------- screenshot helpers: masks + animation freeze ---------------- */
  V._maskId = 0;
  V.mask = function (selectors) {
    var id = 'vlx-mask-' + (++V._maskId);
    var style = document.createElement('style');
    style.id = id + '-style';
    style.textContent = '.vlx-mask{position:fixed!important;z-index:2147483647!important;background:#ff00ff!important;color:#ff00ff!important;border-radius:0!important;box-shadow:none!important;outline:0!important}';
    document.documentElement.appendChild(style);
    var els = [];
    (selectors || []).forEach(function (sel) {
      V.match(sel).forEach(function (el) {
        var r = el.getBoundingClientRect();
        var d = document.createElement('div');
        d.className = 'vlx-mask';
        d.style.left = r.x + 'px'; d.style.top = r.y + 'px';
        d.style.width = r.width + 'px'; d.style.height = r.height + 'px';
        document.documentElement.appendChild(d);
        els.push(d);
      });
    });
    return id;
  };
  V.unmask = function (id) {
    document.querySelectorAll('.vlx-mask').forEach(function (d) { d.remove(); });
    var st = document.getElementById(id + '-style'); if (st) st.remove();
    return true;
  };
  V.freezeAnimations = function () {
    var st = document.createElement('style');
    st.id = 'vlx-anim-freeze';
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    document.documentElement.appendChild(st);
    return true;
  };
  V.unfreezeAnimations = function () { var st = document.getElementById('vlx-anim-freeze'); if (st) st.remove(); return true; };

  /* ---------------- aria snapshot (simplified YAML-ish) ---------------- */
  V.ariaSnapshot = function (sel) {
    function snap(el, depth) {
      var out = '';
      // include the anchor element itself, then descendants
      var els = [el].concat(allElems(el));
      els.forEach(function (e) {
        if (e !== el && (!visible(e) && accRole(e) !== 'heading')) return;
        var r = accRole(e); if (!r || r === 'generic' || r === 'presentation') return;
        var n = accName(e);
        var line = '- ' + r + (n ? ' "' + n.replace(/\s+/g, ' ').slice(0, 80) + '"' : '');
        out += '  '.repeat(depth) + line + '\n';
      });
      return out;
    }
    var el = sel ? resolve(sel) : document.body;
    return el ? snap(el, 0) : '';
  };

  // register a custom selector engine (used by Page.addSelectorEngine)
  V.defineEngine = function (name, fnSource) {
    V.custom[name] = (0, eval)('(' + fnSource + ')');
    return true;
  };

  // pre-parse selectors so later actions skip the parsing cost entirely
  V.warm = function (selectors) {
    (selectors || []).forEach(function (s) { V._split(s); splitFilters(String(s)); });
    return (selectors || []).length;
  };

  // exposed-binding plumbing (see Page.expose)
  V._bound = {};
  V._resolveBound = function (name, id, result) {
    var rec = V._bound[name] && V._bound[name][id];
    if (rec) { delete V._bound[name][id]; rec(result); }
  };

  window.__vlx = V;
})();
`;

/** Readable source kept for debugging; pages receive the compacted form. */
export const ENGINE_SOURCE = compactSource(ENGINE_SOURCE_RAW);


export const ENGINE_CHECK = `typeof window.__vlx === 'object'`;
