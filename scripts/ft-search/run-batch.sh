#!/bin/sh
# Run the fresh prior-translation search over a batch directory (#7598): one lean Sonnet
# `claude -p` per book, P in parallel. Resumable: run it again and finished books are skipped.
#
#   CLAUDE_CONFIG_DIR=~/.claude-team scripts/ft-search/run-batch.sh <dir> [parallel=4]
#
# Detached on the laptop:
#   nohup caffeinate -i scripts/ft-search/run-batch.sh <dir> 4 >/dev/null 2>&1 & disown
# progress.log gets one line per book and BATCHDONE at the end. Touch <dir>/STOP to refuse a start.
#
# When every book has run, the batch APPLIES ITSELF (a batch used to wait on whoever launched it: batch 3,
# 2026-10-28, sat un-ingested in a scratchpad). Launch it with the env loaded (MONGODB_URI, SUPABASE_*), then:
#   1 parse-results.py            2 ingest.mjs --apply         3 harvest-ft-into-translation-catalogs --from-credits
#   4 update-homepage-stats.mjs   5 recheck-credits prepare -> run-batch.sh on <dir>-recheck -> apply --no-retract
#   6 ONE ntfy page: counts, and how many credit retractions are held for review (file: <dir>-recheck/retractions-held.json)
# Retractions stay manual. Any step that fails pages ntfy and STOPS the chain; nothing after it runs.
# NO_AUTO_APPLY=1 keeps the old behaviour (parse + ingest dry run into postrun.txt, page, apply by hand).
# A dir holding NO_POSTRUN (recheck, held) or GATE (read-only propagation gate) stops after the searches.
# Keep <dir> out of a session scratchpad: /private/tmp is cleared on reboot.
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$1; P=${2:-4}
cd "$DIR" || exit 1
DIR=$(pwd)
[ -f STOP ] && { echo "STOP file present in $DIR; remove it to run"; exit 1; }
xargs -P "$P" -n1 "$HERE/search-one.sh" < ids.txt
echo BATCHDONE >> progress.log

[ -f STOP ] && exit 0   # stopped by the meter guard: no post-run until the batch is resumed and finished
[ -f NO_POSTRUN ] || [ -f GATE ] && exit 0
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
REPO=$(cd "$HERE/../.." && pwd)
NAME=$(basename "$DIR")
page() { curl -s -m 10 -H "Title: $1" -d "$2" "$NTFY" >/dev/null || true; }
# step <name> <command...>: output goes to postrun.txt; a failure pages and ends the whole chain.
step() {
  name=$1; shift
  echo "=== $name ($(date -u +%H:%M:%S))" >> postrun.txt
  "$@" >> postrun.txt 2>&1 || { rc=$?; echo "STEP FAILED: $name (exit $rc)" >> postrun.txt; page "ft-search batch FAILED at $name: $NAME" "Step '$name' exited $rc; later steps did NOT run. See $DIR/postrun.txt (#7598)"; exit 1; }
}
: > postrun.txt
if [ -z "$MONGODB_URI" ]; then
  page "ft-search batch NOT applied: $NAME" "MONGODB_URI was not set when the batch was launched, so nothing was parsed or ingested. Run the post-run by hand (skill steps 4-9b, #7598)."
  exit 1
fi

if [ -n "$NO_AUTO_APPLY" ]; then
  step parse python3 -I "$HERE/parse-results.py" "$DIR"
  step ingest-dry-run sh -c "cd '$REPO' && node '$HERE/ingest.mjs' '$DIR'"
  page "ft-search batch done: $NAME" "$(head -c 900 postrun.txt) -- NO_AUTO_APPLY: next ingest --apply, skill steps 6-11 (#7598)"
  exit 0
fi

step parse python3 -I "$HERE/parse-results.py" "$DIR"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)   # credits written by this ingest carry verified_at >= this
echo "$SINCE" > ingest-since.txt
step ingest-apply sh -c "cd '$REPO' && node '$HERE/ingest.mjs' '$DIR' --apply"
touch INGESTED
step harvest-credits sh -c "cd '$REPO' && node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs --from-credits --since '$SINCE' --apply"
step homepage-stats sh -c "cd '$REPO' && node scripts/maintenance/update-homepage-stats.mjs"

RECHECK="$DIR-recheck"
step recheck-prepare sh -c "cd '$REPO' && node '$HERE/recheck-credits.mjs' prepare '$RECHECK' --since '$SINCE'"
if [ "$(grep -c . "$RECHECK/ids.txt" 2>/dev/null)" -gt 0 ] 2>/dev/null; then
  step recheck-search "$HERE/run-batch.sh" "$RECHECK" "$P"   # NO_POSTRUN: searches only; search-one.sh runs claude in a clean env
  step recheck-apply sh -c "cd '$REPO' && node '$HERE/recheck-credits.mjs' apply '$RECHECK' --apply --no-retract"
fi

HELD=0
[ -f "$RECHECK/retractions-held.json" ] && HELD=$(python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))))" "$RECHECK/retractions-held.json")
SUMMARY=$(grep -E '^(parsed|APPLIED|DRY RUN)' postrun.txt | cut -c1-300 | head -c 1200)
page "ft-search batch applied: $NAME" "$SUMMARY
Retractions held for review: $HELD$( [ "$HELD" -gt 0 ] && echo " -> $RECHECK/retractions-held.json" ) (#7598)"
