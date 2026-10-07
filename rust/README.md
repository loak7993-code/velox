# velox-rs — the velox engine in Rust

Standalone Rust port of [velox](../README.md): any installed Chromium-family
browser over CDP, or no browser at all (keep-alive HTTP + DOM). Same commands,
same output conventions, same in-page selector engine — **byte-identical to the
JS version's**, extracted from `src/cdp/inject.js` at build time so the two
engines can never drift.

## Build

```bash
cd rust
cargo build --release
# → target/release/vlx-rs
```

Rust 1.85+ (edition 2024). No Node or browser needed at build time; a browser
is needed only for the CDP paths at run time (`VELOX_BROWSER` or auto-discovery
of any installed Chrome / Chromium / Edge / Brave / Vivaldi / Opera /
chrome-headless-shell).

## CLI — same commands as `vlx`

```bash
vlx-rs detect                                # browsers found on this machine
vlx-rs open  https://example.com             # readable markdown (auto engine)
vlx-rs open  example.com --sel 'h2' --json   # specific elements, structured
vlx-rs open  url --engine lite|cdp|auto      # force the engine
vlx-rs open  url --wait '#late'              # wait for a selector first
vlx-rs shot  url --full -o page.png          # full-page screenshot
vlx-rs pdf   url -o page.pdf                 # A4 (or --format Letter…)
vlx-rs links url --json
vlx-rs scrape url --recipe tables|meta|text|links|images|jsonld|all
vlx-rs eval  url "document.title"
vlx-rs cookies url
vlx-rs save-session url s.json               # cookies + web storage
vlx-rs load-session url s.json
vlx-rs bench  url --iters 5                  # lite vs browser timings
```

Output matches the JS CLI: readable markdown by default, `--json`/`--html`,
`-o FILE` writes to a file, `-q` is quiet.

## Library

```rust
use velox_core::{Session, OpenOpts};
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // auto engine: pure HTTP first, a real browser only when the page needs JS
    let s = Session::open("https://example.com", OpenOpts {
        timeout: Duration::from_secs(20),
        ..Default::default()
    }).await?;

    println!("engine: {}", s.engine());     // lite | cdp
    println!("title: {}", s.title().await?);
    println!("{}", s.readable().await?);    // markdown

    // browser-only ops escalate transparently (cookies carry over)
    let (s, png) = s.screenshot(false).await?;
    std::fs::write("page.png", png)?;
    s.close().await;
    Ok(())
}
```

Lower-level: `velox_core::cdp::Browser` (launch/connect, `new_page`) and
`velox_core::cdp::Page` (goto/eval/text/extract/screenshot/pdf/cookies/network
capture) — one WebSocket per target, request/response correlated by id,
lifecycle-based navigation waits (`DOMContentLoaded` / `load` / network-idle).

## Speed

Same test site, same binary, medians of 5 (see `bench.sh`):

| operation | JS `vlx` | `vlx-rs` | |
|---|---|---|---|
| open (auto → lite) | 122 ms | **23 ms** | 5.3× |
| open (`--engine cdp`) | 5157 ms | **138 ms** | 37× |
| eval `document.title` | 5195 ms | **131 ms** | 40× |
| shot (full) | 5219 ms | **214 ms** | 24× |
| links | 125 ms | **22 ms** | 5.7× |

The browser path wins big because the JS CLI pays Node's full module-graph
import cost (~5 s) before the first CDP message; the Rust binary starts in
milliseconds and the CDP driver itself is comparable.

## Architecture

```
crates/velox-core/
  src/cdp/transport.rs   CDP WebSocket: writer + reader tasks, id-correlated
                         requests, broadcast event bus, pings/pongs
  src/cdp/browser.rs     launch (stderr "DevTools listening on ws://…" capture)
                         / connect (ws:// or host:port), PUT /json/new targets
  src/cdp/page.rs        goto (lifecycle waits), eval (expression | function |
                         statement, promise-awaited, JSON round-trip), the
                         in-page engine bridge (__vlx.*), wait_for_selector
                         (in-page MutationObserver — ONE round-trip),
                         screenshots (captureBeyondViewport + layout clip),
                         PDFs (printToPDF paper sizes), cookies
                         (normalize: dot-domains, dedupe — the hybrid-pipeline
                         bug fix ported too), network capture + bodies
  src/cdp/inject.js      the selector engine, extracted at BUILD TIME from the
                         shared source (build.rs) — selector semantics stay in
                         lockstep with the JS package by construction
  src/http/              lite engine: reqwest (rustls, gzip/brotli/deflate,
                         cookie jar), HtmlDoc over `scraper` (links, tables,
                         forms, meta, jsonld, the readability renderer)
  src/needs_js.rs        escalation heuristics, ported 1:1 from the JS engine
  src/discovery.rs       browser discovery, same preference order
  src/devices.rs         device presets (iphone_15, pixel_8, ipad, …)
crates/velox-cli/        the `vlx-rs` binary (clap)
tests/integration.rs     integration tests against test/site/serve.js
bench.sh                 head-to-head vs the JS CLI
```

## Test

```bash
cargo test --release        # unit + integration (spawns test/site/serve.js)
VELOX_BROWSER=/path/to/chrome cargo test --release   # includes CDP tests
```

## Status vs the JS package (honest gap list)

Implemented: engines (auto/lite/cdp + needsJS escalation), navigation with
lifecycle waits, the full selector engine (css / text= / role= / label= /
testid= / id= / tag= / xpath= / `>>` shadow+iframe piercing — identical to JS
because it is the same source), extraction, eval, waits, screenshots, PDFs,
cookies (normalize + session save/load), network capture + bodies, device
emulation, URL blocking, CLI parity for the common commands, discovery,
benchmarks.

Not ported (tracked gaps):

- **stealth** (fingerprint patches), **human** (bezier input, warmup, hold) —
  the anti-bot behavioural layer
- **challenge** (Cloudflare/PX/Akamai detect + engage)
- **locators** as first-class objects, drag&drop, file upload, dialogs,
  frames-as-pages, workers, tracing/HAR export, screencast video, clock,
  coverage/accessibility, pool, accounts/identity tooling, plugins/middleware
- element-level screenshots (`shot --sel` falls back to full page)
- proxied browser launch accepts `--proxy-server` only (no auth forwarder yet)

The JS package remains the reference implementation; `rust/` is the fast
standalone path (CLI + library) and the build-time engine extraction keeps
selector behaviour from drifting.
