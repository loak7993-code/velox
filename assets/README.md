# assets

The velox mark: a lightning bolt that doubles as the **V**, trailing motion
streaks, on a rounded badge. Electric cyan → indigo → violet.

Rendered and verified **with a browser velox itself drives** — no image
tooling, no dependencies, in keeping with the rest of the project.

## What's here

| file | use |
|---|---|
| `logo.svg` | **source mark** — vector, scales to anything |
| `logo-mono.svg` | monochrome (uses `currentColor` — inherits surrounding text color) |
| `favicon.svg` | simplified mark: no blur filters, heavier strokes — readable at 16 px |
| `banner.svg` | **source banner** — wordmark, tagline, feature chips, install line |
| `banner.png` | 1280×640 — README hero + GitHub social preview (that's the exact size GitHub wants) |
| `logo-1024/512/192/96.png` | app icons, avatars (GitHub org avatar, npm, Docker, Slack) |
| `favicon-32/16.png` | browser favicons |
| `render.js` | renders any SVG to PNG at any size using the CDP browser |
| `preview.js` | prints a PNG as ASCII — how these were verified without an image viewer |

## Regenerate

```bash
export VELOX_BROWSER=/path/to/chrome-headless-shell   # or any Chrome-family browser
node assets/render.js '[["assets/logo.svg","assets/logo-512.png",512],["assets/banner.svg","assets/banner.png",[1280,640]]]'
node assets/preview.js assets/logo-512.png 76        # eyeball it in the terminal
```

`render.js` rewrites the SVG's intrinsic `width`/`height` per target, so the
vector is re-rasterized at each size instead of being downscaled — crisp edges
at every dimension. `--default-background-color=00000000` keeps transparency.

## Palette

| role | hex |
|---|---|
| badge / background | `#080d1c` → `#151d3d` |
| bolt highlight | `#a5f3fc` |
| bolt mid | `#38bdf8` (cyan) |
| bolt deep | `#6366f1` → `#a855f7` (indigo → violet) |
| glow | `#22d3ee` @ 22–45% |
| UI text on dark | `#8ea3c0` |
