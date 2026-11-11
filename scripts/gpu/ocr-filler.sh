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
# queue that does take the lock, so a chunk queued now would cut in between its arms); a process outside the queue holds
# more than GUEST_IDLE_MIB (1500) of the card with nothing running (an out-of-queue job, which takes no /root/gpu.lock: the
# 10-27 Four Histories run died of exactly that). A guest's idle CUDA context does not count: the /root/greenroom image
# servers unload their model after 10 idle minutes and keep about 0.3-1 GB, so OCR resumes about 15 minutes after the last
# painting, by itself (Derek 2026-11-09: "when those jobs stop, the gpu automatically starts processing again");
# the root disk has < 10 G (OCR text is small: 24,602 Paddle pages ≈ 100 MB; page images are deleted as read). A route is skipped when $ST/<route>.DISABLED exists, which the filler writes (and pages)
# after 3 chunks in a row fail. A chunk that finds the card busy waits up to an hour, then exits 75 with
# OCR-FILLER-SKIP in its log: a recorded skip, not a failure. Every chunk appends a row to $ST/runs.jsonl.
# Chunks are named zy-ocr-<route>-cNNN: after every digit-prefixed (hand-queued) task, before the zz-siglip2 chunks.
# Nothing here writes to Mongo; each route's own task applies its reads (see the routes file's downstream column).
#
# BACKFILL (Derek 2026-10-29: "I don't want it unused, there should be a continual queue"). When no enabled route has
# pages left, the filler hands the card to the SigLIP2 page-embedding run (#6871 row 8, approved 10-21/10-26) by running
# its own chunk queuer, $BACKFILL. OCR still goes first: zz-siglip2 chunks are ignored in the pending/running test
# above, so an OCR chunk is queued as soon as a route has pages, and zy- sorts before zz- (it runs when the current
# embedding chunk ends, ≤ 12 h). Turn the backfill off with `touch $ST/BACKFILL-OFF`; the SigLIP run's own
# switch, /root/jobs/siglip2-6871/full/PAUSE, still stops it (its queuer writes PAUSE itself after 5 failed tries).
# IDLE CHECK: if the card has had nothing queued or running for 2 h, page ntfy (at most once every 12 h), so an empty
# queue is never silent again (10-28 15:09Z → 10-29: 8 h idle, no page).
# RESCUE (Derek 2026-11-09: "if it is idle, an opus session is triggered to get it going again"): at the same moment
# (2 h with no work: nothing queued or running and no guest using the card), or when a task has sat in pending/ for 2 h
# with nothing running, the filler starts an Opus job on this box, `claude-job.sh start gpu-rescue-<ts>`, with
# gpu-rescue-brief.txt (beside this file) plus the box state. At most one every RESCUE_EVERY_H (12) hours, and never
# while the last one is still running. Off: `touch $ST/RESCUE-OFF`. The page says which job is on it.
# Not when every route is merely read out or waiting on its correction stage and none is DISABLED: that idleness is by
# design, the only remedy is a new route (a #6871 decision), so the filler pages and starts no session (2026-11-11).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROUTES=${OCR_FILLER_ROUTES:-$HERE/ocr-filler-routes.tsv}
Q=${GPU_QUEUE_DIR:-/root/gpu-queue}; OUT=${GPU_QUEUE_OUT:-/root/jobs/gpu-queue}; ST=${OCR_FILLER_STATE:-$Q/ocr-filler}
CODE=${CODE_DIR:-/root/sourcelibrary}; ENV_FILE=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
TOPIC=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
mkdir -p "$ST"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
page() { curl -fsS -m 15 -H "Title: $1" -H "Priority: ${3:-high}" -H "Tags: gpu" -d "$2" "$TOPIC" >/dev/null 2>&1 || true; }
GUEST_IDLE_MIB=${GUEST_IDLE_MIB:-1500}
JOBS=${CLAUDE_JOBS_DIR:-/root/claude-jobs}; CLAUDE_JOB=${CLAUDE_JOB:-/root/bin/claude-job.sh}
RESCUE_BRIEF=${RESCUE_BRIEF:-$HERE/gpu-rescue-brief.txt}; [ -f "$RESCUE_BRIEF" ] || RESCUE_BRIEF=$CODE/scripts/gpu/gpu-rescue-brief.txt
RESCUE_EVERY_H=${RESCUE_EVERY_H:-12}

# guests: processes on the card holding more than GUEST_IDLE_MIB, as "pid MiB cmd" lines (an idle CUDA context is not use)
guests() {
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits 2>/dev/null | tr -d ' ' |
    while IFS=, read -r pid mib; do
      [ "${mib:-0}" -gt "$GUEST_IDLE_MIB" ] 2>/dev/null && echo "$pid ${mib}MiB $(ps -o args= -p "$pid" 2>/dev/null | cut -c1-80)"
    done
}

# rescue <reason>: start one Opus job on this box to get the card working again (see RESCUE above). Prints what it did.
rescue() {
  [ -e "$ST/RESCUE-OFF" ] && { echo "rescue off ($ST/RESCUE-OFF)"; return; }
  [ -x "$CLAUDE_JOB" ] && [ -f "$RESCUE_BRIEF" ] || { echo "no rescue: $CLAUDE_JOB or $RESCUE_BRIEF missing"; return; }
  local last age name brief
  last=$(cat "$ST/RESCUE-LAST" 2>/dev/null)
  if [ -n "$last" ]; then
    age=$(( $(date +%s) - $(stat -c %Y "$ST/RESCUE-LAST") ))
    [ -e "$JOBS/$last.done" ] || [ -e "$JOBS/$last.failed" ] || [ "$age" -ge 86400 ] || { echo "rescue $last still running"; return; }
    [ "$age" -lt $(( RESCUE_EVERY_H * 3600 )) ] && { echo "rescue $last ran < ${RESCUE_EVERY_H} h ago"; return; }
  fi
  name=gpu-rescue-$(date -u +%m%d-%H%M); brief=$(mktemp "/tmp/$name.XXXX.txt")
  { sed "s|{{REASON}}|$1|" "$RESCUE_BRIEF"
    echo; echo "## Box state at $(now)"
    echo '$ ocr-filler.sh status'; "$0" status 2>&1
    echo; echo '$ ls /root/gpu-queue/{pending,running}; ls -t /root/gpu-queue/failed | head -5'
    ls "$Q"/pending "$Q"/running 2>&1; ls -t "$Q"/failed 2>/dev/null | head -5
    echo; echo '$ ls /root/gpu-queue/ocr-filler'; ls "$ST"
    echo; echo '$ tail -15 /var/log/sourcelibrary/ocr-filler.log'; tail -15 /var/log/sourcelibrary/ocr-filler.log 2>&1
    echo; echo '$ tail -10 /var/log/sourcelibrary/gpu-queue.log'; tail -10 /var/log/sourcelibrary/gpu-queue.log 2>&1
    echo; echo '$ nvidia-smi (used, total, util; compute apps)'; nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader
    nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader
    echo; echo '$ df -h /'; df -h / | tail -1
  } > "$brief" 2>&1
  echo "$name" > "$ST/RESCUE-LAST"
  # start returns once the job's tmux session is up (its login preflight takes ~10 s); do not hold the filler's lock on it
  nohup timeout 600 "$CLAUDE_JOB" start "$name" "$brief" >> "$ST/rescue.log" 2>&1 < /dev/null &
  echo "started Opus job $name (gex45:$JOBS/$name.*; start log $ST/rescue.log)"
}

# idle_check <why nothing was queued> [norescue]: the card has nothing queued or running. Page after 2 h and start a
# rescue; with `norescue`, page only (the card is idle by design: nothing an Opus session on the box could fix).
idle_check() {
  [ -e "$ST/IDLE-SINCE" ] || date +%s > "$ST/IDLE-SINCE"
  local idle_m last r
  idle_m=$(( ( $(date +%s) - $(cat "$ST/IDLE-SINCE") ) / 60 ))
  last=$(cat "$ST/IDLE-PAGED" 2>/dev/null || echo 0)
  if [ "$idle_m" -ge 120 ] && [ $(( $(date +%s) - last )) -ge 43200 ]; then
    if [ "${2:-}" = norescue ]; then r="no rescue started: nothing on the box is broken"
    else r=$(rescue "the card has had nothing queued or running for $idle_m min: $1"); fi
    echo "$(now) idle $idle_m min: $r"
    page "gex45 GPU idle ${idle_m} min (#6871)" "$1. $r. ocr-filler.sh status shows the routes."
    date +%s > "$ST/IDLE-PAGED"
  fi
}

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
    gpu-print) python3 - "$2" <<'PY'
import json, os, sys
J = sys.argv[1]; pages = 0; books = set(); planned = set()
if os.path.exists(f"{J}/manifest.tsv"):
    for l in open(f"{J}/manifest.tsv"):
        r = l.rstrip("\n").split("\t")
        if len(r) != 4: continue
        planned.add(r[0])
        if not os.path.exists(f"{J}/out/{r[0]}/{r[1]}.json") and not os.path.exists(f"{J}/out/{r[0]}/{r[1]}.err"): pages += 1; books.add(r[0])
fr = json.load(open(f"{J}/frame-books.json"))["books"] if os.path.exists(f"{J}/frame-books.json") else []
for b in fr:
    if b["bid"] not in planned: pages += b["owed"]; books.add(b["bid"])
print(pages, len(books))
PY
    ;;
    # #7567 arm c: planned pages (cli-ocr-lane.mjs armc-plan) with no draft file and not ledgered
    euro-draft) node --no-warnings "$CODE/scripts/batch/cli-ocr-lane.mjs" armc-left --lane-dir="$2" 2>/dev/null | tail -1 | grep -E '^[0-9]+ [0-9]+$' || echo "0 0" ;;
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
    [ "$(ls -1 "$Q"/pending "$Q"/running 2>/dev/null | grep -c '\.sh$')" -gt 0 ] && rm -f "$ST/IDLE-SINCE"
    # a task that sits in pending/ for 2 h with nothing running: the queue itself is stuck (a held lock, a dead cron)
    if [ "$(ls -1 "$Q"/running 2>/dev/null | grep -c '\.sh$')" -eq 0 ]; then
      stuck=$(find "$Q"/pending -maxdepth 1 -name '*.sh' -mmin +120 2>/dev/null | head -1)
      if [ -n "$stuck" ] && { [ ! -e "$ST/STUCK-PAGED" ] || [ -n "$(find "$ST/STUCK-PAGED" -mmin +720 2>/dev/null)" ]; }; then
        r=$(rescue "$(basename "$stuck") has waited in pending/ over 2 h with nothing running: the queue is not starting tasks")
        echo "$(now) queue stuck on $(basename "$stuck"): $r"
        page "gex45 GPU queue stuck (#6871)" "$(basename "$stuck") pending > 2 h, nothing running. $r"
        touch "$ST/STUCK-PAGED"
      fi
    fi
    # backfill chunks (zz-siglip2-*) do not block OCR: an OCR chunk sorts ahead of them
    [ "$(ls -1 "$Q"/pending | grep '\.sh$' | grep -vc '^zz-siglip2-')" -gt 0 ] && exit 0
    [ "$(ls -1 "$Q"/running | grep '\.sh$' | grep -vc '^zz-siglip2-')" -gt 0 ] && exit 0
    backfill_running=$(ls -1 "$Q"/running | grep -c '^zz-siglip2-')
    # a job outside the queue that takes the lock (e.g. an eval's drafting arms) owns the card until it lets go
    # (a running backfill chunk holds the lock through gpu-queue.sh; it yields to whatever is queued, so it does not count)
    if [ "$backfill_running" -eq 0 ]; then
      if ! flock -n /root/gpu.lock true; then
        echo "$(now) /root/gpu.lock is held outside the queue: queueing nothing"
        # a holder that uses no card is either between an eval's arms or orphaned workers keeping the fd (10-29): after 2 h, rescue
        [ -z "$(guests)" ] && idle_check "/root/gpu.lock is held by pid(s) $(lsof -t /root/gpu.lock 2>/dev/null | tr '\n' ' ')outside the queue, and no process uses the card"
        exit 0
      fi
    fi
    vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1)
    case "$vram" in ''|*[!0-9]*) echo "$(now) nvidia-smi unreadable: queueing nothing"; exit 0 ;; esac
    if [ "$backfill_running" -eq 0 ]; then
      busy=$(guests)
      if [ -n "$busy" ]; then
        # a guest using the card is work, not idleness: the idle clock restarts when it lets go
        rm -f "$ST/IDLE-SINCE"
        echo "$(now) card in use outside the queue (${vram} MiB): $(echo "$busy" | tr '\n' ';') queueing nothing"; exit 0
      fi
    fi
    free_g=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
    [ "${free_g:-0}" -lt 10 ] && { echo "$(now) root disk ${free_g}G free < 10G: queueing nothing"; idle_check "root disk ${free_g}G free < 10G"; exit 0; }
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
      # (a disable records the newest failure it counted in <route>.FAILS-COUNTED, so removing .DISABLED gives the route
      # three fresh tries; without it the same three old failures disabled the route again on the next tick, 2026-11-09)
      fails=0; counted=$(cat "$ST/$route.FAILS-COUNTED" 2>/dev/null)
      for t in $(ls -1 "$Q"/done "$Q"/failed 2>/dev/null | grep "^zy-ocr-$route-c[0-9]*\.sh$" | sort -r); do   # newest chunk first
        [ -e "$Q/done/$t" ] && break
        [ "$t" = "$counted" ] && break
        grep -q OCR-FILLER-SKIP "$OUT/${t%.sh}/task.log" 2>/dev/null && continue
        fails=$((fails + 1))
      done
      if [ "$fails" -ge 3 ]; then
        echo "$(now) $route: $fails chunks failed in a row: route disabled (rm $ST/$route.DISABLED to retry)"
        touch "$ST/$route.DISABLED"
        ls -1 "$Q"/failed | grep "^zy-ocr-$route-c[0-9]*\.sh$" | sort -r | head -1 > "$ST/$route.FAILS-COUNTED"
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
        gpu-print) cat > "$tmp" <<EOF
#!/usr/bin/env bash
# timeout: $((dl + 2))h
# issue: $issue
# $name: queued by ocr-filler.sh (#6871) at $(now). Route $route ($kind), $p pages left in $b books.
# Plans the next frame books when fewer than 3,000 planned pages wait, reads up to ${dl} h with LightOnOCR, then applies.
# Downstream: $down
set -uo pipefail
ST=$ST; LANE=$lane; CODE=$CODE; ENV_FILE=$ENV_FILE
row() { printf '{"at":"%s","task":"$name","route":"$route","event":"%s","rc":%s}\n' "\$(date -u +%FT%TZ)" "\$1" "\$2" >> "\$ST/runs.jsonl"; }
# vLLM at util 0.85 (gpu-print-gpu.sh, FP8) asks for ~20.4 GB: wait up to an hour for it, else a recorded skip
for i in \$(seq 1 60); do
  f=\$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  [ "\${f:-0}" -ge 21000 ] && break
  [ "\$i" -eq 60 ] && { echo "OCR-FILLER-SKIP card busy (\${f} MiB free) for an hour"; row skip 75; exit 75; }
  sleep 60
done
waiting=\$(awk -F'\t' -v J="\$LANE" 'NF==4 { f=J"/out/"\$1"/"\$2; if ((getline x < (f".json")) <= 0 && (getline y < (f".err")) <= 0) n++; close(f".json"); close(f".err") } END { print n+0 }' "\$LANE/manifest.tsv" 2>/dev/null)
[ "\${waiting:-0}" -lt 3000 ] && node --env-file="\$ENV_FILE" "\$CODE/scripts/workers/gpu-print-lane.mjs" plan --apply --dir "\$LANE" --limit 40
LANE_DIR=\$LANE CODE_DIR=\$CODE HOURS=$dl bash "\$CODE/scripts/gpu/gpu-print-gpu.sh"; rc=\$?
node --env-file="\$ENV_FILE" "\$CODE/scripts/workers/gpu-print-lane.mjs" apply --apply --dir "\$LANE"; arc=\$?
row done \$(( rc > arc ? rc : arc ))
exit \$(( rc > arc ? rc : arc ))
EOF
        ;;
        euro-draft) cat > "$tmp" <<EOF
#!/usr/bin/env bash
# timeout: $((dl + 1))h
# issue: $issue
# $name: queued by ocr-filler.sh (#6871) at $(now). Route $route ($kind), $p pages left in $b books.
# Drafts up to MAX_PAGES planned pages (la PERO, it LightOnOCR); the agy correction is the lane's cron run. Downstream: $down
set -uo pipefail
ST=$ST
row() { printf '{"at":"%s","task":"$name","route":"$route","event":"%s","rc":%s,"pages_left":%s}\n' "\$(date -u +%FT%TZ)" "\$1" "\$2" "\$3" >> "\$ST/runs.jsonl"; }
# LightOnOCR asks for 0.6 of the card (14.7 GB): wait up to an hour for it, else a recorded skip
for i in \$(seq 1 60); do
  f=\$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  [ "\${f:-0}" -ge 15000 ] && break
  [ "\$i" -eq 60 ] && { echo "OCR-FILLER-SKIP card busy (\${f} MiB free) for an hour"; row skip 75 $p; exit 75; }
  sleep 60
done
LANE_DIR=$lane CODE_DIR=$CODE ENV_FILE=$ENV_FILE MAX_PAGES=\${MAX_PAGES:-1500} bash "$CODE/scripts/gpu/euro-draft-task.sh"; rc=\$?
read -r after _ < <(node --no-warnings "$CODE/scripts/batch/cli-ocr-lane.mjs" armc-left --lane-dir="$lane" 2>/dev/null | tail -1)
row done \$rc \${after:-null}
exit \$rc
EOF
        ;;
        *) echo "$(now) $route: unknown kind $kind, skipped"; rm -f "$tmp"; continue ;;
      esac
      /root/bin/gpu-queue.sh add "$tmp" "$name"; rm -f "$tmp"
      # queueing is work: restart the idle clock here. A short chunk (queued :20, run :25-:27) is gone before the next
      # filler run, so the pending/running checks never see it; without this the clock ran on through 4 chunks and
      # started a needless rescue at "169 min idle" three minutes after the card drafted 45 pages (2026-11-11, #6871).
      rm -f "$ST/IDLE-SINCE"
      echo "$(now) queued $name: route $route, $p pages left in $b books (VRAM ${vram} MiB, disk ${free_g}G)"
      exit 0
    done < <(routes)
    echo "$(now) nothing to queue: no enabled route has pages left"
    BACKFILL=${BACKFILL:-/root/jobs/siglip2-6871/code-full/siglip2-requeue.sh}
    if [ ! -e "$ST/BACKFILL-OFF" ] && [ -x "$BACKFILL" ]; then
      "$BACKFILL" 2>&1 | sed "s/^/$(now) backfill: /"
    fi
    # idle check: nothing queued or running → note when it started; page after 2 h, then at most every 12 h
    if [ "$(ls -1 "$Q"/pending "$Q"/running 2>/dev/null | grep -c '\.sh$')" -eq 0 ]; then
      dis=$(cd "$ST" && ls *.DISABLED 2>/dev/null | sed 's/\.DISABLED$//' | tr '\n' ' ')
      if [ -n "$dis" ]; then
        idle_check "no enabled OCR route has pages left (disabled after failures: $dis) and the backfill queued nothing"
      else
        # every route is read out or waiting on its correction stage (a euro lane's plan is capped by its agy horizon, and
        # the agy pool keeps a weekly reserve): idle by design. Two rescues in a row found nothing to fix (2026-11-10 12:20Z,
        # 11-11 12:40Z: fr19's corrector at "weekly 17.4% is under the weekly reserve 18.0%"); refilling the card is a route
        # decision (#6871), so page once and start no Opus session. A failing route still rescues (the branch above).
        idle_check "no enabled OCR route has pages left: each is read out or waiting on its correction stage (see cli-ocr-armc-*.log); a new route is a #6871 decision" norescue
      fi
    else
      rm -f "$ST/IDLE-SINCE"
    fi ;;
  *) sed -n '2,25p' "$0"; exit 2 ;;
esac
