// preview a PNG as ASCII using velox's own from-scratch PNG decoder
import { readFileSync } from 'node:fs';
import { decodePng } from '../src/cdp/png.js';

const file = process.argv[2];
const cols = Number(process.argv[3] || 64);
const img = decodePng(readFileSync(file));
const rows = Math.max(1, Math.round((cols * img.height) / img.width / 2.1));
const cx = img.width / cols, cy = img.height / rows;

// second pass: render alpha over a checker so transparency is visible
const CH = ' .:-=+*#%@';
const MID = ' .·:;+=xX$&@';
let out = '';
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    let lum = 0, alpha = 0, n = 0;
    for (let y = Math.floor(r * cy); y < Math.min(img.height, (r + 1) * cy); y += 2) {
      for (let x = Math.floor(c * cx); x < Math.min(img.width, (c + 1) * cx); x += 2) {
        const o = (y * img.width + x) * 4;
        const a = img.rgba[o + 3] / 255;
        alpha += a;
        lum += (0.2126 * img.rgba[o] + 0.7152 * img.rgba[o + 1] + 0.0722 * img.rgba[o + 2]) * a;
        n++;
      }
    }
    alpha /= n; lum /= n;
    if (alpha < 0.08) line += ' ';
    else {
      const idx = Math.min(CH.length - 1, Math.round((lum / 255) * (CH.length - 1) + (idx2 => 0)(0)));
      line += CH[idx];
    }
  }
  out += line.replace(/\s+$/, '') + '\n';
}
console.log(out);
console.log(`${img.width}×${img.height}  (${CH} = dark→bright)`);
