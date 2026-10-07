// velox-rs build script — extracts the in-page selector engine from the shared
// JS source (src/cdp/inject.js) so the Rust driver injects byte-identical
// selector semantics. The engine is the operator's own code; both engines
// deliberately stay in lockstep from one source file.
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let inject = manifest.join("../../../src/cdp/inject.js");
    println!("cargo:rerun-if-changed={}", inject.display());
    let src = fs::read_to_string(&inject).expect("read src/cdp/inject.js");

    // The engine lives between the first `String.raw\`` and its closing backtick.
    let start_marker = "String.raw`";
    let start = src
        .find(start_marker)
        .expect("inject.js: String.raw` marker not found")
        + start_marker.len();
    let end = src[start..]
        .find('`')
        .map(|i| start + i)
        .expect("inject.js: closing backtick not found");
    let engine = &src[start..end];

    // The stealth injection template lives in src/cdp/stealth.js between
    // `return String.raw\`` and its closing backtick. It contains ONE nested
    // conditional literal (`${r.hideEngine ? String.raw`…` : ''}`) which we
    // extract separately and splice at runtime.
    let stealth_path = manifest.join("../../../src/cdp/stealth.js");
    println!("cargo:rerun-if-changed={}", stealth_path.display());
    let st = fs::read_to_string(&stealth_path).expect("read src/cdp/stealth.js");
    let st_start_marker = "return String.raw`";
    let st_start = st
        .find(st_start_marker)
        .expect("stealth.js: template marker")
        + st_start_marker.len();
    let st_end = st[st_start..]
        .find("`;")
        .map(|i| st_start + i)
        .expect("stealth.js: closing backtick");
    let stealth_template = &st[st_start..st_end];

    // nested hideEngine block
    let hide_marker = "${r.hideEngine ? String.raw`";
    let hide_block = match stealth_template.find(hide_marker) {
        Some(i) => {
            let h_start = i + hide_marker.len();
            let h_end = stealth_template[h_start..]
                .find("` : ''}")
                .map(|j| h_start + j);
            match h_end {
                Some(end) => stealth_template[h_start..end].to_string(),
                None => String::new(),
            }
        }
        None => String::new(),
    };
    // remove the conditional from the template; splice it back in at runtime
    let stealth_template = match stealth_template.find(hide_marker) {
        Some(i) => {
            let end = stealth_template[i..]
                .find("` : ''}")
                .map(|j| i + j + "` : ''}".len())
                .unwrap_or(stealth_template.len());
            format!("{}{}", &stealth_template[..i], &stealth_template[end..])
        }
        None => stealth_template.to_string(),
    };

    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out.join("engine.js"), engine).expect("write engine.js");
    fs::write(out.join("stealth_template.js"), &stealth_template)
        .expect("write stealth_template.js");
    fs::write(out.join("stealth_hide_engine.js"), &hide_block)
        .expect("write stealth_hide_engine.js");

    // includable asset module (avoids non-UTF8/escape issues with include_str! of raw JS)
    fn as_const(name: &str, body: &str) -> String {
        // raw string literal with a hash suffix so `#"` inside JS can't break it
        let mut hashes = String::from('#');
        while body.contains(&format!("{hashes}\"")) {
            hashes.push('#');
        }
        format!("pub const {name}: &str = r{hashes}\"{body}\"{hashes};\n")
    }
    let mut assets = String::new();
    assets.push_str(&as_const("STEALTH_TEMPLATE", &stealth_template));
    assets.push_str(&as_const("STEALTH_HIDE_ENGINE", &hide_block));
    fs::write(out.join("stealth_assets.rs"), assets).expect("write stealth_assets.rs");
}
