#!/bin/bash
# PRIOR ART: /root/cli38-6182/judge-driver-xl.sh (#6331's Opus judge driver), copied with the paths and model made
# arguments. One `claude -p` per part, 3 at a time, sleeping through subscription limits.
#   judge-driver.sh <dir with in-NN.jsonl> <model: opus | claude-fable-5-1> [parallel]
# The prompt file JUDGE-PROMPT.md is copied into the dir as PROMPT.md. Progress: <dir>/driver.log, last line ALL DONE.
DIR=$(realpath "$1"); MODEL=$2; PAR=${3:-3}
cp "$(dirname "$(realpath "$0")")/JUDGE-PROMPT.md" "$DIR/PROMPT.md"
LOG=$DIR/driver.log
run_one() {  # $1 = in-file path
  local in=$1; local out=${in/\/in-/\/out-}; local base=${in##*/}
  [ -f "$out" ] && [ "$(wc -l <"$out")" = "$(wc -l <"$in")" ] && return 0
  for try in $(seq 1 30); do
    rm -f "$out"
    echo "Read $DIR/PROMPT.md and follow it exactly, with INPUT_FILE = $in and OUTPUT_FILE = $out. Judge every item in INPUT_FILE (count its lines first). Do not read any other file." \
      | (cd /tmp && timeout 3600 claude -p --model "$MODEL" --allowedTools "Bash" "Read" "Write") > "$DIR/.log-$base" 2>&1
    if [ -f "$out" ] && [ "$(wc -l <"$out")" = "$(wc -l <"$in")" ]; then
      echo "$(date -u +%FT%H:%M) OK $base" >> $LOG; return 0; fi
    if grep -qiE "limit|usage|rate|overloaded|529|quota" "$DIR/.log-$base"; then
      echo "$(date -u +%FT%H:%M) LIMIT $base try $try; sleeping 20m" >> $LOG; sleep 1200
    else
      echo "$(date -u +%FT%H:%M) FAIL $base try $try: $(tail -c 200 "$DIR/.log-$base" | tr '\n' ' ')" >> $LOG
      [ $try -ge 3 ] && return 1; sleep 60
    fi
  done; return 1
}
export -f run_one; export LOG DIR MODEL
echo "$(date -u +%FT%H:%M) START $MODEL" >> $LOG
ls $DIR/in-*.jsonl | xargs -P $PAR -I{} bash -c 'run_one {}'
echo "$(date -u +%FT%H:%M) ALL DONE" >> $LOG
