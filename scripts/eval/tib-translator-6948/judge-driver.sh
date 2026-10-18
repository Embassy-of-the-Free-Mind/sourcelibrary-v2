#!/bin/bash
# PRIOR ART: scripts/eval/g4-xl-6750/judge-driver.sh (#6750) — copied with the paths changed only (and the claude binary
# by full path: it is not on a headless job's PATH on this box). #6948: two blind Opus judges, one `claude -p --model opus`
# per part (Claude subscription, never agy), 3 at a time, sleeping through subscription limits.
cd /data/scratch/sl/jobs/tib-translator-6948
LOG=/data/scratch/sl/jobs/tib-translator-6948/judge-driver.log
run_one() {  # $1 = dir/in-file
  local dir=${1%/*} in=${1##*/}; local out=${in/in-/out-}
  [ -f "$dir/$out" ] && [ "$(wc -l <"$dir/$out")" = "$(wc -l <"$dir/$in")" ] && return 0
  for try in $(seq 1 30); do
    rm -f "$dir/$out"
    echo "Read /data/scratch/sl/jobs/tib-translator-6948/$dir/PROMPT.md and follow it exactly, with INPUT_FILE = /data/scratch/sl/jobs/tib-translator-6948/$dir/$in and OUTPUT_FILE = /data/scratch/sl/jobs/tib-translator-6948/$dir/$out. Judge every item in INPUT_FILE (count its lines first). Do not read any other file in /data/scratch/sl/jobs/tib-translator-6948." \
      | (cd /tmp && timeout 3600 /root/.local/bin/claude -p --model opus --allowedTools "Bash" "Read") > "$dir/.log-$in" 2>&1
    if [ -f "$dir/$out" ] && [ "$(wc -l <"$dir/$out")" = "$(wc -l <"$dir/$in")" ]; then
      echo "$(date -u +%FT%H:%M) OK $dir/$in" >> $LOG; return 0; fi
    if grep -qiE "limit|usage|rate|overloaded|529|quota" "$dir/.log-$in"; then
      echo "$(date -u +%FT%H:%M) LIMIT $dir/$in try $try; sleeping 20m" >> $LOG; sleep 1200
    else
      echo "$(date -u +%FT%H:%M) FAIL $dir/$in try $try: $(tail -c 200 "$dir/.log-$in" | tr '\n' ' ')" >> $LOG
      [ $try -ge 3 ] && return 1; sleep 60
    fi
  done; return 1
}
export -f run_one; export LOG
echo "$(date -u +%FT%H:%M) START" >> $LOG
for set in "judge/in-J1-*" "judge/in-J2-*"; do
  ls $set | xargs -P 3 -I{} bash -c 'run_one {}'
  echo "$(date -u +%FT%H:%M) SET DONE $set" >> $LOG
done
echo "$(date -u +%FT%H:%M) ALL DONE" >> $LOG
