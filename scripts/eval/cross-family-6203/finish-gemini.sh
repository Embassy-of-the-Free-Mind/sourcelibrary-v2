#!/usr/bin/env bash
# PRIOR ART: scripts/audit/convergent-audit-weekly.sh (the weekly two-reader sequence, its own draw and reader names)
# and README.md beside this (the same steps, by hand). The Opus half of a cross-family run is made on a box with no
# `agy` CLI and committed as evidence; this finishes it on the main box: rebuild the run dir from the evidence, read
# every page with Gemini through the CLI, score both readers, pack the result back.
#
#   scripts/eval/cross-family-6203/finish-gemini.sh scripts/eval/results/cross-family-6203/2026-10-12 <model>
#   <model>: the best Pro or 3.8 model `agy models` lists. $0 (subscription). Resumable: run it again after a quota stop.
set -u
EVID="${1:?evidence dir}"; MODEL="${2:?model (see: agy models)}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$REPO" || exit 1
RUN="${XFAM_RUN:-${JOB_SCRATCH:-/tmp}/cross-family-6203/$(basename "$EVID")}"
ENV="${XFAM_ENV:-$REPO/.env.production.local}"
A=scripts/eval/cross-family-6203/KIND-ADDENDUM.md
[ -d "$RUN/packets" ] || node --env-file="$ENV" scripts/eval/cross-family-6203/run.mjs restore --from "$EVID" --run "$RUN" || exit 1
[ -s "$RUN/readers/gemini/requests.jsonl" ] || node scripts/eval/second-reader/second-reader.mjs cli-requests --run "$RUN" --reader gemini --addendum "$A" || exit 1
python3 scripts/eval/run-cli-arm.py --requests "$RUN/readers/gemini/requests.jsonl" --out "$RUN/readers/gemini/cli-out.jsonl" \
  --arm xfam6203-gemini --model "$MODEL" --job cross-family-6203 --kind review --parallel 2 --attempts 4 --workdir "$RUN/cli-ws"
rc=$?
node scripts/eval/second-reader/second-reader.mjs cli-assemble --run "$RUN" --reader gemini
node scripts/eval/cross-family-6203/run.mjs score --run "$RUN" --readers opus,gemini
node scripts/eval/cross-family-6203/run.mjs pack --run "$RUN" --out "$EVID"
[ "$rc" -eq 0 ] || { echo "the Gemini runner ended with exit $rc (3 = quota): run this again to resume; the report above says what is missing"; exit "$rc"; }
