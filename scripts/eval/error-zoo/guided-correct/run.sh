#!/usr/bin/env bash
# PRIOR ART: scripts/eval/error-zoo/calib-read-opus.sh (runs a sealed reader per arm); this runs correct.mjs per page
# per arm, because its --instruction-file is one text per run (see build.py). Writes nothing to the database: both
# arms correct the frozen draft (--draft-dir, CANDIDATE_READS=off), and correct.mjs never writes pages.
# Usage: run.sh <out dir from build.py> [parallel=3]     (from the repo root, with .env.production.local)
set -u
OUT="$(cd "$1" && pwd)"; PAR="${2:-3}"
export CANDIDATE_READS=off
one() {  # $1 arm, $2 page dir
  local arm="$1" d="$2" extra=()
  [ -f "$d/reads/$(basename "$d").txt" ] || [ -f "$d/reads/$(basename "$d").meta.json" ] && return 0   # done
  [ "$arm" = B ] && extra=(--instruction-file="$d/instruction.txt")
  node --no-warnings --env-file=.env.production.local scripts/batch/ocr-convergence/correct.mjs --set-dir="$d" --model=opus \
    --per-call=1 --concurrency=1 --fresh --draft-dir="$OUT/draft" --job=guided-correct "${extra[@]}" > "$d/run.log" 2>&1
  local rc=$?; echo "$arm $(basename "$d") exit $rc"; [ $rc -eq 3 ] && touch "$OUT/STOPPED-usage-limit"
  return 0
}
export -f one; export OUT
for arm in A B; do
  ls -d "$OUT/$arm"/*/ | sed 's#/$##' | while read -r d; do [ -e "$OUT/STOPPED-usage-limit" ] && break; echo "$arm $d"; done
done | xargs -P "$PAR" -L 1 bash -c 'one "$0" "$1"'
echo "done; stopped on a usage limit: $([ -e "$OUT/STOPPED-usage-limit" ] && echo yes || echo no)"
