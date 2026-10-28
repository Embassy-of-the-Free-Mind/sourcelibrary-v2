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
# When every book has run, it parses the results and does the ingest DRY RUN itself (into
# <dir>/postrun.txt) and pages ntfy, so a batch never waits on the session that launched it:
# batch 3 (2026-10-28) finished at 20:40Z and sat un-ingested in a scratchpad until someone looked.
# Launch it with the env loaded (MONGODB_URI) so the dry run can read the books. --apply stays manual.
# Keep <dir> out of a session scratchpad: /private/tmp is cleared on reboot.
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=$1; P=${2:-4}
cd "$DIR" || exit 1
DIR=$(pwd)
[ -f STOP ] && { echo "STOP file present in $DIR; remove it to run"; exit 1; }
xargs -P "$P" -n1 "$HERE/search-one.sh" < ids.txt
echo BATCHDONE >> progress.log

[ -f STOP ] && exit 0   # stopped by the meter guard: no post-run until the batch is resumed and finished
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
REPO=$(cd "$HERE/../.." && pwd)
{
  python3 -I "$HERE/parse-results.py" "$DIR"
  if [ -n "$MONGODB_URI" ]; then (cd "$REPO" && node "$HERE/ingest.mjs" "$DIR"); else echo "MONGODB_URI not set: run the ingest dry run by hand"; fi
} > postrun.txt 2>&1
curl -s -m 10 -H "Title: ft-search batch done: $(basename "$DIR")" -d "$(head -c 900 postrun.txt) -- next: ingest --apply, skill steps 6-11 (#7598)" "$NTFY" >/dev/null || true
