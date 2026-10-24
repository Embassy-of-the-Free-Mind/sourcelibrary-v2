#!/bin/bash
# PRIOR ART: scripts/eval/librarian-speed-6904/judge-driver.sh — one packet per `claude -p` Opus judge on the
# subscription, a few at a time, exit 3 on a usage limit. Changed: the reply is a per-link label list
# ({"links":[…]}), and packets are selected by a glob so before/after and J1/J2 run from one directory.
# Usage: bash judge-driver.sh <judge dir> <glob, e.g. '*-before-J1'>   (skips finished packets)
#   PROMPT=VERIFY-PROMPT.md KEY=verdict bash judge-driver.sh <moves dir> '*'   (the re-point check)
W=$1; GLOB=$2; P=${P:-4}
HERE=$(cd "$(dirname "$0")" && pwd)
PROMPT=${PROMPT:-$HERE/JUDGE-PROMPT.md}; case "$PROMPT" in /*) ;; *) PROMPT=$HERE/$PROMPT ;; esac
KEY=${KEY:-links}
mkdir -p "$W/out"
run_one() {  # $1 = packet path
  local p=$1 base; base=$(basename "$p" .md); local out="$W/out/$base.json"
  [ -s "$out" ] && return 0
  [ -f "$W/LIMIT" ] && return 3
  for try in 1 2 3; do
    cat "$PROMPT" "$p" | (cd /tmp && env -u ANTHROPIC_API_KEY timeout 1200 "${CLAUDE_BIN:-$HOME/.local/bin/claude}" -p --model opus --allowedTools "") > "$W/out/.log-$base" 2>&1
    if grep -oE "\{\"$KEY\".*\}" "$W/out/.log-$base" | tail -1 > "$out.tmp" && [ -s "$out.tmp" ] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$out.tmp" 2>/dev/null; then
      mv "$out.tmp" "$out"; return 0; fi
    rm -f "$out.tmp"
    if grep -qiE "usage limit|hit your limit|limit reached|quota" "$W/out/.log-$base"; then touch "$W/LIMIT"; return 3; fi
    sleep 20
  done; return 1
}
export -f run_one; export W HERE PROMPT KEY
rm -f "$W/LIMIT"
ls "$W"/packets/$GLOB.md | xargs -P "$P" -I{} bash -c 'run_one {}'
[ -f "$W/LIMIT" ] && exit 3; exit 0
