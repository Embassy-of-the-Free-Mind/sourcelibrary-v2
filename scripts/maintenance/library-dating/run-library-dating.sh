#!/bin/bash
# Date the library's work queue on the agy CLI (#6721), $0. On a quota stop (exit 3) wait 30 min and resume; on a clean
# finish write DONE. Same shape as /root/aliveness/run-dates.sh (#6652).
#   run-library-dating.sh <run-dir> <model> [per-hour] [extra date-books.mjs args, e.g. --reverse --also-done f]
#   e.g. nohup scripts/maintenance/library-dating/run-library-dating.sh $JOB_SCRATCH/run1 claude-sonnet-5-5-low 600 &
set -u
DIR=$1; MODEL=$2; PER_HOUR=${3:-600}; shift 3 2>/dev/null || shift $#; EXTRA=("$@")
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$DIR/dated-$MODEL.jsonl"; LOG="$DIR/dated-$MODEL.log"
rm -f "$DIR/DONE-$MODEL"
for try in $(seq 1 96); do
  node "$HERE/date-books.mjs" "$DIR/queue.jsonl" "$OUT" --engine agy --model "$MODEL" --batch 15 --conc 6 --per-hour "$PER_HOUR" "${EXTRA[@]}" >> "$LOG" 2>&1
  rc=$?
  [ $rc -eq 3 ] || break
  echo "$(date -u +%FT%TZ) quota stop; sleeping 30 min (try $try)" >> "$LOG"
  sleep 1800
done
echo "$(date -u +%FT%TZ) exit $rc" >> "$LOG"
date -u > "$DIR/DONE-$MODEL"
