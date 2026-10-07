// velox-rs integration tests — run against the repo's own test site
// (test/site/serve.js, spawned as a child process). Requires a browser for the
// CDP tests: VELOX_BROWSER=/path/to/browser cargo test
use tokio::io::AsyncBufReadExt;
use std::time::Duration;
use velox_core::{Session, OpenOpts};

async fn start_site() -> String {
    // spawn the shared test site; read its URL from stdout
    let mut child = tokio::process::Command::new("node")
        .arg("test/site/serve.js")
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../../..")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("spawn test site (node)");
    let stdout = child.stdout.take().expect("site stdout");
    let url = {
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut line = String::new();
        reader.read_line(&mut line).await.expect("read site url");
        line.trim_start_matches("test site on ").trim().to_string()
    };
    // keep the child alive for the test's duration
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    if url.is_empty() {
        panic!("test site did not report a url");
    }
    url
}

fn opts() -> OpenOpts {
    OpenOpts { timeout: Duration::from_secs(30), ..Default::default() }
}

#[tokio::test]
async fn lite_fetch_and_dom() {
    let site = start_site().await;
    let s = Session::open(&format!("{site}/"), opts()).await.unwrap();
    assert_eq!(s.engine(), "lite", "static page stays lite");
    assert_eq!(s.title().await.unwrap(), "Velox Test Site");
    let h1 = s.text("h1").await.unwrap().unwrap();
    assert_eq!(h1, "Welcome to Velox");
    let links = s.links().await.unwrap();
    assert!(links.iter().any(|l| l.href.contains("/page2.html")), "links resolve against the base url");
    let tables = s.tables().await.unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0]["rows"][0][0], serde_json::json!("widgets"));
    s.close().await;
}

#[tokio::test]
async fn needs_js_matches_reference() {
    let site = start_site().await;
    // static page → lite; SPA shell → browser
    let s = Session::open(&site, opts()).await.unwrap();
    assert_eq!(s.engine(), "lite");
    s.close().await;
    let s = Session::open(&format!("{site}/spa.html"), opts()).await.unwrap();
    assert_eq!(s.engine(), "cdp", "spa shell escalates");
    s.close().await;
}

#[tokio::test]
async fn cdp_goto_eval_wait_screenshot() {
    let site = start_site().await;
    let exe = std::env::var("VELOX_BROWSER").unwrap_or_default();
    if exe.is_empty() {
        eprintln!("skipping CDP test (VELOX_BROWSER not set)");
        return;
    }
    let s = Session::open(&format!("{site}/spa.html"), opts()).await.unwrap();
    assert_eq!(s.engine(), "cdp");
    // spa.html has no <title>; wait for its JS-rendered content instead
    let (s, _) = s.wait_for_selector("#js-done", Duration::from_secs(5)).await.unwrap();
    let h1 = s.text("h1").await.unwrap().unwrap();
    assert_eq!(h1, "Rendered by JS");
    let (s, _) = s.wait_for_selector("#js-done", Duration::from_secs(5)).await.unwrap();
    let text = s.text("#js-done").await.unwrap().unwrap();
    assert_eq!(text, "spa content ready");
    // evaluation round-trip
    let (s, v) = s.eval("document.querySelectorAll('h1').length").await.unwrap();
    assert_eq!(v.as_u64(), Some(1));
    let (s, v) = s.eval("1+1").await.unwrap();
    assert_eq!(v, serde_json::json!(2));
    // screenshots are real PNGs
    let (s, png) = s.screenshot(false).await.unwrap();
    assert!(png.len() > 1000, "screenshot bytes: {}", png.len());
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    // pdf is a real pdf
    let (s, pdf) = s.pdf(Some("A4")).await.unwrap();
    assert!(pdf.len() > 1000);
    assert_eq!(&pdf[..4], b"%PDF");
    s.close().await;
}

#[tokio::test]
async fn cookies_roundtrip() {
    let site = start_site().await;
    let exe = std::env::var("VELOX_BROWSER").unwrap_or_default();
    if exe.is_empty() {
        eprintln!("skipping CDP cookie test (VELOX_BROWSER not set)");
        return;
    }
    let opts = OpenOpts { engine: Some("cdp".into()), ..opts() };
    let s = Session::open(&format!("{site}/setcookie"), opts).await.unwrap();
    let cookies = s.cookies().await.unwrap();
    assert!(cookies.iter().any(|c| c.name == "fromserver" && c.value == "yes"), "cookie from the server lands in the jar");
    s.close().await;
}

#[tokio::test]
async fn discovery_finds_a_browser() {
    let found = velox_core::discover();
    if std::env::var("VELOX_BROWSER").is_ok() {
        assert!(!found.is_empty() || !std::env::var("VELOX_BROWSER").unwrap().is_empty());
    }
    let _ = velox_core::find_browser(None).expect("some browser resolves");
}

#[test]
fn needs_js_reference_cases() {
    use velox_core::needs_js::needs_js;
    // spa shell, no SSR state → needs JS
    let spa = r#"<div id="root"></div><script src="/a.js"></script><script src="/b.js"></script>"#;
    assert!(needs_js(200, None, false, spa));
    // SSR'd spa → fine over HTTP
    let ssr = r#"<div id="root"><script id="__NEXT_DATA__">{}</script></div>"#;
    assert!(!needs_js(200, None, false, ssr));
    // 403 from a bot-management edge → needs JS
    assert!(needs_js(403, Some("cloudflare"), false, "<html></html>"));
    // plain big static page → fine
    let big = format!("<p>{}</p>", "x".repeat(5000));
    assert!(!needs_js(200, None, false, &big));
}

#[test]
fn cookie_normalization_dots_domains() {
    use velox_core::cdp::page::{normalize_cookies, Cookie};
    let out = normalize_cookies(vec![Cookie {
        name: "a".into(),
        value: "1".into(),
        domain: "amazon.com".into(), // no leading dot — the classic silent bug
        path: "".into(),
        expires: None,
        http_only: false,
        secure: false,
        same_site: None,
    }]);
    assert_eq!(out[0].domain, ".amazon.com");
    assert_eq!(out[0].path, "/");
}
