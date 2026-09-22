// velox :: cdp/inject.js — the in-page engine, injected once per document.
// Everything (find / wait / point / extract) runs inside the page in ONE
// protocol round-trip. No polling loops over the wire.
//
// Selector syntax:
//   css:            'div.card > a'            (default)
//   xpath:          'xpath=//a[@href]'
//   text:           'text=Sign in'  'text*=sign'  'text^=Sign'  'text$=in'
//   id:             'id=main'      tag=div     nth=3
//   chain (shadow+iframe pierce): 'div.host >> button.primary'
//   filters:        'button:visible'  'a:has-text("read more")'
export const ENGINE_SOURCE = String.raw`
(function () {
  if (window.__vlx) return;
  var V = {};
  var ARGS = function (a) { return a.length === 2 && a[1] && a[1].__vlxRoot ? [a[0], a[1].__vlxRoot] : [a[0], a[1] || document];
  };

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
    want = want.trim().replace(/\s+/g, ' ');
    if (mode === '^') return t.toLowerCase().indexOf(want.toLowerCase()) === 0;
    if (mode === '$') return t.toLowerCase().lastIndexOf(want.toLowerCase()) === t.length - want.length && t.length >= want.length;
    if (mode === '*') return t.toLowerCase().indexOf(want.toLowerCase()) !== -1;
    return t.toLowerCase() === want.toLowerCase();
  }

  // split ":visible" / ":has-text(...)" filters off a css part
  function splitFilters(part) {
    var filters = { visible: false, hasText: null };
    part = part.replace(/:visible\b/g, function () { filters.visible = true; return ''; });
    part = part.replace(/:has-text\((['"])(.*?)\1\)/g, function (_, q, t) { filters.hasText = t; return ''; });
    return [part.trim() || '*', filters];
  }

  function matchPart(root, part) {
    var out = [];
    part = part.trim();
    if (part.indexOf('xpath=') === 0) {
      var it = document.evaluate(part.slice(6), root, null, 7, null);
      var n; while ((n = it.iterateNext())) out.push(n);
      return out;
    }
    var mode = null;
    if (part.indexOf('text*=') === 0) { mode = '*'; part = part.slice(6); }
    else if (part.indexOf('text^=') === 0) { mode = '^'; part = part.slice(6); }
    else if (part.indexOf('text$=') === 0) { mode = '$'; part = part.slice(6); }
    else if (part.indexOf('text=') === 0) { mode = '='; part = part.slice(5); }
    if (mode) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      var el; while ((el = walker.nextNode())) if (textMatch(el, part, mode)) out.push(el);
      // prefer leaf-ish matches: keep smallest elements
      return out;
    }
    if (part.indexOf('id=') === 0) { var byId = root.getElementById ? root.getElementById(part.slice(3)) : null; return byId ? [byId] : []; }
    if (part.indexOf('tag=') === 0) return Array.prototype.slice.call(root.getElementsByTagName(part.slice(4)));
    if (part.indexOf('nth=') === 0) { var ix = +part.slice(4); var all = matchPart(root, arguments[2] || '*'); return all[ix] ? [all[ix]] : []; }

    var cssSel = part, filters;
    var split = splitFilters(cssSel); cssSel = split[0]; filters = split[1];
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
    function scanScope(scope, querySelf) {
      if (!scope) return;
      if (querySelf) matchPart(scope, part).forEach(function (e) { if (out.indexOf(e) === -1) out.push(e); });
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

  V.match = function (sel, root) {
    root = root || document;
    var parts = String(sel).split(/\s*>>\s*/);
    var cur = [root];
    for (var i = 0; i < parts.length; i++) {
      var next = [];
      for (var j = 0; j < cur.length; j++) {
        var found = (parts.length > 1) ? deepMatch(cur[j], parts[i]) : matchPart(cur[j], parts[i]);
        for (var k = 0; k < found.length; k++) if (next.indexOf(found[k]) === -1) next.push(found[k]);
      }
      cur = next;
      if (!cur.length) return [];
    }
    return cur;
  };
  V.all = function (sel, root) { return V.match(sel, root); };
  V.one = function (sel, root) { var m = V.match(sel, root); return m.length ? m[0] : null; };
  V.count = function (sel, root) { return V.match(sel, root).length; };
  V.exists = function (sel, root) { return V.count(sel, root) > 0; };

  // wait with MutationObserver + rAF: resolves true on found, 'timeout' on expiry (never throws)
  V.wait = function (sel, timeout, state, root) {
    state = state || 'visible';
    function ok() {
      var m = V.match(sel, root);
      if (!m.length) return false;
      if (state === 'attached') return true;
      if (state === 'hidden') return false;
      for (var i = 0; i < m.length; i++) if (visible(m[i])) return true;
      return state === 'any';
    }
    return new Promise(function (resolve) {
      if (ok()) return resolve(true);
      var done = false, t0 = Date.now();
      function finish(v) { if (done) return; done = true; mo.disconnect(); clearInterval(poll); resolve(v); }
      var mo = new MutationObserver(function () { if (ok()) finish(true); });
      try {
        mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch (e) {}
      var poll = setInterval(function () {
        if (ok()) return finish(true);
        if (Date.now() - t0 > (timeout || 10000)) finish('timeout');
      }, 60);
    });
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

  V.rect = function (sel, root) { var el = V.one(sel, root); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };

  // center point of first visible match, scrolled into view
  V.point = function (sel, root) {
    var m = V.match(sel, root);
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
  V.extract = function (sel, spec) {
    spec = spec || {};
    var m = V.match(sel);
    if (spec.limit) m = m.slice(0, spec.limit);
    return m.map(function (el) {
      var o = {};
      if (spec.text) o.text = (el.textContent || '').trim();
      if (spec.ownText) o.ownText = Array.prototype.map.call(el.childNodes, function (n) { return n.nodeType === 3 ? n.textContent : ''; }).join('').trim();
      if (spec.html) o.html = el.innerHTML;
      if (spec.outerHtml) o.outerHtml = el.outerHTML;
      if (spec.tag) o.tag = el.tagName.toLowerCase();
      if (spec.value !== false && ('value' in el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) o.value = el.value;
      if (spec.attrs) for (var i = 0; i < spec.attrs.length; i++) o[spec.attrs[i]] = el.getAttribute(spec.attrs[i]);
      return o;
    });
  };

  V.texts = function (sel, limit) { return V.extract(sel, { text: true, limit: limit }).map(function (o) { return o.text; }); };
  V.attrs = function (sel, name, limit) { return V.extract(sel, { attrs: [name], limit: limit }).map(function (o) { return o[name]; }); };
  V.attr = function (sel, name, root) { var m = V.match(sel, root); return m.length ? m[0].getAttribute(name) : null; };
  V.text = function (sel, root) { var m = V.match(sel, root); return m.length ? (m[0].textContent || '').trim() : null; };
  V.html = function (sel, root) { var m = V.match(sel, root); return m.length ? m[0].innerHTML : null; };
  V.val = function (sel, root) { var m = V.match(sel, root); return m.length ? m[0].value : null; };

  V.fill = function (sel, value, root) {
    var el = V.one(sel, root); if (!el) return false;
    el.focus();
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  V.focus = function (sel, root) { var el = V.one(sel, root); if (el) { el.focus(); return true; } return false; };
  V.remove = function (sel, root) { V.match(sel, root).forEach(function (el) { el.remove(); }); };
  V.clickInPage = function (sel, root) { var el = V.one(sel, root); if (el) { el.click(); return true; } return false; };
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

  // exposed-binding plumbing (see Page.expose)
  V._bound = {};
  V._resolveBound = function (name, id, result) {
    var rec = V._bound[name] && V._bound[name][id];
    if (rec) { delete V._bound[name][id]; rec(result); }
  };

  window.__vlx = V;
})();
`;

export const ENGINE_CHECK = `typeof window.__vlx === 'object'`;
export function ensureEngineExpr() { return `(window.__vlx || (${ENGINE_SOURCE}, window.__vlx))`; }
