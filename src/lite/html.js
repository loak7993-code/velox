// velox :: lite/html.js — from-scratch HTML parser + mini DOM + CSS subset selectors.
// No dependencies, no browser. Good enough to scrape the majority of the web.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C', eacute: 'é', egrave: 'è' };
export function decodeEntities(s = '') {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] || m;
  });
}

function splitTopCommas(sel) {
  const parts = []; let depth = 0, cur = '', q = null;
  for (const ch of sel) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

class Node {
  constructor(tag, attrs = {}, parent = null) { this.tag = tag; this.attrs = attrs; this.parent = parent; this.children = []; }
  get classes() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  *walk() { yield this; for (const c of this.children) if (c instanceof Node) yield* c.walk(); }
  selectAll(sel) {
    if (sel.includes(',')) {
      const seen = new Set(); const out = [];
      for (const part of splitTopCommas(sel)) for (const n of this.selectAll(part)) if (!seen.has(n)) { seen.add(n); out.push(n); }
      return out;
    }
    const chain = compile(sel);
    const out = [];
    for (const n of this.walk()) {
      if (n === this) continue;
      if (matchChain(n, chain, chain.length - 1)) out.push(n);
    }
    return out;
  }
  select(sel) { return this.selectAll(sel)[0] || null; }
  textContent({ skipHidden = true } = {}) {
    let out = '';
    for (const c of this.children) {
      if (c instanceof Node) { if (RAW.has(c.tag)) continue; out += c.textContent() + ' '; }
      else out += c + ' ';
    }
    return out.replace(/\s+/g, ' ').trim();
  }
}

export function parse(html) {
  const root = new Node('#root');
  let cur = root;
  let i = 0;
  const len = html.length;
  const pushText = (t) => { if (t) cur.children.push(decodeEntities(t)); };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt); i = end === -1 ? len : end + 3; continue; }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) { const end = html.indexOf('>', lt); i = end === -1 ? len : end + 1; continue; }

    // closing tag
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? len : end).trim().toLowerCase();
      if (RAW.has(name)) {
        // raw text containers close properly; find the matching close
        let close = html.toLowerCase().indexOf('</' + name, lt);
        if (close === -1) close = len;
        const end2 = html.indexOf('>', close);
        i = end2 === -1 ? len : end2 + 1;
      } else i = (end === -1 ? len : end + 1);
      // pop to matching
      let n = cur;
      while (n && n.tag !== name && n.tag !== '#root') n = n.parent;
      if (n && n.tag === name) cur = n.parent || root;
      continue;
    }

    // opening tag
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/.exec(html.slice(lt, lt + 4000));
    if (!m) { cur.children.push('<'); i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);
    const selfClose = m[3] === '/' || VOID.has(tag);
    const node = new Node(tag, attrs, cur);
    cur.children.push(node);
    i = lt + m[0].length;

    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf('</' + tag, i);
      const raw = html.slice(i, close === -1 ? len : close);
      node.children.push(raw); // keep raw (scripts/json-ld verbatim)
      if (close !== -1) { const end = html.indexOf('>', close); i = end === -1 ? len : end + 1; }
      continue;
    }
    if (!selfClose) cur = node;
  }
  return new Doc(root, html);
}

function parseAttrs(s = '') {
  const attrs = {};
  const re = /([a-zA-Z_:@#\-\.\[\]\(\)]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1].toLowerCase();
    attrs[name] = m[2] === undefined ? '' : (m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/* --------------------------------------------- selectors --------------------------------------------- */

const COMPOUND = /[a-zA-Z][\w-]*|\*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g;

function matchCompound(node, part) {
  if (part === '*') return true;
  let ok = true;
  for (const tok of part.match(COMPOUND) || []) {
    if (tok === '*') continue;
    if (tok[0] === '.') { if (!node.classes.includes(tok.slice(1))) { ok = false; break; } }
    else if (tok[0] === '#') { if (node.attrs.id !== tok.slice(1)) { ok = false; break; } }
    else if (tok[0] === '[') {
      const am = /^\[\s*([^\]~^$*|=]+)\s*(?:([~^$*|]?=)\s*(.+?)\s*)?\]$/.exec(tok);
      if (!am) { ok = false; break; }
      const [, name, op, valRaw] = am;
      const have = node.attrs[name.toLowerCase()];
      const val = valRaw ? valRaw.replace(/^["']|["']$/g, '') : undefined;
      if (have === undefined) { ok = false; break; }
      if (op) {
        const v = String(have);
        if (op === '=') ok = v === val;
        else if (op === '^=') ok = v.startsWith(val);
        else if (op === '$=') ok = v.endsWith(val);
        else if (op === '*=') ok = v.includes(val);
        else if (op === '~=') ok = v.split(/\s+/).includes(val);
        else if (op === '|=') ok = v === val || v.startsWith(val + '-');
        if (!ok) break;
      }
    }
    else if (node.tag !== tok.toLowerCase()) { ok = false; break; }
  }
  return ok;
}

function matchChain(node, chain, idx) {
  if (!matchCompound(node, chain[idx])) return false;
  if (idx === 0) return true;
  const comb = chain.combinators[idx - 1];
  if (comb === '>') return node.parent && matchChain(node.parent, chain, idx - 1);
  let p = node.parent;
  while (p && p.tag !== '#root') { if (matchChain(p, chain, idx - 1)) return true; p = p.parent; }
  return false;
}

function compile(sel) {
  const chain = [];
  const combinators = [];
  let buf = '', comb = null;
  for (const ch of sel.trim()) {
    if (/\s/.test(ch)) {
      if (buf) { chain.push(buf); buf = ''; combinators.push(comb || ' '); comb = null; }
      else if (!combinators.length) comb = comb || ' ';
    } else if (ch === '>') { comb = '>'; }
    else { if (comb && buf) { chain.push(buf); buf = ''; combinators.push(comb); comb = null; } buf += ch; }
  }
  if (buf) chain.push(buf);
  // trailing combinators cleanup
  while (combinators.length >= chain.length) combinators.pop();
  chain.combinators = combinators;
  return chain;
}

/* ------------------------------------------------ document --------------------------------------------- */

export class Doc {
  constructor(root, source) { this.root = root; this.source = source; }
  *nodes() { for (const n of this.root.walk()) if (n.tag !== '#root') yield n; }
  selectAll(sel) {
    if (sel.includes(',')) {
      const seen = new Set(); const out = [];
      for (const part of splitTopCommas(sel)) for (const n of this.selectAll(part)) if (!seen.has(n)) { seen.add(n); out.push(n); }
      return out;
    }
    const chain = compile(sel);
    const out = [];
    for (const n of this.nodes()) if (matchChain(n, chain, chain.length - 1)) out.push(n);
    return out;
  }
  select(sel) { return this.selectAll(sel)[0] || null; }
  text(sel) { const n = this.select(sel); return n ? n.textContent() : null; }
  attr(sel, name) { const n = this.select(sel); return n ? (n.attrs[name.toLowerCase()] ?? null) : null; }
  html(sel) { const n = this.select(sel); return n ? this._serialize(n) : null; }

  _serialize(node) {
    if (node.tag === '#root') return node.children.map((c) => this._serialize(c)).join('');
    let attrs = Object.entries(node.attrs).map(([k, v]) => v === '' ? k : `${k}="${v}"`).join(' ');
    attrs = attrs ? ' ' + attrs : '';
    if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
    const inner = node.children.map((c) => (c instanceof Node ? this._serialize(c) : c)).join('');
    return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
  }

  title() { return this.text('title'); }
  meta() {
    const o = { title: this.title() };
    for (const n of this.selectAll('meta')) {
      const k = n.attrs.name || n.attrs.property;
      if (k) o[k] = n.attrs.content || '';
    }
    for (const n of this.selectAll('link[rel]')) {
      const r = n.attrs.rel;
      if (/canonical|alternate/.test(r)) o['link_' + r] = n.attrs.href || '';
    }
    return o;
  }
  links(base) {
    return this.selectAll('a[href]').map((n) => ({ text: n.textContent(), href: resolveUrl(n.attrs.href, base || this._baseUrl()) })).filter((l) => l.href);
  }
  images(base) {
    return this.selectAll('img').map((n) => ({ src: resolveUrl(n.attrs.src || n.attrs['data-src'], base || this._baseUrl()), alt: n.attrs.alt || '', width: n.attrs.width, height: n.attrs.height }));
  }
  tables() {
    return this.selectAll('table').map((t) => {
      const rows = t.selectAll('tr').map((tr) => tr.selectAll('td,th').map((td) => td.textContent()));
      const headers = rows[0]?.length && t.select('th') ? rows.shift() : [];
      return { headers, rows };
    });
  }  forms() {
    return this.selectAll('form').map((f) => ({
      action: f.attrs.action || '', method: (f.attrs.method || 'get').toLowerCase(),
      fields: f.selectAll('input,select,textarea,button').map((e) => ({ tag: e.tag, name: e.attrs.name || '', type: e.attrs.type || e.tag, value: e.attrs.value || '', required: e.attrs.required !== undefined })),
    }));
  }
  jsonld() {
    const out = [];
    for (const n of this.selectAll('script[type="application/ld+json"]')) {
      try { out.push(JSON.parse(n.children[0] || '{}')); } catch {}
    }
    return out;
  }
  readable() {
    const body = this.select('body') || this.root;
    let out = '';
    for (const n of body.walk()) {
      if (!(n instanceof Node)) continue;
      if (/^h[1-6]$/.test(n.tag)) { const d = +n.tag[1]; out += '\n\n' + '#'.repeat(d) + ' ' + n.textContent() + '\n\n'; }
      else if (n.tag === 'p') out += '\n' + n.textContent() + '\n';
      else if (n.tag === 'li') out += '\n- ' + n.textContent();
      else if (n.tag === 'br') out += '\n';
      else if (n.tag === 'img' && n.attrs.alt) out += ` [img: ${n.attrs.alt}] `;
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }
  _baseUrl() {
    return this.select('base')?.attrs.href || 'http://lite.local/';
  }
}

function resolveUrl(href, base) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return href; }
}
