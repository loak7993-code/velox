#!/usr/bin/env bash
# bench.sh — head-to-head: JS velox (node bin/vlx.js) vs vlx-rs, same binary, same URL.
# Usage: SITE=http://127.0.0.1:40661 ./bench.sh [iters]
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="${SITE:-http://127.0.0.1:40661}"
ITERS="${1:-5}"
export VELOX_BROWSER="${VELOX_BROWSER:-$HOME/.browsers/chrome-headless-shell-linux64/chrome-headless-shell}"
export VELOX_NO_SANDBOX=1
export PATH="$HOME/.cargo/bin:$PATH"

median() { printf '%s\n' "$@" | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}'; }

time_run() {
  # $1 = label, runs the command ITERS times, prints median ms
  local label="$1"; shift
  local times=()
  for _ in $(seq 1 "$ITERS"); do
    local s=$(date +%s%N)
    "$@" >/dev/null 2>&1
    times+=($(( ($(date +%s%N) - s) / 1000000 )))
  done
  printf '%-42s %sms (median of %s)\n' "$label" "$(median "${times[@]}")" "$ITERS"
}

echo "velox — JS vs Rust, same test site ($SITE), $ITERS iterations"
echo "─────────────────────────────────────────────────────────────"
time_run "open (auto engine)      node" node bin/vlx.js open "$SITE" -q
time_run "open (auto engine)      vlx-rs" rust/target/release/vlx-rs open "$SITE"
time_run "open --engine cdp       node" node bin/vlx.js open "$SITE" --js -q
time_run "open --engine cdp       vlx-rs" rust/target/release/vlx-rs open "$SITE" --engine cdp
time_run "eval document.title     node" node bin/vlx.js eval "$SITE" "document.title"
time_run "eval document.title     vlx-rs" rust/target/release/vlx-rs eval "$SITE" "document.title"
time_run "shot (full)             node" node bin/vlx.js shot "$SITE" --full -o /tmp/bench-js.png -q --js
time_run "shot (full)             vlx-rs" rust/target/release/vlx-rs shot "$SITE" --full -o /tmp/bench-rs.png
time_run "links                   node" node bin/vlx.js links "$SITE" -q
time_run "links                   vlx-rs" rust/target/release/vlx-rs links "$SITE"
echo "─────────────────────────────────────────────────────────────"
echo "runtime: node $(node --version) | $(rustc -V) (cargo)"
