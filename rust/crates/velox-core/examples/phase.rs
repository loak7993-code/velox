// phase timing for the cdp open path
use std::time::{Duration, Instant};
use velox_core::cdp::browser::Browser;
use velox_core::cdp::page::{GotoOpts, PageOpts, WaitUntil};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let t0 = Instant::now();
    let mut b = Browser::launch(Default::default()).await?;
    let t1 = Instant::now();
    let page = b
        .new_page(PageOpts {
            intercept: true,
            ..Default::default()
        })
        .await?;
    let t2 = Instant::now();
    let nav = page
        .goto(
            "http://127.0.0.1:36369/",
            GotoOpts {
                wait_until: Some(WaitUntil::Interactive),
                timeout: Some(Duration::from_secs(30)),
                referer: None,
            },
        )
        .await?;
    let t3 = Instant::now();
    let _ = page.eval("document.title").await?;
    let t4 = Instant::now();
    page.close().await;
    let t5 = Instant::now();
    b.close().await;
    let t6 = Instant::now();
    println!(
        "launch {}ms | new_page {}ms | goto {}ms ({}ms) | eval {}ms | page.close {}ms | browser.close {}ms",
        (t1 - t0).as_millis(),
        (t2 - t1).as_millis(),
        (t3 - t2).as_millis(),
        nav.ms,
        (t4 - t3).as_millis(),
        (t5 - t4).as_millis(),
        (t6 - t5).as_millis()
    );
    Ok(())
}
