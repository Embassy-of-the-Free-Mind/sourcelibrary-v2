#!/bin/bash
# Write dated rows as the dater produces them (#6721): every 20 min run write-dates.mjs over everything dated so far
# (it skips books already written in this run by their own run_id), and once the dater has written DONE-<model>,
# one last pass, then WRITE-DONE.   write-loop.sh <run-dir> <model> <run_id>
set -u
DIR=$1; MODEL=$2; RUN=$3
HERE=$(cd "$(dirname "$0")" && pwd); ENV=/root/sourcelibrary/.env.production.local
while :; do
  last=0; [ -f "$DIR/DONE-$MODEL" ] && last=1
  node --env-file=$ENV "$HERE/write-dates.mjs" "$DIR/plan.json" "$RUN" "$DIR/dated-$MODEL.jsonl" >> "$DIR/write-$RUN.log" 2>&1
  [ $last -eq 1 ] && break
  sleep 1200
done
date -u > "$DIR/WRITE-DONE-$RUN"
