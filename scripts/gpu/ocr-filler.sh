#!/usr/bin/env bash
# ocr-filler.sh — keep the gex45 GPU on OCR when nobody has queued anything (#6871). Replaces the SigLIP2 requeue
# filler as the queue's automatic work source (Derek 2026-10-28: "we have plenty of GPU OCR to do").
#
# PRIOR ART: /root/jobs/siglip2-6871/code-full/siglip2-requeue.sh (the SigLIP2 chunk filler this replaces: queue only
# when nothing else is pending, chunk names that sort after hand-queued tasks, retry cap, disk floor, PAUSE file;
# copied), scripts/workers/gpu-queue.sh (runs one task at a time; queues nothing) and scripts/audit/gpu-queue-5660.mjs
# (counts OCR owed per language; queues nothing). None of them decides which OCR to put on the card.
#
# Installed at /root/bin/ocr-filler.sh with ocr-filler-routes.tsv beside it (copy both from the checkout). gex45 cron:
#   */10 * * * * /root/bin/ocr-filler.sh run >> /var/log/sourcelibrary/ocr-filler.log 2>&1
#
#   ocr-filler.sh run      (cron) queue ONE chunk of the first route in ocr-filler-routes.tsv with pages left, and only
#                          when pending/ AND running/ are empty (hand-queued work always goes first; max 1 ahead)
#   ocr-filler.sh status   pages and books left per route
#
# It adds nothing when: $ST/PAUSE exists; anything is pending or running; /root/gpu.lock is held (a job outside the
# queue that does take the lock, so a chunk queued now would cut in between its arms); the card already holds > 1 GB with nothing
# running (an out-of-queue job, which takes no /root/gpu.lock: the 10-27 Four Histories run died of exactly that);
# the root disk has < 10 G (OCR text is small: 24,602 Paddle pages ≈ 100 MB; page images are deleted as read). A route is skipped when $ST/<route>.DISABLED exists, which the filler writes (and pages)
# after 3 chunks in a row fail. A chunk that finds the card busy waits up to an hour, then exits 75 with
# OCR-FILLER-SKIP in its log: a recorded skip, not a failure. Every chunk appends a row to $ST/runs.jsonl.
# Chunks are named zy-ocr-<route>-cNNN: after every digit-prefixed (hand-queued) task, before the zz-siglip2 chunks.
# Nothing here writes to Mongo; each route's own task applies its reads (see the routes file's downstream column).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROUTES=${OCR_FILLER_ROUTES:-$HERE/ocr-filler-routes.tsv}
Q=${GPU_QUEUE_DIR:-/root/gpu-queue}; OUT=${GPU_QUEUE_OUT:-/root/jobs/gpu-queue}; ST=${OCR_FILLER_STATE:-$Q/ocr-filler}
CODE=${CODE_DIR:-/root/sourcelibrary}; ENV_FILE=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
TOPIC=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
mkdir -p "$ST"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
page() { curl -fsS -m 15 -H "Title: $1" -H "Priority: ${3:-high}" -H "Tags: gpu" -d "$2" "$TOPIC" >/dev/null 2>&1 || true; }

# left <kind> <lane_dir>  →  "<pages> <books>" still to read
left() {
  case "$1" in
    paddle-zh) python3 - "$2" <<'PY'
import glob, json, os, sys
J = sys.argv[1]; pages = books = 0
for f in glob.glob(f"{J}/plan/*.json"):
    p = json.load(open(f)); bid = p["bid"]
    n = sum(1 for r in p["pages"] if not os.path.exists(f"{J}/out/{bid}/{r['pn']}.txt") and not os.path.exists(f"{J}/out/{bid}/{r['pn']}.err"))
    pages += n; books += n > 0
print(pages, books)
PY
    ;;
    *) echo "0 0" ;;
  esac
}

routes() { grep -v '^#' "$ROUTES" | awk -F'\t' 'NF >= 8 && $1 == "on"'; }

case "${1:-run}" in
  status)
    printf '%-24s %-10s %8s %6s  %s\n' route kind pages books state
    grep -v '^#' "$ROUTES" | awk -F'\t' 'NF >= 8' | while IFS=$'\t' read -r on route kind issue lane hold dl down; do
      read -r p b < <(left "$kind" "$lane")
      s=$on; [ -e "$ST/$route.DISABLED" ] && s=DISABLED
      printf '%-24s %-10s %8s %6s  %s (#%s)\n' "$route" "$kind" "$p" "$b" "$s" "$issue"
    done ;;
  run)
    exec 9>/tmp/ocr-filler.lock; flock -n 9 || exit 0
    [ -e "$ST/PAUSE" ] && exit 0
    [ "$(ls -1 "$Q"/pending | grep -c '\.sh$')" -gt 0 ] && exit 0
    [ "$(ls -1 "$Q"/running | grep -c '\.sh$')" -gt 0 ] && exit 0
    # a job outside the queue that takes the lock (e.g. an eval's drafting arms) owns the card until it lets go
    flock -n /root/gpu.lock true || { echo "$(now) /root/gpu.lock is held outside the queue: queueing nothing"; exit 0; }
    vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1)
    case "$vram" in ''|*[!0-9]*) echo "$(now) nvidia-smi unreadable: queueing nothing"; exit 0 ;; esac
    if [ "$vram" -gt 1000 ]; then
      echo "$(now) card holds ${vram} MiB with nothing running in the queue (an out-of-queue job): queueing nothing"; exit 0
    fi
    free_g=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
    [ "${free_g:-0}" -lt 10 ] && { echo "$(now) root disk ${free_g}G free < 10G: queueing nothing"; exit 0; }
    while IFS=$'\t' read -r on route kind issue lane hold dl down; do
      [ -e "$ST/$route.DISABLED" ] && continue
      [ -d "$lane/plan" ] || { echo "$(now) $route: no plan dir at $lane/plan, skipped"; continue; }
      read -r p b < <(left "$kind" "$lane")
      if [ "${p:-0}" -eq 0 ]; then
        [ -e "$ST/$route.EMPTY" ] || { touch "$ST/$route.EMPTY"; echo "$(now) $route: no pages left"
          page "OCR filler: route $route read out (#$issue)" "Every planned page of $route has a reading. Next route in ocr-filler-routes.tsv takes over." low; }
        continue
      fi
      # 3 failed chunks in a row (skips excluded) stop the route
      fails=0
      for t in $(ls -1t "$Q"/done "$Q"/failed 2>/dev/null | grep "^zy-ocr-$route-c[0-9]*\.sh$"); do
        [ -e "$Q/done/$t" ] && break
        grep -q OCR-FILLER-SKIP "$OUT/${t%.sh}/task.log" 2>/dev/null && continue
        fails=$((fails + 1))
      done
      if [ "$fails" -ge 3 ]; then
        echo "$(now) $route: $fails chunks failed in a row: route disabled (rm $ST/$route.DISABLED to retry)"
        touch "$ST/$route.DISABLED"
        page "OCR filler: route $route disabled (#6871)" "$fails chunks in a row failed; logs gex45:$OUT/zy-ocr-$route-c*/task.log"
        continue
      fi
      n=$(( $(ls -1 "$Q"/pending "$Q"/running "$Q"/done "$Q"/failed "$Q"/held 2>/dev/null | grep -c "^zy-ocr-$route-c[0-9]*\.sh$") + 1 ))
      name=$(printf 'zy-ocr-%s-c%03d' "$route" "$n")
      tmp=$(mktemp)
      case "$kind" in
        paddle-zh) cat > "$tmp" <<EOF
#!/usr/bin/env bash
# timeout: $((dl + 3))h
# issue: $issue
# $name: queued by ocr-filler.sh (#6871) at $(now). Route $route ($kind), $p pages left in $b books.
# Reads up to ${dl} h, then applies. Downstream: $down
set -uo pipefail
ST=$ST; ROUTE=$route; LANE=$lane
export LANE_DIR=$lane PADDLE_ZH_ISSUE=$issue PADDLE_ZH_HOLD=$hold DEADLINE_H=$dl CODE_DIR=$CODE ENV_FILE=$ENV_FILE GPU_TASK_NAME=$name
row() { printf '{"at":"%s","task":"$name","route":"$route","event":"%s","rc":%s,"pages_left":%s}\n' "\$(date -u +%FT%TZ)" "\$1" "\$2" "\$3" >> "\$ST/runs.jsonl"; }
# the genai server asks for 0.5 of the card (11.7 GB): wait up to an hour for it, else a recorded skip
for i in \$(seq 1 60); do
  f=\$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  [ "\${f:-0}" -ge 12500 ] && break
  [ "\$i" -eq 60 ] && { echo "OCR-FILLER-SKIP card busy (\${f} MiB free) for an hour"; row skip 75 $p; exit 75; }
  sleep 60
done
echo "\$(date -u +%FT%TZ) start: $p pages left in $b books, GPU free \${f} MiB"
bash "\$CODE_DIR/scripts/gpu/paddle-zh-queue-task.sh"; rc=\$?
after=\$(python3 - "\$LANE" <<'PY'
import glob, json, os, sys
J = sys.argv[1]
print(sum(1 for f in glob.glob(f"{J}/plan/*.json") for p in [json.load(open(f))] for r in p["pages"]
          if not os.path.exists(f"{J}/out/{p['bid']}/{r['pn']}.txt") and not os.path.exists(f"{J}/out/{p['bid']}/{r['pn']}.err")))
PY
)
row done \$rc \${after:-null}
echo "\$(date -u +%FT%TZ) end rc=\$rc: \$(( $p - \${after:-$p} )) pages read this chunk, \${after} left"
exit \$rc
EOF
        ;;
        *) echo "$(now) $route: unknown kind $kind, skipped"; rm -f "$tmp"; continue ;;
      esac
      /root/bin/gpu-queue.sh add "$tmp" "$name"; rm -f "$tmp"
      echo "$(now) queued $name: route $route, $p pages left in $b books (VRAM ${vram} MiB, disk ${free_g}G)"
      exit 0
    done < <(routes)
    echo "$(now) nothing to queue: no enabled route has pages left" ;;
  *) sed -n '2,25p' "$0"; exit 2 ;;
esac
