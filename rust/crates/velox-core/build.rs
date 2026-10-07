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

    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out.join("engine.js"), engine).expect("write engine.js");
}
