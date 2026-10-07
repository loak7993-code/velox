// velox-rs :: cdp/page — one page = one WebSocket. Navigation, evaluation (the
// in-page engine does extraction in a single round-trip), waits, screenshots,
// PDFs, cookies, network capture, console/errors.
use super::transport::CdpConn;
use super::{b64_decode, ENGINE_CHECK, ENGINE_SOURCE};
use crate::devices;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitUntil {
    None,
    /// DOMContentLoaded (velox's default "interactive")
    Interactive,
    Load,
    NetworkIdle,
}

impl WaitUntil {
    pub fn parse(s: &str) -> Self {
        match s {
            "none" => WaitUntil::None,
            "load" => WaitUntil::Load,
            "networkidle" => WaitUntil::NetworkIdle,
            _ => WaitUntil::Interactive,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct GotoOpts {
    pub wait_until: Option<WaitUntil>,
    pub timeout: Option<Duration>,
    pub referer: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Nav {
    pub url: String,
    pub status: Option<u16>,
    pub ms: u128,
}

#[derive(Debug, Clone, Default)]
pub struct PageOpts {
    pub viewport: Option<(u32, u32, f64)>, // w, h, dsf
    pub ua: Option<String>,
    pub device: Option<String>,
    pub locale: Option<String>,
    pub timezone: Option<String>,
    pub block_urls: Vec<String>,
    pub intercept: bool, // arm Network capture for requests()/bodies
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Cookie {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    pub value: String,
    #[serde(rename = "domain")]
    pub domain: String,
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "expires", skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    #[serde(rename = "httpOnly")]
    pub http_only: bool,
    #[serde(rename = "secure")]
    pub secure: bool,
    #[serde(rename = "sameSite", skip_serializing_if = "Option::is_none")]
    pub same_site: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RequestEntry {
    pub id: String,
    pub url: String,
    pub method: String,
    pub status: Option<u16>,
    pub content_type: Option<String>,
    pub failed: Option<String>,
    pub resource_type: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConsoleMessage {
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
}

pub struct Page {
    pub conn: Arc<CdpConn>,
    pub target_id: String,
    pub opts: PageOpts,
    url: Mutex<String>,
    main_frame: Mutex<Option<String>>,
    requests: Mutex<HashMap<String, RequestEntry>>,
    console: Mutex<Vec<ConsoleMessage>>,
    errors: Mutex<Vec<ConsoleMessage>>,
    inflight: Mutex<i64>,
    last_doc_status: Mutex<Option<u16>>,
    init_done: AtomicU64,
}

impl Page {
    pub async fn connect(ws_url: String, target_id: String, opts: PageOpts) -> Result<Arc<Page>> {
        let conn = CdpConn::connect(&ws_url).await?;
        let page = Arc::new(Page {
            conn,
            target_id: target_id.clone(),
            opts,
            url: Mutex::new("about:blank".to_string()),
            main_frame: Mutex::new(None),
            requests: Mutex::new(HashMap::new()),
            console: Mutex::new(vec![]),
            errors: Mutex::new(vec![]),
            inflight: Mutex::new(0),
            last_doc_status: Mutex::new(None),
            init_done: AtomicU64::new(0),
        });
        page.init().await?;
        Ok(page)
    }

    async fn init(self: &Arc<Self>) -> Result<()> {
        if self.init_done.swap(1, Ordering::SeqCst) == 1 {
            return Ok(());
        }
        let s = self.conn.clone();
        s.fire("Page.enable", json!({}));
        s.fire("Runtime.enable", json!({}));
        s.fire("Page.setLifecycleEventsEnabled", json!({ "enabled": true }));
        if self.opts.intercept || !self.opts.block_urls.is_empty() {
            s.fire("Network.enable", json!({ "maxPostDataSize": 65536 }));
        }
        self.wire_events().await?;
        self.apply_environment().await?;
        // inject the selector engine
        let _ = s.send("Runtime.evaluate", json!({ "expression": ENGINE_SOURCE })).await?;
        Ok(())
    }

    async fn wire_events(self: &Arc<Self>) -> Result<()> {
        let page = self.clone();
        let mut rx = self.conn.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(ev) => page.handle_event(ev),
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
        Ok(())
    }

    fn handle_event(self: &Arc<Self>, ev: Value) {
        let method = ev.get("method").and_then(Value::as_str).unwrap_or("");
        let params = ev.get("params").cloned().unwrap_or(json!({}));
        match method {
            "Page.frameNavigated" => {
                if params.get("frame").and_then(|f| f.get("parentId")).is_none() {
                    let url = params["frame"]["url"].as_str().unwrap_or("").to_string();
                    *self.url.lock().unwrap() = url;
                    *self.main_frame.lock().unwrap() =
                        params["frame"]["id"].as_str().map(|s| s.to_string());
                }
            }
            "Runtime.consoleAPICalled" => {
                let kind = params.get("type").and_then(Value::as_str).unwrap_or("log").to_string();
                let text = params["args"]
                    .as_array()
                    .map(|args| {
                        args.iter()
                            .map(|a| {
                                a.get("value")
                                    .map(|v| match v {
                                        Value::String(s) => s.clone(),
                                        other => other.to_string(),
                                    })
                                    .or_else(|| {
                                        a.get("description").and_then(Value::as_str).map(|s| s.to_string())
                                    })
                                    .unwrap_or_default()
                            })
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default();
                let mut buf = self.console.lock().unwrap();
                buf.push(ConsoleMessage { kind, text });
                if buf.len() > 1000 {
                    buf.remove(0);
                }
            }
            "Runtime.exceptionThrown" => {
                let d = &params["exceptionDetails"];
                let text = d["exception"]["description"]
                    .as_str()
                    .or_else(|| d["text"].as_str())
                    .unwrap_or("error")
                    .to_string();
                self.errors.lock().unwrap().push(ConsoleMessage { kind: "error".to_string(), text });
            }
            "Network.requestWillBeSent" => {
                let id = params["requestId"].as_str().unwrap_or("").to_string();
                if id.is_empty() {
                    return;
                }
                *self.inflight.lock().unwrap() += 1;
                let entry = RequestEntry {
                    id: id.clone(),
                    url: params["request"]["url"].as_str().unwrap_or("").to_string(),
                    method: params["request"]["method"].as_str().unwrap_or("GET").to_string(),
                    status: None,
                    content_type: None,
                    failed: None,
                    resource_type: params.get("type").and_then(Value::as_str).map(|s| s.to_string()),
                };
                self.requests.lock().unwrap().insert(id, entry);
            }
            "Network.responseReceived" => {
                let id = params["requestId"].as_str().unwrap_or("").to_string();
                let status = params["response"]["status"].as_u64().map(|s| s as u16);
                let ctype = {
                    let headers = &params["response"]["headers"];
                    headers
                        .get("content-type")
                        .or_else(|| headers.get("Content-Type"))
                        .and_then(Value::as_str)
                        .map(|s| s.to_string())
                };
                if let Some(entry) = self.requests.lock().unwrap().get_mut(&id) {
                    entry.status = status;
                    entry.content_type = ctype;
                }
                if params["type"].as_str() == Some("Document") {
                    *self.last_doc_status.lock().unwrap() = status;
                }
            }
            "Network.loadingFinished" => {
                let mut inflight = self.inflight.lock().unwrap();
                *inflight -= 1;
                if *inflight < 0 {
                    *inflight = 0;
                }
            }
            "Network.loadingFailed" => {
                let id = params["requestId"].as_str().unwrap_or("").to_string();
                let mut inflight = self.inflight.lock().unwrap();
                *inflight -= 1;
                if *inflight < 0 {
                    *inflight = 0;
                }
                if let Some(entry) = self.requests.lock().unwrap().get_mut(&id) {
                    entry.failed =
                        Some(params["errorText"].as_str().unwrap_or("failed").to_string());
                }
            }
            _ => {}
        }
    }

    async fn apply_environment(self: &Arc<Self>) -> Result<()> {
        let s = self.conn.clone();
        if let Some(name) = self.opts.device.clone() {
            if let Some(d) = devices::get(&name) {
                let _ = s
                    .send("Emulation.setDeviceMetricsOverride", devices::metrics(d))
                    .await?;
                let _ = s
                    .send(
                        "Network.setUserAgentOverride",
                        json!({
                            "userAgent": d.ua,
                            "platform": d.platform,
                            "userAgentMetadata": {
                                "mobile": d.mobile,
                                "platform": d.platform,
                            }
                        }),
                    )
                    .await?;
            }
        } else {
            if let Some((w, h, dsf)) = self.opts.viewport {
                let _ = s
                    .send(
                        "Emulation.setDeviceMetricsOverride",
                        json!({ "width": w, "height": h, "deviceScaleFactor": dsf, "mobile": false }),
                    )
                    .await?;
            }
            if let Some(ua) = self.opts.ua.clone() {
                let _ = s.send("Network.setUserAgentOverride", json!({ "userAgent": ua })).await?;
            }
        }
        if let Some(locale) = self.opts.locale.clone() {
            let _ = s.send("Emulation.setLocaleOverride", json!({ "locale": locale })).await?;
        }
        if let Some(tz) = self.opts.timezone.clone() {
            let _ = s.send("Emulation.setTimezoneOverride", json!({ "timezoneId": tz })).await?;
        }
        if !self.opts.block_urls.is_empty() {
            let _ = s
                .send("Network.setBlockedURLs", json!({ "urls": self.opts.block_urls }))
                .await?;
        }
        Ok(())
    }

    /// Navigate and wait the requested lifecycle state.
    pub async fn goto(self: &Arc<Self>, url: &str, opts: GotoOpts) -> Result<Nav> {
        let wait_until = opts.wait_until.unwrap_or(WaitUntil::Interactive);
        let timeout = opts.timeout.unwrap_or(Duration::from_secs(45));
        let t0 = Instant::now();

        *self.last_doc_status.lock().unwrap() = None;

        let mut nav_params = json!({ "url": url });
        if let Some(referer) = &opts.referer {
            nav_params["referrer"] = json!(referer);
        }
        let res = self.conn.send_timeout("Page.navigate", nav_params, timeout).await?;
        if let Some(err) = res.get("errorText").and_then(Value::as_str) {
            if !err.is_empty() {
                return Err(anyhow!("goto {url}: {err}"));
            }
        }

        match wait_until {
            WaitUntil::None => {}
            WaitUntil::Interactive => {
                self.wait_lifecycle("DOMContentLoaded", timeout).await?;
            }
            WaitUntil::Load => {
                self.wait_lifecycle("load", timeout).await?;
            }
            WaitUntil::NetworkIdle => {
                self.wait_lifecycle("load", timeout).await.ok();
                self.wait_network_idle(timeout).await.ok();
            }
        }
        self.ensure_engine().await;

        Ok(Nav {
            url: self.url.lock().unwrap().clone(),
            status: *self.last_doc_status.lock().unwrap(),
            ms: t0.elapsed().as_millis(),
        })
    }

    async fn wait_lifecycle(self: &Arc<Self>, name: &str, timeout: Duration) -> Result<()> {
        let main = self.main_frame.lock().unwrap().clone();
        match self
            .conn
            .wait_event(
                "Page.lifecycleEvent",
                |ev| {
                    ev["params"]["name"].as_str() == Some(name)
                        && (main.is_none() || ev["params"]["frameId"].as_str() == main.as_deref())
                },
                timeout,
            )
            .await
        {
            Ok(_) => Ok(()),
            Err(_) => Err(anyhow!("lifecycle {name} not reached within {timeout:?}")),
        }
    }

    async fn wait_network_idle(self: &Arc<Self>, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let inflight = *self.inflight.lock().unwrap();
            if inflight <= 0 {
                let before = inflight;
                tokio::time::sleep(Duration::from_millis(500)).await;
                let after = *self.inflight.lock().unwrap();
                if before == after && after <= 0 {
                    return Ok(());
                }
            }
            if Instant::now() > deadline {
                return Err(anyhow!("network idle not reached within {timeout:?}"));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    pub async fn ensure_engine(self: &Arc<Self>) {
        let live = self
            .conn
            .send(
                "Runtime.evaluate",
                json!({ "expression": ENGINE_CHECK, "returnByValue": true }),
            )
            .await
            .ok()
            .and_then(|r| r["result"]["value"].as_bool())
            .unwrap_or(false);
        if !live {
            let _ = self
                .conn
                .send("Runtime.evaluate", json!({ "expression": ENGINE_SOURCE }))
                .await;
        }
    }

    /// Evaluate a JS expression (or function-as-string) and return a JSON value.
    pub async fn eval(self: &Arc<Self>, js: &str) -> Result<Value> {
        let wrapped = format!(
            "(async () => {{ let v = ({js}); if (typeof v === 'function') v = v(); if (v && typeof v.then === 'function') v = await v; return v; }})()"
        );
        let res = self
            .conn
            .send(
                "Runtime.evaluate",
                json!({ "expression": wrapped, "returnByValue": true, "awaitPromise": true }),
            )
            .await?;
        if let Some(ex) = res.get("exceptionDetails") {
            // not an expression? try raw evaluation (statements keep their value)
            let raw = self
                .conn
                .send(
                    "Runtime.evaluate",
                    json!({ "expression": js, "returnByValue": true, "awaitPromise": true }),
                )
                .await;
            return match raw {
                Ok(r) if r.get("exceptionDetails").is_none() => Ok(r["result"]["value"].clone()),
                _ => {
                    let desc = ex["exception"]["description"]
                        .as_str()
                        .or_else(|| ex["text"].as_str())
                        .unwrap_or("eval error");
                    Err(anyhow!("eval error: {desc}"))
                }
            };
        }
        Ok(res["result"]["value"].clone())
    }

    /// Call the in-page engine: __vlx.<fn>(args…) with the engine auto-injected.
    async fn vlx(self: &Arc<Self>, call: String) -> Result<Value> {
        self.ensure_engine().await;
        let expr = format!(
            "(function(){{ if (!window.__vlx) {{ {ENGINE_SOURCE} }} return {call} }})()"
        );
        let res = self
            .conn
            .send(
                "Runtime.evaluate",
                json!({ "expression": expr, "returnByValue": true, "awaitPromise": true }),
            )
            .await?;
        if let Some(ex) = res.get("exceptionDetails") {
            let desc = ex["exception"]["description"]
                .as_str()
                .or_else(|| ex["text"].as_str())
                .unwrap_or("engine error");
            return Err(anyhow!("engine error: {desc}"));
        }
        Ok(res["result"]["value"].clone())
    }

    pub fn url(&self) -> String {
        self.url.lock().unwrap().clone()
    }

    pub async fn title(self: &Arc<Self>) -> Result<String> {
        Ok(self.eval("document.title").await?.as_str().unwrap_or("").to_string())
    }

    pub async fn content(self: &Arc<Self>) -> Result<String> {
        Ok(self
            .eval("document.documentElement.outerHTML")
            .await?
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    pub async fn text(self: &Arc<Self>, sel: &str) -> Result<Option<String>> {
        Ok(self
            .vlx(format!("__vlx.text({})", json_str(sel)))
            .await?
            .as_str()
            .map(|s| s.to_string()))
    }

    pub async fn attr(self: &Arc<Self>, sel: &str, name: &str) -> Result<Option<String>> {
        Ok(self
            .vlx(format!("__vlx.attr({}, {})", json_str(sel), json_str(name)))
            .await?
            .as_str()
            .map(|s| s.to_string()))
    }

    pub async fn count(self: &Arc<Self>, sel: &str) -> Result<u64> {
        Ok(self.vlx(format!("__vlx.count({})", json_str(sel))).await?.as_u64().unwrap_or(0))
    }

    /// Batch extraction: spec = {text, html, tag, attrs: [...], limit}
    pub async fn extract(self: &Arc<Self>, sel: &str, spec: Value) -> Result<Vec<Value>> {
        let v = self
            .vlx(format!(
                "__vlx.extract({}, {})",
                json_str(sel),
                serde_json::to_string(&spec)?
            ))
            .await?;
        Ok(v.as_array().cloned().unwrap_or_default())
    }

    /// In-page MutationObserver wait (ONE round-trip, no polling over the wire).
    pub async fn wait_for_selector(self: &Arc<Self>, sel: &str, timeout: Duration) -> Result<bool> {
        let v = self
            .vlx(format!(
                "__vlx.wait({}, {}, 'visible')",
                json_str(sel),
                timeout.as_millis()
            ))
            .await?;
        Ok(v.as_bool().unwrap_or(false))
    }

    pub async fn console(&self) -> Vec<ConsoleMessage> {
        self.console.lock().unwrap().clone()
    }

    pub async fn errors(&self) -> Vec<ConsoleMessage> {
        self.errors.lock().unwrap().clone()
    }

    pub async fn requests(&self) -> Vec<RequestEntry> {
        self.requests.lock().unwrap().values().cloned().collect()
    }

    /// Body of a captured response (needs `intercept: true`).
    pub async fn body(self: &Arc<Self>, entry_id: &str) -> Result<Option<String>> {
        let res = self
            .conn
            .send("Network.getResponseBody", json!({ "requestId": entry_id }))
            .await;
        match res {
            Ok(r) => {
                let b64 = r.get("base64Encoded").and_then(Value::as_bool).unwrap_or(false);
                let body = r.get("body").and_then(Value::as_str).unwrap_or("").to_string();
                if b64 {
                    Ok(Some(String::from_utf8_lossy(&b64_decode(&body)?).to_string()))
                } else {
                    Ok(Some(body))
                }
            }
            Err(_) => Ok(None),
        }
    }

    /// Cookies for the current page URL (Storage fallback when empty).
    pub async fn cookies(self: &Arc<Self>) -> Result<Vec<Cookie>> {
        let url = self.url();
        let mut res = self.conn.send("Network.getCookies", json!({ "urls": [url] })).await?;
        let mut list = res["cookies"].as_array().cloned().unwrap_or_default();
        if list.is_empty() {
            res = self.conn.send("Storage.getCookies", json!({})).await?;
            list = res["cookies"].as_array().cloned().unwrap_or_default();
        }
        Ok(list.into_iter().filter_map(parse_cookie).collect())
    }

    pub async fn set_cookies(self: &Arc<Self>, cookies: Vec<Cookie>) -> Result<()> {
        let values: Vec<Value> = cookies.iter().map(|c| serde_json::to_value(c).unwrap()).collect();
        self.conn
            .send("Network.setCookies", json!({ "cookies": values }))
            .await?;
        Ok(())
    }

    pub async fn clear_cookies(self: &Arc<Self>) -> Result<()> {
        self.conn.send("Network.clearBrowserCookies", json!({})).await?;
        Ok(())
    }

    /// localStorage of the current origin: { key: value }
    pub async fn local_storage(self: &Arc<Self>) -> Result<serde_json::Map<String, Value>> {
        let v = self
            .eval("(function(){const o={}; for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i); o[k]=localStorage.getItem(k);} return o;})()")
            .await?;
        Ok(v.as_object().cloned().unwrap_or_default())
    }

    /// Apply a storage state before navigation (Playwright-format origins).
    pub async fn apply_storage_state(self: &Arc<Self>, state: &Value) -> Result<()> {
        if let Some(origins) = state.get("origins").and_then(Value::as_array) {
            for origin in origins {
                let o = origin.get("origin").and_then(Value::as_str).unwrap_or("");
                let items = origin.get("localStorage").and_then(Value::as_array);
                if o.is_empty() || items.is_none() {
                    continue;
                }
                for item in items.unwrap_or(&vec![]) {
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
                    let value = item.get("value").and_then(Value::as_str).unwrap_or("");
                    if name.is_empty() {
                        continue;
                    }
                    let _ = self
                        .eval(&format!(
                            "localStorage.setItem({},{})",
                            json_str(name),
                            json_str(value)
                        ))
                        .await;
                }
            }
        }
        Ok(())
    }

    /// PNG screenshot of the viewport, or the full page when `full`.
    pub async fn screenshot(self: &Arc<Self>, full: bool) -> Result<Vec<u8>> {
        let mut params = json!({ "format": "png", "captureBeyondViewport": full });
        if full {
            let metrics = self.conn.send("Page.getLayoutMetrics", json!({})).await?;
            let size = &metrics["cssContentSize"];
            let w = size["width"].as_f64().unwrap_or(0.0).min(16384.0);
            let h = size["height"].as_f64().unwrap_or(0.0).min(16384.0);
            if w > 0.0 && h > 0.0 {
                params["clip"] = json!({ "x": 0, "y": 0, "width": w, "height": h, "scale": 1 });
            }
        }
        let res = self.conn.send("Page.captureScreenshot", params).await?;
        let data = res
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("captureScreenshot returned no data"))?;
        b64_decode(data)
    }

    /// PDF (printToPDF); `format` e.g. "A4", "Letter".
    pub async fn pdf(self: &Arc<Self>, format: Option<&str>, landscape: bool) -> Result<Vec<u8>> {
        let mut params = json!({ "printBackground": true });
        if let Some(f) = format {
            params["paperWidth"] = json!(paper_size(f).0);
            params["paperHeight"] = json!(paper_size(f).1);
        }
        params["landscape"] = json!(landscape);
        let res = self.conn.send("Page.printToPDF", params).await?;
        let data = res
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("printToPDF returned no data"))?;
        b64_decode(data)
    }

    pub async fn close(self: Arc<Self>) {
        self.conn.close().await;
    }
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

fn parse_cookie(v: Value) -> Option<Cookie> {
    Some(Cookie {
        name: v.get("name")?.as_str()?.to_string(),
        value: v.get("value").and_then(Value::as_str).unwrap_or("").to_string(),
        domain: v.get("domain").and_then(Value::as_str).unwrap_or("").to_string(),
        path: v.get("path").and_then(Value::as_str).unwrap_or("/").to_string(),
        expires: v.get("expires").and_then(Value::as_f64),
        http_only: v.get("httpOnly").and_then(Value::as_bool).unwrap_or(false),
        secure: v.get("secure").and_then(Value::as_bool).unwrap_or(false),
        same_site: v.get("sameSite").and_then(Value::as_str).map(|s| s.to_string()),
    })
}

/// printToPDF paper sizes in inches.
fn paper_size(name: &str) -> (f64, f64) {
    match name.to_ascii_uppercase().as_str() {
        "LETTER" => (8.5, 11.0),
        "LEGAL" => (8.5, 14.0),
        "TABLOID" => (11.0, 17.0),
        "A3" => (11.69, 16.54),
        "A5" => (5.83, 8.27),
        _ => (8.27, 11.69), // A4
    }
}

/// Normalise cookies the way velox does: dot the domain, default the path,
/// de-duplicate (later wins). Ported from src/field.js normalizeCookies.
pub fn normalize_cookies(mut list: Vec<Cookie>) -> Vec<Cookie> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Cookie> = vec![];
    for c in list.drain(..) {
        let mut c = c;
        let bare = c.domain.trim_start_matches('.').to_lowercase();
        let is_ip = bare.split('.').count() == 4 && bare.split('.').all(|p| p.parse::<u8>().is_ok());
        if !bare.is_empty() {
            if !is_ip && !bare.starts_with('.') {
                c.domain = format!(".{bare}");
            } else {
                c.domain = bare;
            }
        }
        if c.path.is_empty() {
            c.path = "/".to_string();
        }
        let key = format!("{}|{}|{}", c.name, c.domain, c.path);
        if let Some(i) = seen.get(&key) {
            out[*i] = c;
        } else {
            seen.insert(key, out.len());
            out.push(c);
        }
    }
    out
}
