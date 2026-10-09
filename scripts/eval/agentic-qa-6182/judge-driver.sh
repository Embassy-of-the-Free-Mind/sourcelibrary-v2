#!/bin/bash
# PRIOR ART: /mnt/HC_Volume_105839809/jobs/judge-set-6331/judge-driver.sh (#6331) — same one-packet-per-`claude -p`
# Opus judge, 3 at a time. Changed: paths, and it EXITS 3 on a usage limit instead of sleeping (the job resumes).
# Usage: bash scripts/eval/agentic-qa-6182/judge-driver.sh   (skips finished packets)
W=/mnt/HC_Volume_105839809/jobs/agentic-qa-6182
LOG=$W/judge-driver.log
run_one() {  # $1 = judge/in-file
  local dir=${1%/*} in=${1##*/}; local out=${in/in-/out-}
  cd $W
  [ -f "$dir/$out" ] && [ "$(wc -l <"$dir/$out")" = "$(wc -l <"$dir/$in")" ] && return 0
  [ -f $W/judge/LIMIT ] && return 3
  for try in 1 2 3; do
    rm -f "$dir/$out"
    echo "Read $W/$dir/PROMPT.md and follow it exactly, with INPUT_FILE = $W/$dir/$in and OUTPUT_FILE = $W/$dir/$out. Judge every item in INPUT_FILE (count its lines first). Do not read any other file in /mnt/HC_Volume_105839809/jobs, /root/cli-set-6331 or /root/pareto-6182." \
      | (cd /tmp && env -u ANTHROPIC_API_KEY timeout 3600 claude -p --model opus --allowedTools "Bash" "Read") > "$dir/.log-$in" 2>&1
    if [ -f "$dir/$out" ] && [ "$(wc -l <"$dir/$out")" = "$(wc -l <"$dir/$in")" ]; then
      echo "$(date -u +%FT%H:%M) OK $dir/$in" >> $LOG; return 0; fi
    if grep -qiE "usage limit|hit your limit|limit reached|resets|quota" "$dir/.log-$in"; then
      echo "$(date -u +%FT%H:%M) LIMIT $dir/$in: $(tail -c 200 "$dir/.log-$in" | tr '\n' ' ')" >> $LOG; touch $W/judge/LIMIT; return 3
    fi
    echo "$(date -u +%FT%H:%M) FAIL $dir/$in try $try: $(tail -c 200 "$dir/.log-$in" | tr '\n' ' ')" >> $LOG; sleep 30
  done; return 1
}
export -f run_one; export LOG W
rm -f $W/judge/LIMIT
echo "$(date -u +%FT%H:%M) START" >> $LOG
cd $W && ls judge/in-J*.jsonl | xargs -P 3 -I{} bash -c 'run_one {}'
cd $W; n_in=$(ls judge/in-J*.jsonl | wc -l); n_ok=0
for f in judge/in-J*.jsonl; do o=${f/in-/out-}; [ -f "$o" ] && [ "$(wc -l <"$o")" = "$(wc -l <"$f")" ] && n_ok=$((n_ok+1)); done
echo "$(date -u +%FT%H:%M) END $n_ok/$n_in" >> $LOG
[ $n_ok = $n_in ] && exit 0; [ -f $W/judge/LIMIT ] && exit 3; exit 1
