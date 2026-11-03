#!/usr/bin/env bash
# PRIOR ART: scripts/batch/g4-reread-6769/driver.sh (a chunked, resumable driver that pages ntfy at the end); the screen
# itself is scripts/audit/leaf-shift-screen-5021.mjs (build + claude/agy arms, unchanged; both skip answered keys).
#
# scale-runner.sh ARM PREFIX QUEUE_DIR OUT_DIR — the #5021 wrong-leaf screen over the queue.py chunks PREFIX-NNN.jsonl,
# in order, one page window per call. Resumable: a chunk's requests are built once and each arm skips answered keys.
#   ARM = sonnet  claude -p --model sonnet on this box's login; stops at --max-weekly (MAX_WEEKLY, default 90).
#   ARM = agy     agy gemini-3.8-flash-low on AGY_HOME (default /root/.agy-milo, NOT root's Latin pool); stops on quota.
# Stops at the first chunk the arm leaves unfinished (a quota stop), or at STOP_FILE. Pages ntfy when it ends.
# Read-only on pages and books: answers go to files under OUT_DIR only.
set -uo pipefail
ARM=$1; PREFIX=$2; QUEUE=$3; OUT=$4
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
MAX_WEEKLY=${MAX_WEEKLY:-90}
STOP_FILE=${STOP_FILE:-$OUT/STOP-$ARM}
export AGY_HOME=${AGY_HOME:-/root/.agy-milo}
cd "$REPO"
done_chunks=0; reason="queue finished"
for f in "$QUEUE"/"$PREFIX"-*.jsonl; do
  [ -e "$STOP_FILE" ] && { reason="stop file"; break; }
  name=$(basename "$f" .jsonl)
  if [ ! -s "$OUT/$name/requests.jsonl" ]; then
    node --env-file=.env.production.local scripts/audit/leaf-shift-screen-5021.mjs build --items "$f" --out "$OUT" --name "$name" --prompt v3 || { reason="build failed on $name"; break; }
  fi
  if [ "$ARM" = sonnet ]; then
    node scripts/audit/leaf-shift-screen-5021.mjs claude --out "$OUT" --name "$name" --model sonnet --concurrency "${CONC:-6}" --max-weekly "$MAX_WEEKLY"
    ans="$OUT/$name/answers-claude-sonnet.jsonl"
  else
    node scripts/audit/leaf-shift-screen-5021.mjs agy --out "$OUT" --name "$name" --model gemini-3.8-flash-low --concurrency "${CONC:-4}"
    ans="$OUT/$name/answers-agy-gemini-3.8-flash-low.jsonl"
  fi
  want=$(wc -l < "$OUT/$name/requests.jsonl"); got=$(grep -c '"answer":"' "$ans" 2>/dev/null || echo 0)
  echo "$(date -u +%FT%TZ) $name answered $got/$want"
  # A quota stop leaves the chunk short; a few unparseable replies do not.
  if [ "$got" -lt $((want * 95 / 100)) ]; then reason="quota stop in $name ($got/$want)"; break; fi
  done_chunks=$((done_chunks + 1))
done
curl -s -o /dev/null -d "#5021 wrong-leaf screen ($ARM, $PREFIX): $done_chunks chunks done, ended: $reason. Answers under $OUT." "$NTFY" || true
echo "END $ARM $PREFIX: $done_chunks chunks, $reason"
