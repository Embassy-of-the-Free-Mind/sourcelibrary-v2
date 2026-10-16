#!/bin/bash
# PRIOR ART: /root/cli38-6182/judge-driver-xl.sh (#6331, the C38 round's driver) — copied with the paths changed only.
# #6750 C4L on the 365 xl pages: Opus judge driver. One `claude -p --model opus` per part (Claude subscription, never agy),
# 3 at a time, sleeping through subscription limits. Progress: $JOB_SCRATCH/judge-driver.log
cd /mnt/HC_Volume_105839809/jobs/g4-xl-6750
LOG=/mnt/HC_Volume_105839809/jobs/g4-xl-6750/judge-driver.log
run_one() {  # $1 = dir/in-file
  local dir=${1%/*} in=${1##*/}; local out=${in/in-/out-}
  [ -f "$dir/$out" ] && [ "$(wc -l <"$dir/$out")" = "$(wc -l <"$dir/$in")" ] && return 0
  for try in $(seq 1 30); do
    rm -f "$dir/$out"
    echo "Read /mnt/HC_Volume_105839809/jobs/g4-xl-6750/$dir/PROMPT.md and follow it exactly, with INPUT_FILE = /mnt/HC_Volume_105839809/jobs/g4-xl-6750/$dir/$in and OUTPUT_FILE = /mnt/HC_Volume_105839809/jobs/g4-xl-6750/$dir/$out. Judge every item in INPUT_FILE (count its lines first). Do not read any other file in /mnt/HC_Volume_105839809/jobs/g4-xl-6750, /root/cli38-6182, /root/pareto-6182, /root/tlev, /root/tlev2, /root/tlev3 or /root/tref." \
      | (cd /tmp && timeout 3600 claude -p --model opus --allowedTools "Bash" "Read") > "$dir/.log-$in" 2>&1
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
for set in "xljudge/in-J1-*" "xljudge/in-J2-*"; do
  ls $set | xargs -P 3 -I{} bash -c 'run_one {}'
  echo "$(date -u +%FT%H:%M) SET DONE $set" >> $LOG
done
echo "$(date -u +%FT%H:%M) ALL DONE" >> $LOG
