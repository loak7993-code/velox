// render an SVG to PNG using the browser velox drives (no image tooling needed).
// rewrites the SVG's intrinsic size per target so the vector scales losslessly.
import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const EXE = process.env.VELOX_BROWSER;
const jobs = JSON.parse(process.argv[2]); // [[svg, png, size|[w,h], extraCss?], ...]

for (const [svg, png, size] of jobs) {
  const [w, h] = Array.isArray(size) ? size : [size, size];
  const src = readFileSync(svg, 'utf8');
  const sized = src
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace('<svg', `<svg width="${w}" height="${h}"`);
  mkdirSync(tmpdir(), { recursive: true });
  const tmp = resolve(tmpdir(), `vx-render-${basename(svg).replace(/\.svg$/, '')}-${w}x${h}.svg`);
  writeFileSync(tmp, sized);

  await new Promise((res, rej) => {
    const p = spawn(EXE, [
      '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      `--screenshot=${resolve(png)}`, `--window-size=${w},${h}`,
      '--default-background-color=00000000', '--force-device-scale-factor=1',
      'file://' + tmp,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => {
      if (existsSync(resolve(png))) res();
      else rej(new Error(`render failed (${code}): ${err.slice(-300)}`));
    });
  });
  console.log(`${png.padEnd(30)} ${w}×${h}`);
}
