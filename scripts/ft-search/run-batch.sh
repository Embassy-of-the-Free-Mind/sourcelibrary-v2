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
#   5b work-conflicts.mjs: works with a first-badged edition beside a credited one -> check, covers_part credited, covers_all HELD
#   5c archive-run.sh: tar the run (+ -recheck, -workconflicts) to R2 ft-search-runs/<name>.tgz and ~/ft-batches/archive/
#   6 ONE ntfy page: counts, and how many changes are held for review (book_events ft_change_held_for_review; held-review.mjs lists them)
# Retractions and badge removals stay manual. Any step that fails pages ntfy and STOPS the chain; nothing after it runs.
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

# Works whose editions disagree: a first-badged book beside a sibling edition with a complete credit. Only works this
# ingest touched (--since). covers_part adds a partial credit; covers_all (badge removal) is HELD for review.
CONFL="$DIR-workconflicts"
step conflicts-prepare sh -c "cd '$REPO' && node '$HERE/work-conflicts.mjs' '$CONFL' --since '$SINCE'"
if [ "$(grep -c . "$CONFL/ids.txt" 2>/dev/null)" -gt 0 ] 2>/dev/null; then
  step conflicts-search "$HERE/run-batch.sh" "$CONFL" "$P"   # NO_POSTRUN: searches only
  step conflicts-apply sh -c "cd '$REPO' && node '$HERE/work-conflicts.mjs' apply '$CONFL' --apply"
fi

count_json() { [ -f "$1" ] && python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))))" "$1" || echo 0; }
HELD_RETRACT=$(count_json "$RECHECK/retractions-held.json")
HELD_BADGE=$(count_json "$CONFL/work-conflicts-held.json")
HELD=$((HELD_RETRACT + HELD_BADGE))
# Raw run to R2 (ft-search-runs/<name>.tgz) and a local copy; an R2 failure is reported, not fatal.
step archive sh -c "'$HERE/archive-run.sh' '$DIR'"
ARCH=$(grep '^ARCHIVE' postrun.txt | tail -1)
SUMMARY=$(grep -E '^(parsed|APPLIED|DRY RUN)' postrun.txt | cut -c1-300 | head -c 1200)
page "ft-search batch applied: $NAME" "$SUMMARY
Held for review: $HELD ($HELD_RETRACT credit retractions, $HELD_BADGE badge removals; list: node scripts/ft-search/held-review.mjs list --since ${SINCE%%T*}) (#7598)
$ARCH"
