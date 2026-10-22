#!/usr/bin/env bash
# timeout: 4h
# issue: 6871
#
# PRIOR ART: queue-task.sh (this folder; 50-grounding-6871, the 2026-10-18 remainder: same hold.sh → ll-score.py →
# stop). This one is job grounding-6871a's preregistered amendment (PREREGISTRATION-AMENDMENT-6871a.md): the 50
# phrase plants and the 71 SKQS reads, each scored twice (fresh server for the rerun), then score-6871a.py over these
# and over the full #6420 set, and report-6871a.py posts the table + verdict to #6871 and #6420. The job that wrote it
# ran on l7a, which cannot reach gex45's shell, and ended before the GPU was free: this task scores itself.
# Queue it ahead of the next Tibetan chunk:  gpu-queue.sh add <this> 55-grounding-6871a
# Every hold.sh stops its vLLM server on exit; scoring is CPU only, after the model is stopped. Files only, no Mongo.
set -uo pipefail
J=/root/jobs/grounding-6871; A=/root/jobs/grounding-6871a; PY=/root/bench/vl/bin/python; BR=job-grounding-6871a
mkdir -p "$A/code" "$A/img"
if git -C /root/sourcelibrary fetch -q origin "$BR"; then
  git -C /root/sourcelibrary archive FETCH_HEAD scripts/eval/grounding-6871 | tar -x -C "$A/code" --strip-components=3
  git -C /root/sourcelibrary rev-parse FETCH_HEAD > "$A/code/COMMIT"
else
  echo "git fetch failed: using the code already placed in $A/code ($(cat "$A/code/COMMIT" 2>/dev/null))"
fi
[ -s "$A/code/results/items-6871a.jsonl.gz" ] || { echo "no code in $A/code: stopping before the GPU"; exit 3; }
zcat "$A/code/results/items-6871a.jsonl.gz" > "$A/code/items.jsonl"
echo "code at $(cat "$A/code/COMMIT"), $(wc -l < "$A/code/items.jsonl") items"
# 0. the 2026-10-18 remainder, only if 50-grounding-6871 never produced its results (ll-score resumes, so a repeat is cheap)
[ -s "$J/results.json" ] || { echo "no $J/results.json: running the 2026-10-18 remainder first"; bash "$J/code/queue-task.sh"; }
# 1. images (archived masters, getPageSource picks), then the two passes
$PY "$A/code/ll-score.py" fetch "$A/code/items.jsonl" "$A/img"
J=$A NOLOCK=1 SECS=3600 bash "$A/code/hold.sh" "$A/main.jsonl"
J=$A NOLOCK=1 SECS=3600 bash "$A/code/hold.sh" "$A/rerun.jsonl"
echo "rows: main $(wc -l < "$A/main.jsonl") rerun $(wc -l < "$A/rerun.jsonl"); GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
# 2. score (CPU) and report
$PY "$A/code/score-6871a.py" "$A/code/items.jsonl" "$A/main.jsonl" --rerun "$A/rerun.jsonl" --out "$A/new.json" > /dev/null
[ -s "$J/main.jsonl" ] && $PY "$A/code/score-6871a.py" "$J/code/items.jsonl" "$J/main.jsonl" --rerun "$J/rerun.jsonl" --out "$A/real6420.json" > /dev/null
$PY "$A/code/report-6871a.py" "$A" > "$A/report.md"
cat "$A/report.md"
for i in 6871 6420; do gh issue comment "$i" --repo Embassy-of-the-Free-Mind/sourcelibrary-v2 --body-file "$A/report.md" || echo "comment on #$i failed: report is $A/report.md"; done
