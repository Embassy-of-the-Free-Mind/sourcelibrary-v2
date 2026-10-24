#!/usr/bin/env bash
# timeout: 2h
# issue: 5924
# PRIOR ART: scripts/eval/latin-bakeoff-5924/queue-task.sh / gex45 gpu-queue/done/20-latin-mineru-olmocr.sh (drive.sh under
# the queue's lock with NOLOCK=1, copied); this re-reads all four GPU engines into a fresh directory instead.
# gpu-queue task 15-latin-rep-5924 (#5924 / #6871 row 2, prereg Amendment 5): run 2 of P0 P1 M G O on the same 99 fed
# images, drive.sh and read.py unchanged (only Paddle's arm name changes, so run 1's /root/pz/arms dirs stay). Files only:
# /root/jobs/latin-rep-5924/out/{P0,P1,M,G,O}.jsonl (+ .run.json), drive.log, vram-*.csv. Scoring happens off the box.
set -uo pipefail
S=/root/jobs/latin-bakeoff-5924; J=/root/jobs/latin-rep-5924
mkdir -p "$J/code" "$J/out"
cp "$S/code/read.py" "$J/code/"
sed 's/latbake5924-l/latrep5924-l/' "$S/code/drive.sh" > "$J/code/drive.sh"
for x in in in1288 pages.tsv; do [ -e "$J/$x" ] || ln -s "$S/$x" "$J/$x"; done
echo "$(date -u +%FT%TZ) [queue] start run 2; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB" >> "$J/drive.log"
J=$J NOLOCK=1 bash "$J/code/drive.sh" paddle glm mineru olmocr > "$J/drive.out" 2>&1
v=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)
[ "$v" -lt 600 ] || echo "$(date -u +%FT%TZ) [queue] WARNING GPU holds $v MiB after the arms" >> "$J/drive.log"
echo "$(date -u +%FT%TZ) [queue] done: $(ls "$J"/out/*.jsonl | xargs -n1 basename | tr '\n' ' ')" >> "$J/drive.log"
