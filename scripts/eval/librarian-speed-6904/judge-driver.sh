#!/bin/bash
# PRIOR ART: scripts/eval/agentic-qa-6182/judge-driver.sh — one packet per `claude -p` Opus judge on the
# subscription, a few at a time, exit 3 on a usage limit. Changed: the packet is piped in with the prompt
# (no file tools), and the answer is one JSON line per packet.
# Usage: bash judge-driver.sh <judge dir> <judge J1|J2|J3> [pairs file]   (skips finished packets)
W=$1; J=$2; PAIRS=${3:-}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/out"
run_one() {  # $1 = packet path
  local p=$1 base; base=$(basename "$p" .md); local out="$W/out/$base.json"
  [ -s "$out" ] && return 0
  [ -f "$W/LIMIT" ] && return 3
  for try in 1 2 3; do
    cat "$HERE/JUDGE-PROMPT.md" "$p" | (cd /tmp && env -u ANTHROPIC_API_KEY timeout 900 "${CLAUDE_BIN:-$HOME/.local/bin/claude}" -p --model opus --allowedTools "") > "$W/out/.log-$base" 2>&1
    if grep -oE '\{"verdict".*\}' "$W/out/.log-$base" | tail -1 > "$out.tmp" && [ -s "$out.tmp" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$out.tmp" 2>/dev/null; then
      mv "$out.tmp" "$out"; return 0; fi
    rm -f "$out.tmp"
    if grep -qiE "usage limit|hit your limit|limit reached|quota" "$W/out/.log-$base"; then touch "$W/LIMIT"; return 3; fi
    sleep 20
  done; return 1
}
export -f run_one; export W HERE
rm -f "$W/LIMIT"
if [ -n "$PAIRS" ]; then sed "s#.*#$W/packets/&-$J.md#" "$PAIRS"; else ls "$W"/packets/*-"$J".md; fi | xargs -P 4 -I{} bash -c 'run_one {}'
[ -f "$W/LIMIT" ] && exit 3; exit 0
