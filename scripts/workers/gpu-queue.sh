#!/usr/bin/env bash
# gpu-queue.sh — keep the GEX45 GPU busy with queued work, one task at a time, without a Claude session holding it (#6871).
#
# PRIOR ART: scripts/maintenance/gex45-idle-alert.sh (pages when the box is idle; queues nothing),
# scripts/gpu/idle-poweroff.sh (rented Scaleway GPUs; powers off) and scripts/audit/gpu-queue-5660.mjs (counts OCR
# owed to a GPU lane; runs nothing). None of them RUNS work. Jobs so far held /root/gpu.lock from inside a Claude
# session, which ends when the session ends: a 10 h training run or a whole-class read needs a runner that outlives it.
#
# Installed at /root/bin/gpu-queue.sh on gex45 (copy from the checkout). Cron, every 5 min (infrastructure/gex45-crontab):
#   */5 * * * * /root/bin/gpu-queue.sh run >> /var/log/sourcelibrary/gpu-queue.log 2>&1
#
#   gpu-queue.sh add <task.sh> [name]   queue a task (copied into pending/, runs in name order: prefix NN- to order)
#   gpu-queue.sh list                   pending / running / last 10 finished
#   gpu-queue.sh run                    (cron) start the first pending task if nothing is running
#
# A task is a bash script. Optional header lines:  `# timeout: 10h`  (default 6h)   `# issue: 5664`  (for the page)
# It runs with cwd /root/jobs/gpu-queue/<name>/ (watched by gex45-idle-alert.sh) under `flock /root/gpu.lock`, so it
# waits for any Claude job holding the card and they for it. It must stop every model it starts; the runner checks
# the card is back under 500 MiB afterwards and says so in the page if not. Nothing here writes to Mongo.
set -uo pipefail
Q=${GPU_QUEUE_DIR:-/root/gpu-queue}; OUT=${GPU_QUEUE_OUT:-/root/jobs/gpu-queue}
TOPIC=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
mkdir -p "$Q"/pending "$Q"/running "$Q"/done "$Q"/failed "$OUT"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
page() { curl -fsS -m 15 -H "Title: $1" -H "Priority: ${3:-low}" -H "Tags: gpu" -d "$2" "$TOPIC" >/dev/null 2>&1 || true; }

case "${1:-}" in
  add)
    src=${2:?usage: gpu-queue.sh add <task.sh> [name]}; name=${3:-$(basename "$src" .sh)}
    [ -f "$src" ] || { echo "no such file: $src" >&2; exit 2; }
    for d in pending running done failed; do [ -e "$Q/$d/$name.sh" ] && { echo "name already used ($d): $name" >&2; exit 2; }; done
    cp "$src" "$Q/pending/$name.sh"; chmod +x "$Q/pending/$name.sh"; echo "queued $name ($(ls "$Q"/pending | wc -l) pending)" ;;
  list)
    echo "running:"; ls -1 "$Q"/running | sed 's/^/  /'
    echo "pending:"; ls -1 "$Q"/pending | sed 's/^/  /'
    echo "finished (last 10):"; ls -1t "$Q"/done "$Q"/failed 2>/dev/null | grep '\.sh$' | head -10 | sed 's/^/  /' ;;
  run)
    exec 9>/tmp/gpu-queue-runner.lock; flock -n 9 || exit 0   # one runner; it holds this lock for the task's whole run
    for st in "$Q"/running/*.sh; do   # we hold the runner lock, so anything still in running/ died with an earlier runner
      [ -e "$st" ] || continue; mv "$st" "$Q/failed/"; echo "$(now) stale $(basename "$st") moved to failed/"
      page "GPU task died: $(basename "$st" .sh)" "Found in running/ with no runner (reboot or kill). Moved to failed/; re-add it to retry." high
    done
    task=$(ls -1 "$Q"/pending | grep '\.sh$' | head -1); [ -z "$task" ] && exit 0
    name=${task%.sh}; mv "$Q/pending/$task" "$Q/running/$task"; mkdir -p "$OUT/$name"
    t=$(sed -n 's/^# timeout: *\([0-9]*[smhd]\).*/\1/p' "$Q/running/$task" | head -1); t=${t:-6h}
    iss=$(sed -n 's/^# issue: *#*\([0-9]*\).*/\1/p' "$Q/running/$task" | head -1)
    echo "$(now) start $name timeout=$t"
    start=$(date +%s)
    ( cd "$OUT/$name" && flock /root/gpu.lock timeout --kill-after=2m "$t" bash "$Q/running/$task" ) > "$OUT/$name/task.log" 2>&1
    rc=$?; mins=$(( ($(date +%s) - start) / 60 ))
    vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1); vram=${vram:-?}
    left=""; case "$vram" in ''|*[!0-9]*) ;; *) [ "$vram" -gt 500 ] && left=" GPU still holds ${vram} MiB after the task: stop its model." ;; esac
    if [ $rc -eq 0 ]; then dest=done; verdict=done; else dest=failed; verdict="FAILED rc=$rc$([ $rc -eq 124 ] && echo ' (timeout)')"; fi
    mv "$Q/running/$task" "$Q/$dest/$task"
    echo "$(now) $verdict $name ${mins}m vram=${vram}MiB"
    page "GPU task $verdict: $name" "${mins} min.$left Log: gex45:$OUT/$name/task.log${iss:+ (#$iss)}. Next: $(n=$(ls -1 "$Q"/pending | head -1); n=${n%.sh}; echo "${n:-queue empty}")" "$([ $rc -eq 0 ] && [ -z "$left" ] && echo low || echo high)" ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
