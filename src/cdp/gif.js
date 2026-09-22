// velox :: cdp/gif.js — from-scratch animated GIF89a encoder. Zero deps.
// Histogram palette from the first frame, LZW-compressed image data per frame.
export function buildPalette(rgba) {
  // histogram of quantized colors (4 bits/channel), then take the top 255
  const hist = new Map();
  for (let i = 0; i < rgba.length; i += 4 * 7) {  // sample every 7th pixel
    if (rgba[i + 3] < 128) continue;              // transparent-ish → skip
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255);
  const palette = new Uint8Array(256 * 3);
  top.forEach(([key, _count], idx) => {
    const r = (key >> 8) & 0xf, g = (key >> 4) & 0xf, b = key & 0xf;
    palette[idx * 3] = (r << 4) | r; palette[idx * 3 + 1] = (g << 4) | g; palette[idx * 3 + 2] = (b << 4) | b;
  });
  // slot 255: pure white fallback
  palette[255 * 3] = 255; palette[255 * 3 + 1] = 255; palette[255 * 3 + 2] = 255;
  return palette;
}

/** Map RGBA → palette indices with a 32³ memo cache. */
export function mapToIndices(rgba, palette) {
  const cache = new Int16Array(32 * 32 * 32).fill(-1);
  const n = rgba.length / 4;
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let best = 0, bestD = Infinity;
      for (let p = 0; p < 256; p++) {
        const pi = p * 3;
        const dr = r - palette[pi], dg = g - palette[pi + 1], db = b - palette[pi + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; if (d === 0) break; }
      }
      idx = best;
      cache[key] = idx;
    }
    indices[i] = rgba[o + 3] < 128 ? 255 : idx; // transparent → white slot
  }
  return indices;
}

/**
 * Encode an animated GIF.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} palette  256*3 RGB bytes
 * @param {Array} frames        [{indices: Uint8Array, delayMs}]
 */
export function encodeGif(width, height, palette, frames, { loop = 0 } = {}) {
  const out = [];
  const push = (...b) => out.push(...b);
  const pushBuf = (buf) => { for (const b of buf) out.push(b); };
  const pushU16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);

  // header + logical screen descriptor + global color table
  pushBuf(Buffer.from('GIF89a'));
  pushU16(width); pushU16(height);
  push(0xF7, 0, 0); // GCT flag | color res 8 | size 256; bg 0; aspect 0
  pushBuf(palette.length === 768 ? palette : padPalette(palette));

  // NETSCAPE looping extension
  push(0x21, 0xFF, 0x0B);
  pushBuf(Buffer.from('NETSCAPE2.0'));
  push(0x03, 0x01);
  pushU16(loop);
  push(0x00);

  for (const f of frames) {
    const delay = Math.max(2, Math.min(6000, Math.round((f.delayMs ?? 100) / 10)));
    push(0x21, 0xF9, 0x04, 0x04);   // graphic control ext, disposal 1 (leave)
    pushU16(delay);
    push(0x00, 0x00);
    push(0x2C);                     // image descriptor
    pushU16(0); pushU16(0);
    pushU16(width); pushU16(height);
    push(0x00);                     // no local color table, no interlace
    push(0x08);                     // LZW min code size
    pushBuf(lzwEncode(f.indices, 8));
    push(0x00);
  }

  push(0x3B); // trailer
  return Buffer.from(out);
}

function padPalette(p) {
  const full = Buffer.alloc(768);
  full.set(p.subarray(0, 768));
  return full;
}

/** Standard GIF-flavored LZW (Weiner/Poskanzer semantics). */
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  const bytes = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    // bump bit width when the next free code no longer fits (mirrors decoders)
    if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { bytes.push(cur & 0xff); cur >>= 8; curBits -= 8; }
  };
  const resetDict = () => { dict = new Map(); nextCode = eoiCode + 1; codeSize = minCodeSize + 1; };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (nextCode < 4096) dict.set(key, nextCode++);
    else { emit(clearCode); resetDict(); }
    prefix = c;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) bytes.push(cur & 0xff);

  // wrap into ≤255-byte sub-blocks
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length);
    for (const b of chunk) out.push(b);
  }
  return Buffer.from(out);
}
