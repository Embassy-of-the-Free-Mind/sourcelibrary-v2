#!/usr/bin/env bash
# PRIOR ART: #6182 / PR #6277 ran their blind judges as Opus subagents on the subscription from an interactive
# session; a headless job has no subagent fan-out, so this runs each packet part as its own `claude -p --model opus`
# session. ANTHROPIC_API_KEY is unset so the CLI can only use the subscription sign-in, never an API key.
#
#   scripts/eval/syriac-pareto-6295/run-judges.sh <work-dir> [max-parallel] [judge-dir, default judge; judge-c38 for --round c38]
# Reads <work>/<judge-dir>/in-J{1,2}-NN.jsonl, writes <work>/<judge-dir>/out-J{1,2}-NN.jsonl (skips parts already complete).
set -u
W="$1"; P="${2:-4}"; D="${3:-judge}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROMPT="$(cat "$HERE/JUDGE-PROMPT.md")"
run_part() {
  local in="$1" out="${1/in-/out-}" n have
  n=$(grep -c . "$in"); have=$( [ -f "$out" ] && grep -c . "$out" || echo 0 )
  [ "$have" -ge "$n" ] && { echo "skip $(basename "$in") ($have/$n)"; return; }
  rm -f "$out"
  local p="${PROMPT//INPUT_FILE/$in}"; p="${p//OUTPUT_FILE/$out}"
  ( cd "$(dirname "$in")" && env -u ANTHROPIC_API_KEY timeout 3000 claude -p --model opus \
      --allowedTools "Bash(sed:*)" "Bash(python3:*)" "Read" "Write" -- "$p" > "${out%.jsonl}.log" 2>&1 )
  echo "$(basename "$in") → $(grep -c . "$out" 2>/dev/null || echo 0)/$n"
}
export -f run_part; export PROMPT
ls "$W/$D"/in-J*-*.jsonl | xargs -P "$P" -I{} bash -c 'run_part "$@"' _ {}
