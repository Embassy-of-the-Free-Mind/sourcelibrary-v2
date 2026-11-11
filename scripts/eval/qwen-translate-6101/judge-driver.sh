#!/bin/bash
# PRIOR ART: scripts/eval/g4-xl-6750/judge-driver.sh (#6750) — copied with the paths, the Write tool and the round argument changed.
# #6101 Qwen translation eval: Opus judge driver. One `claude -p --model opus` per part (Claude subscription), 3 at a time,
# sleeping through subscription limits.   judge-driver.sh <JOB_DIR> <round>
D=$1; R=$2; cd "$D/judge/r$R" || exit 2
LOG=$D/judge/driver-r$R.log
run_one() {  # $1 = in-file
  local in=$1; local out=${in/in-/out-}
  [ -f "$out" ] && [ "$(wc -l <"$out")" = "$(wc -l <"$in")" ] && return 0
  for try in $(seq 1 30); do
    rm -f "$out"
    echo "Read $PWD/PROMPT.md and follow it exactly, with INPUT_FILE = $PWD/$in and OUTPUT_FILE = $PWD/$out. Judge every item in INPUT_FILE (count its lines first) and open each item's image. Do not read any other file under $D except the images INPUT_FILE names." \
      | (cd /tmp && timeout 3600 /usr/bin/claude -p --model opus --allowedTools "Bash" "Read" "Write") > ".log-$in" 2>&1
    if [ -f "$out" ] && [ "$(wc -l <"$out")" = "$(wc -l <"$in")" ]; then
      echo "$(date -u +%FT%H:%M) OK $in" >> $LOG; return 0; fi
    if grep -qiE "limit|usage|rate|overloaded|529|quota" ".log-$in"; then
      echo "$(date -u +%FT%H:%M) LIMIT $in try $try; sleeping 20m" >> $LOG; sleep 1200
    else
      echo "$(date -u +%FT%H:%M) FAIL $in try $try: $(tail -c 200 ".log-$in" | tr '\n' ' ')" >> $LOG
      [ $try -ge 3 ] && return 1; sleep 60
    fi
  done; return 1
}
export -f run_one; export LOG D
echo "$(date -u +%FT%H:%M) START r$R" >> $LOG
ls in-J*.jsonl | xargs -P 3 -I{} bash -c 'run_one {}'
echo "$(date -u +%FT%H:%M) ALL DONE r$R" >> $LOG
