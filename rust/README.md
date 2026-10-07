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
vlx-rs challenge url                          # what anti-bot widget is here? (waits for it)
vlx-rs net url --filter 'api'                 # captured network log
vlx-rs har url --bodies -o traffic.har        # HAR 1.2 export
vlx-rs shot  url --sel 'table' -o el.png      # element screenshot
vlx-rs pdf   url --landscape --format Letter
vlx-rs open  url --stealth                    # coherent anti-fingerprint patches
vlx-rs bench url --iters 5                    # lite vs browser timings
```

Stealth, human behaviour and challenge helpers are library APIs too:

```rust
use velox_core::cdp::stealth::StealthOpts;
let s = Session::open(url, OpenOpts {
    engine: Some("cdp".into()),
    stealth: Some(StealthOpts { profile: Some("chrome-windows".into()), ..Default::default() }),
    ..OpenOpts::default()
}).await?;
let (s, _) = s.wait_for("#late", Duration::from_secs(5)).await?;
// the page exposes human-like input (seeded, reproducible):
s.close().await;
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
| open (auto → lite) | 126 ms | **22 ms** | 5.7× |
| open (`--engine cdp`) | 269 ms | **153 ms** | 1.8× |
| eval `document.title` | 264 ms | **153 ms** | 1.7× |
| shot (full) | 784 ms | **232 ms** | 3.4× |
| links | 126 ms | **22 ms** | 5.7× |

After the JS-side fixes (fs-scan discovery without 21 process spawns,
`'auto'` respecting `VELOX_BROWSER`, `unref`'d race timers that used to hold
the process open for seconds after a 26 ms close), the JS CLI's browser path
dropped from ~5.2 s to ~270 ms. The remaining Rust edge: a native binary with
no module graph, plus the target-create fast path (`/json/new?url=…` starts
the load during chrome boot, in parallel with the attach).

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
lifecycle waits and `gotoWithRetry`, the full selector engine (css / text= /
role= / label= / testid= / id= / tag= / xpath= / `>>` shadow+iframe piercing —
identical to JS because it is the same source), extraction, eval,
`waitForFunction` (in-page polling), screenshots + **element screenshots**
(`shot --sel`, clip from the element rect), PDFs (paper sizes + landscape),
cookies (normalize + session save/load), **dialogs** (accept / dismiss /
prompt text), **network capture + bodies + HAR 1.2 export**, **request URL
blocking**, **challenge detection** (turnstile / recaptcha / hcaptcha / arkose
/ awswaf / px — window-object authoritative signals, noisy-iframe exclusion,
`{wait}` mode for late-hydrating SPAs) and **waitForCaptchaToken** with
state-diagnosis on timeout, **stealth** (4 coherent profiles + geo presets +
UA-CH alignment with the real binary — the injected JS is extracted from the
shared source at build time), **human behaviour** (seeded bezier mouse moves
with overshoot, jitter typing with corrections, wheel momentum scrolling,
warmup, press-and-hold with tremor), device emulation, **pool** (parallel
pages across browsers with bounded concurrency), discovery, CLI parity for
the common commands (`challenge`, `net`, `har` added), benchmarks.

Not ported (tracked gaps):

- **challenge engage** (clicking Turnstile checkboxes, PX press-and-hold flows)
  — detection + token waiting is in; interactive solving is not
- **locators** as first-class objects, drag&drop, file upload, workers,
  screencast video recording, virtual clock, coverage/accessibility APIs,
  accounts/identity tooling, plugins/middleware
- **proxy auth**: `--proxy-server` only (no local auth forwarder yet)
- HTML **parsing for the lite engine** uses `scraper`; the JS engine's
  custom forgiving parser differs on pathological markup

The JS package remains the reference implementation; `rust/` is the fast
standalone path (CLI + library) and the build-time extraction keeps both the
selector engine and the stealth injection in lockstep with the JS package.
