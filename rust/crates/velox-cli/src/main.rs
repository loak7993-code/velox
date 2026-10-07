// vlx-rs — the velox CLI in Rust. Same commands and output conventions as the
// JS `vlx` binary: readable markdown by default, --json/--html/--raw formats,
// -o/--out file outputs, auto engine (lite first, browser when JS is needed).
use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use serde_json::Value;
use std::time::{Duration, Instant};
use velox_core::{Session, OpenOpts};

#[derive(Parser)]
#[command(name = "vlx-rs", version, about = "vlx-rs — velox in Rust. Browser automation at terminal velocity.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List Chromium-family browsers found on this machine
    Detect,
    /// Open a URL and print readable text (auto engine: no browser unless JS is needed)
    #[command(alias = "read")]
    Open {
        url: String,
        /// JSON output (status, engine, title, meta, or extracted elements with --sel)
        #[arg(long)]
        json: bool,
        /// raw HTML output
        #[arg(long)]
        html: bool,
        /// raw HTML output (alias)
        #[arg(long)]
        raw: bool,
        /// CSS selector to extract instead of the whole page
        #[arg(long)]
        sel: Option<String>,
        /// engine: auto | lite | cdp
        #[arg(long)]
        engine: Option<String>,
        /// overall timeout in ms
        #[arg(long)]
        timeout: Option<u64>,
        /// write output to a file
        #[arg(short, long)]
        out: Option<String>,
        /// suppress the status line
        #[arg(short, long)]
        quiet: bool,
        /// wait for a selector before reading (browser engine)
        #[arg(long)]
        wait: Option<String>,
        /// viewport WxH (browser engine)
        #[arg(long)]
        viewport: Option<String>,
        /// device preset (iphone_15, pixel_8, desktop, …)
        #[arg(long)]
        device: Option<String>,
        /// user agent override
        #[arg(long)]
        ua: Option<String>,
        /// proxy server (http://… or socks5://…)
        #[arg(long)]
        proxy: Option<String>,
        /// extra request header "K: V" (repeatable)
        #[arg(long = "header")]
        headers: Vec<String>,
        /// block URL globs (repeatable)
        #[arg(long = "block")]
        block: Vec<String>,
    },
    /// Screenshot → out.png
    Shot {
        url: String,
        /// full-page screenshot
        #[arg(long)]
        full: bool,
        /// element screenshot
        #[arg(long)]
        sel: Option<String>,
        #[arg(short, long)]
        out: Option<String>,
        #[arg(long)]
        engine: Option<String>,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Save the page as PDF
    Pdf {
        url: String,
        #[arg(short, long)]
        out: Option<String>,
        /// paper format: A4 | Letter | Legal | A3 | A5
        #[arg(long)]
        format: Option<String>,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// List all links (--json for structured output)
    Links {
        url: String,
        #[arg(long)]
        json: bool,
        #[arg(short, long)]
        out: Option<String>,
        #[arg(long)]
        engine: Option<String>,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Structured scrape (--recipe text|links|images|tables|meta|jsonld|all)
    Scrape {
        url: String,
        #[arg(long, default_value = "all")]
        recipe: String,
        #[arg(short, long)]
        out: Option<String>,
        #[arg(long)]
        engine: Option<String>,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Evaluate JS in the page and print the result
    Eval {
        url: String,
        expr: String,
        #[arg(long)]
        engine: Option<String>,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Print cookies seen while loading the page
    Cookies {
        url: String,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Capture cookies + web storage to a JSON file
    SaveSession {
        url: String,
        file: String,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Open URL with a saved session restored first
    LoadSession {
        url: String,
        file: String,
        #[arg(long)]
        timeout: Option<u64>,
        #[arg(long)]
        proxy: Option<String>,
    },
    /// Time lite vs browser on the same URL
    Bench {
        url: String,
        /// iterations
        #[arg(long, default_value = "3")]
        iters: usize,
    },
}

fn parse_headers(raw: &[String]) -> Vec<(String, String)> {
    raw.iter()
        .filter_map(|h| {
            let (k, v) = h.split_once(':')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

fn parse_viewport(v: &Option<String>) -> Option<(u32, u32, f64)> {
    v.as_deref()
        .and_then(|s| {
            let (w, h) = s.split_once('x')?;
            Some((w.trim().parse().ok()?, h.trim().parse().ok()?, 1.0))
        })
}

fn open_opts(
    engine: Option<&str>,
    timeout: Option<u64>,
    proxy: Option<&str>,
    device: Option<&str>,
    ua: Option<&str>,
    headers: &[(String, String)],
    viewport: Option<(u32, u32, f64)>,
    block: &[String],
) -> OpenOpts {
    OpenOpts {
        engine: engine.map(|s| s.to_string()),
        browser: None,
        timeout: Duration::from_millis(timeout.unwrap_or(20000)),
        headers: headers.to_vec(),
        user_agent: ua.map(|s| s.to_string()),
        proxy: proxy.map(|s| s.to_string()),
        viewport,
        device: device.map(|s| s.to_string()),
        locale: None,
        timezone: None,
        block_urls: block.to_vec(),
    }
}

fn parse_cookie_file(path: &str) -> Result<Value> {
    let raw = std::fs::read_to_string(path).map_err(|e| anyhow!("read {path}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| anyhow!("parse {path}: {e}"))
}

/// Apply a saved session (cookies + origins/localStorage) to a cdp page.
async fn apply_session(page: &std::sync::Arc<velox_core::cdp::page::Page>, state: &Value) -> Result<()> {
    if let Some(cookies) = state.get("cookies").and_then(Value::as_array) {
        let list: Vec<velox_core::cdp::page::Cookie> = cookies
            .iter()
            .filter_map(|c| {
                Some(velox_core::cdp::page::Cookie {
                    name: c.get("name")?.as_str()?.to_string(),
                    value: c.get("value").and_then(Value::as_str).unwrap_or("").to_string(),
                    domain: c.get("domain").and_then(Value::as_str).unwrap_or("").to_string(),
                    path: c.get("path").and_then(Value::as_str).unwrap_or("/").to_string(),
                    expires: c.get("expires").and_then(Value::as_f64),
                    http_only: c.get("httpOnly").and_then(Value::as_bool).unwrap_or(false),
                    secure: c.get("secure").and_then(Value::as_bool).unwrap_or(false),
                    same_site: c.get("sameSite").and_then(Value::as_str).map(|s| s.to_string()),
                })
            })
            .collect();
        if !list.is_empty() {
            let _ = page.set_cookies(velox_core::cdp::page::normalize_cookies(list)).await;
        }
    }
    let _ = page.apply_storage_state(state).await;
    Ok(())
}

fn emit(text: &str, out: &Option<String>, quiet: bool) {
    match out {
        None => println!("{text}"),
        Some(path) => {
            if let Some(dir) = std::path::Path::new(path).parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            std::fs::write(path, text).expect("write out");
            if !quiet {
                eprintln!("→ {path}  {:.1} KB", text.len() as f64 / 1024.0);
            }
        }
    }
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Detect => {
            let found = velox_core::discover();
            if found.is_empty() {
                println!("no Chromium-family browsers found — set VELOX_BROWSER or install any of: Chrome, Chromium, Edge, Brave, Vivaldi, Opera");
            } else {
                for b in found {
                    println!("{:<28} {}", b.name, b.path);
                }
            }
        }

        Cmd::Open {
            url, json, html, raw, sel, engine, timeout, out, quiet, wait, viewport, device, ua, proxy, headers, block,
        } => {
            let opts = open_opts(engine.as_deref(), timeout, proxy.as_deref(), device.as_deref(),
                ua.as_deref(), &parse_headers(&headers), parse_viewport(&viewport), &block);
            let s = Session::open(&url, opts).await?;
            let s = match &wait {
                Some(w) => s.wait_for(w, Duration::from_secs(10)).await?.0,
                None => s,
            };
            if json {
                let meta = s.meta().await?;
                let body = match &sel {
                    Some(sel) => {
                        let rows = match s {
                            Session::Lite(ref l) => l
                                .doc
                                .text_of(sel)
                                .map(|t| vec![serde_json::json!({ "text": t })])
                                .unwrap_or_default(),
                            Session::Cdp(_) => vec![],
                        };
                        rows
                    }
                    None => vec![],
                };
                let payload = if body.is_empty() {
                    serde_json::json!({
                        "url": s.url(), "engine": s.engine(),
                        "title": s.title().await?, "meta": meta,
                    })
                } else {
                    serde_json::json!(body)
                };
                emit(&serde_json::to_string_pretty(&payload)?, &out, quiet);
            } else if html || raw {
                emit(&s.html().await?, &out, quiet);
            } else if let Some(sel) = &sel {
                let text = s.text(sel).await?.unwrap_or_default();
                emit(&text, &out, quiet);
            } else {
                emit(&s.readable().await?, &out, quiet);
            }
            s.close().await;
        }

        Cmd::Shot { url, full, sel, out, engine, timeout, proxy } => {
            let out = out.unwrap_or_else(|| "shot.png".to_string());
            let opts = open_opts(engine.as_deref(), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let (s, png) = s.screenshot(full).await?;
            if let Some(sel) = &sel {
                // element screenshot: crop via in-page rect is a gap (see README);
                // fall back to the full capture for now
                let _ = sel;
            }
            std::fs::write(&out, &png)?;
            println!("{out}  {:.1} KB", png.len() as f64 / 1024.0);
            s.close().await;
        }

        Cmd::Pdf { url, out, format, timeout, proxy } => {
            let out = out.unwrap_or_else(|| "page.pdf".to_string());
            let opts = open_opts(Some("cdp"), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let (s, pdf) = s.pdf(format.as_deref()).await?;
            std::fs::write(&out, &pdf)?;
            println!("{out}  {:.1} KB", pdf.len() as f64 / 1024.0);
            s.close().await;
        }

        Cmd::Links { url, json, out, engine, timeout, proxy } => {
            let opts = open_opts(engine.as_deref(), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let links = s.links().await?;
            if json {
                emit(&serde_json::to_string_pretty(
                    &links.iter().map(|l| serde_json::json!({ "text": l.text, "href": l.href })).collect::<Vec<_>>(),
                )?, &out, false);
            } else {
                let text = links
                    .iter()
                    .map(|l| format!("{:<62} {}", l.text.chars().take(60).collect::<String>(), l.href))
                    .collect::<Vec<_>>()
                    .join("\n");
                emit(&text, &out, false);
            }
            s.close().await;
        }

        Cmd::Scrape { url, recipe, out, engine, timeout, proxy } => {
            let opts = open_opts(engine.as_deref(), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let data = match recipe.as_str() {
                "text" => serde_json::json!(s.readable().await?),
                "links" => {
                    let links = s.links().await?;
                    serde_json::json!(links.iter().map(|l| serde_json::json!({ "text": l.text, "href": l.href })).collect::<Vec<_>>())
                }
                "images" => serde_json::json!(s.images().await?),
                "tables" => serde_json::json!(s.tables().await?),
                "meta" => {
                    let m = s.meta().await?;
                    serde_json::json!(m)
                }
                "jsonld" => serde_json::json!(s.jsonld().await?),
                _ => serde_json::json!({
                    "url": s.url(),
                    "meta": s.meta().await?,
                    "text": s.readable().await?,
                    "links": s.links().await?,
                    "images": s.images().await?,
                    "tables": s.tables().await?,
                    "jsonld": s.jsonld().await?,
                }),
            };
            emit(&serde_json::to_string_pretty(&data)?, &out, false);
            s.close().await;
        }

        Cmd::Eval { url, expr, engine, timeout, proxy } => {
            let opts = open_opts(Some(engine.unwrap_or_else(|| "cdp".to_string()).as_str()),
                timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let (s, v) = s.eval(&expr).await?;
            println!("{}", match &v {
                Value::String(s) => s.clone(),
                other => serde_json::to_string_pretty(other)?,
            });
            s.close().await;
        }

        Cmd::Cookies { url, timeout, proxy } => {
            let opts = open_opts(Some("cdp"), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            let cookies = s.cookies().await?;
            println!("{}", serde_json::to_string_pretty(&cookies)?);
            s.close().await;
        }

        Cmd::SaveSession { url, file, timeout, proxy } => {
            let opts = open_opts(Some("cdp"), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let s = Session::open(&url, opts).await?;
            if let Session::Cdp(ref cdp) = s {
                let cookies = cdp.page.cookies().await?;
                let ls = cdp.page.local_storage().await?;
                let state = serde_json::json!({
                    "cookies": cookies,
                    "origins": [{
                        "origin": origin_of(&s.url()),
                        "localStorage": ls.iter()
                            .map(|(k, v)| serde_json::json!({ "name": k, "value": v }))
                            .collect::<Vec<_>>(),
                    }],
                });
                std::fs::write(&file, serde_json::to_string_pretty(&state)?)?;
                println!("saved {} cookies + {} storage keys → {file}", cookies.len(), ls.len());
            } else {
                anyhow::bail!("save-session needs the browser engine");
            }
            s.close().await;
        }

        Cmd::LoadSession { url, file, timeout, proxy } => {
            let state = parse_cookie_file(&file)?;
            let opts = open_opts(Some("cdp"), timeout, proxy.as_deref(), None, None, &[], None, &[]);
            let session = Session::open("about:blank", opts).await?;
            if let Session::Cdp(cdp) = session {
                apply_session(&cdp.page, &state).await?;
                let nav = cdp.page.goto(&url, velox_core::cdp::page::GotoOpts {
                    wait_until: Some(velox_core::cdp::page::WaitUntil::Interactive),
                    timeout: Some(timeout.map(Duration::from_millis).unwrap_or(Duration::from_secs(45))),
                    referer: None,
                }).await?;
                let title = cdp.page.title().await?;
                println!("status {}  title: {title}", nav.status.map(|s| s.to_string()).unwrap_or_else(|| "-".into()));
                let s = Session::Cdp(cdp);
                s.close().await;
            } else {
                anyhow::bail!("load-session needs the browser engine");
            }
        }

        Cmd::Bench { url, iters } => {
            // lite vs browser on the same URL, N iterations each
            let mut lite_ms = vec![];
            for _ in 0..iters {
                let t0 = Instant::now();
                let s = Session::open(&url, open_opts(Some("lite"), None, None, None, None, &[], None, &[])).await?;
                let _ = s.readable().await?;
                lite_ms.push(t0.elapsed().as_millis());
                s.close().await;
            }
            let mut cdp_launch = vec![];
            let mut cdp_goto = vec![];
            for _ in 0..iters {
                let opts = open_opts(Some("cdp"), None, None, None, None, &[], None, &[]);
                let t0 = Instant::now();
                let mut b = velox_core::cdp::Browser::launch(opts.launch_opts()).await?;
                cdp_launch.push(t0.elapsed().as_millis());
                let page = b.new_page(velox_core::cdp::page::PageOpts { intercept: true, ..Default::default() }).await?;
                let nav = page.goto(&url, velox_core::cdp::page::GotoOpts {
                    wait_until: Some(velox_core::cdp::page::WaitUntil::Interactive),
                    timeout: None,
                    referer: None,
                }).await?;
                cdp_goto.push(nav.ms);
                page.close().await;
                b.close().await;
            }
            println!("lite fetch:        {}ms (median of {iters})", median(&lite_ms));
            println!("browser launch:    {}ms", median(&cdp_launch));
            println!("browser goto:      {}ms", median(&cdp_goto));
        }
    }
    Ok(())
}

fn origin_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .map(|u| format!("{}://{}", u.scheme(), u.host_str().unwrap_or("")))
        .unwrap_or_else(|| url.to_string())
}

fn median(v: &[u128]) -> u128 {
    if v.is_empty() {
        return 0;
    }
    let mut s = v.to_vec();
    s.sort();
    s[s.len() / 2]
}
