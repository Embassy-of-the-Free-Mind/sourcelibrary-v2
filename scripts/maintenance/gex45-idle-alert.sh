#!/usr/bin/env bash
# gex45-idle-alert.sh — tell a human when the standing GPU box (Hetzner GEX45-1) has nothing to do (#5660).
#
# PRIOR ART: scripts/gpu/idle-poweroff.sh (a rented Scaleway GPU powers ITSELF off when idle) and
# scripts/maintenance/gpu-lease-watchdog.mjs (stops expired/idle leases through the provider API). Neither fits:
# the GEX45 is a dedicated Robot server at a flat $249/mo, so powering it off saves nothing — it bills the same off
# as on. The failure to catch is a box that sits idle for weeks while we keep paying, and the fix is a person
# noticing and either queueing work or cancelling it. So this ALERTS; it never powers anything off.
#
# Runs on the main Hetzner box from cron (infrastructure/hetzner-crontab, every 30 min). Keeps no secret on the GPU
# box: it ssh-probes the box, and posts from here with the gh CLI already logged in on this box.
#
#   gex45-idle-alert.sh            probe, update state, alert on a state change (or a 24 h nag while idle)
#   gex45-idle-alert.sh --dry-run  probe and print what it would send; state untouched
#
# "Output" = any regular file modified under OUTPUT_DIRS on the box (default: /root/pz/out /root/jobs). Every job
# on the box writes there; that is the convention, and the reason this watcher can be dumb (#5660).
# States: busy | idle (no new output for IDLE_HOURS, default 6) | unreachable (2 failed probes in a row).
# On entering idle or unreachable, and every NAG_HOURS (24) while it lasts: ntfy NTFY_TOPIC + a comment on #ISSUE.
# On returning to busy: one ntfy line. Nothing else repeats — a detector that repeats hourly trains you to ignore it.
#
# Steward (#6871): an alert gets a person to queue work; on 2026-10-19 the queue sat empty for 30 h anyway. So when the
# GPU queue (/root/gpu-queue on the box, scripts/workers/gpu-queue.sh) has nothing pending or running and its last
# task finished STEWARD_EMPTY_MIN (60) ago, this also starts ONE headless Claude job, `gpu-steward-<date>`, on a box
# that can ssh to the GEX45 (cloudlayer or main, via box.sh / claude-job.sh), with the brief in
# scripts/maintenance/gpu-steward-brief.md: queue the next gated #6871 item, or say on #6871 why none is eligible.
# At most one per STEWARD_EVERY_H (24). $0, no Mongo writes: those rules are in the brief. STEWARD=0 turns it off.
set -euo pipefail

HOST=${GEX45_HOST:-root@65.108.136.89}
OUTPUT_DIRS=${OUTPUT_DIRS:-/root/pz/out /root/jobs}
IDLE_HOURS=${IDLE_HOURS:-6}
NAG_HOURS=${NAG_HOURS:-24}
NTFY_TOPIC=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
ISSUE=${ISSUE:-5660}
REPO=${REPO:-Embassy-of-the-Free-Mind/sourcelibrary-v2}
STATE=${STATE_FILE:-/root/.gex45-idle-alert.json}
STEWARD=${STEWARD:-1}
STEWARD_EMPTY_MIN=${STEWARD_EMPTY_MIN:-60}
STEWARD_EVERY_H=${STEWARD_EVERY_H:-24}
STEWARD_BRIEF=${STEWARD_BRIEF:-$(dirname "$0")/gpu-steward-brief.md}
QDIR=${GPU_QUEUE_DIR:-/root/gpu-queue}
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

now=$(date +%s)
log() { echo "$(date -u +%FT%TZ) $*"; }

# probe: newest output mtime (epoch, 0 = none), GPU util %, GPU compute processes, uptime
probe=$(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 "$HOST" "
  newest=0
  for d in $OUTPUT_DIRS; do [ -d \"\$d\" ] || continue
    t=\$(find \"\$d\" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
    [ -n \"\$t\" ] && [ \"\$t\" -gt \"\$newest\" ] && newest=\$t
  done
  util=\$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  procs=\$(nvidia-smi --query-compute-apps=process_name --format=csv,noheader 2>/dev/null | xargs -r -n1 basename | sort | uniq -c | tr -s ' ' | tr '\n' ';')
  qp=NA; [ -d $QDIR/pending ] && qp=\$(ls -1 $QDIR/pending | grep -c '\\.sh\$'); qr=\$(ls -1 $QDIR/running 2>/dev/null | grep -c '\\.sh\$')
  qf=\$(find $QDIR/done $QDIR/failed -maxdepth 1 -name '*.sh' -printf '%T@\\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
  echo \"\$newest \${util:-NA} \$(cut -d. -f1 /proc/uptime) \$qp \$qr \${qf:-0} \${procs:-none}\"
" 2>/dev/null) || probe=""

prev=$(python3 -c "import json,sys; d=json.load(open('$STATE')); print(d.get('state','none'), d.get('since',0), d.get('alerted_at',0), d.get('fails',0))" 2>/dev/null || echo "none 0 0 0")
read -r pstate psince palerted pfails <<<"$prev"
psteward=$(python3 -c "import json; print(json.load(open('$STATE')).get('steward_at',0))" 2>/dev/null || echo 0)

if [ -z "$probe" ]; then
  fails=$((pfails + 1)); state=$pstate; detail="ssh probe failed ($fails in a row)"
  [ "$fails" -ge 2 ] && state=unreachable
  newest=0; util=NA; procs=none; qp=NA
else
  fails=0
  read -r newest util up qp qr qf procs <<<"$probe"   # procs last: it holds spaces
  age_h=$(( newest > 0 ? (now - newest) / 3600 : 999999 ))
  if [ "$newest" -gt 0 ] && [ $((now - newest)) -lt $((IDLE_HOURS * 3600)) ]; then state=busy; else state=idle; fi
  last=$([ "$newest" -gt 0 ] && date -u -d @"$newest" +%FT%TZ || echo never)
  detail="newest output $last ($( [ "$newest" -gt 0 ] && echo "${age_h} h ago" || echo "no file under $OUTPUT_DIRS")), GPU ${util}%, GPU processes: ${procs}"
fi

since=$psince; [ "$state" != "$pstate" ] && since=$now
alert=0
if [ "$state" = idle ] || [ "$state" = unreachable ]; then
  if [ "$state" != "$pstate" ] || [ $((now - palerted)) -ge $((NAG_HOURS * 3600)) ]; then alert=1; fi
fi
resumed=0; { [ "$state" = busy ] && { [ "$pstate" = idle ] || [ "$pstate" = unreachable ]; }; } && resumed=1

log "state=$state (was $pstate) · $detail · alert=$alert resumed=$resumed"

msg_idle="GEX45-1 (Hetzner GPU box, \$249/mo flat) is ${state^^}: ${detail}. It bills the same idle as busy: queue work on it or decide to cancel (#${ISSUE})."
if [ "$alert" = 1 ]; then
  if [ "$DRY" = 1 ]; then log "[dry-run] would ntfy + comment on #$ISSUE: $msg_idle"
  else
    NTFY_SRC=gex45-idle-alert.sh "$(dirname "$0")/../workers/ntfy-send.sh" "$NTFY_TOPIC" "GEX45 ${state}" default warning "$msg_idle" || log "ntfy FAILED"
    gh issue comment "$ISSUE" --repo "$REPO" --body "**GEX45 idle alert** (\`scripts/maintenance/gex45-idle-alert.sh\`, $(date -u +%FT%TZ)): the box is **${state}**. ${detail}. A dedicated box bills the same when idle, so this does not power it off. Queue work under \`/root/jobs/<name>/\` on the box, or decide to cancel. Next reminder in ${NAG_HOURS} h if nothing changes." >/dev/null || log "gh comment FAILED"
    palerted=$now
  fi
fi
if [ "$resumed" = 1 ] && [ "$DRY" = 0 ]; then
  NTFY_SRC=gex45-idle-alert.sh "$(dirname "$0")/../workers/ntfy-send.sh" "$NTFY_TOPIC" "GEX45 busy again" default "" "GEX45-1 is writing output again: ${detail}" || log "ntfy FAILED"
fi
[ "$state" = busy ] && palerted=0

# steward: an empty queue for STEWARD_EMPTY_MIN, no steward in STEWARD_EVERY_H → start one (see header)
steward_at=$psteward
if [ "$STEWARD" = 1 ] && [ "${qp:-NA}" = 0 ] && [ "${qr:-1}" = 0 ] && [ $((now - ${qf:-0})) -ge $((STEWARD_EMPTY_MIN * 60)) ] \
   && [ $((now - psteward)) -ge $((STEWARD_EVERY_H * 3600)) ]; then
  name="gpu-steward-$(date -u +%Y%m%d)"
  # the steward drives the GEX45 over ssh, so it runs where that key is authorized: cloudlayer, else main (never l7a)
  box=$(/root/bin/box.sh pick --exclude gex45 2>/dev/null || true)
  case "$box" in main|cloudlayer) ;; *) box=cloudlayer ;; esac
  if [ "$DRY" = 1 ]; then log "[dry-run] queue empty (last task finished $(date -u -d @"${qf:-0}" +%FT%TZ)): would start $name on $box"
  elif [ ! -s "$STEWARD_BRIEF" ]; then log "steward: no brief at $STEWARD_BRIEF"
  else
    rc=0
    if [ "$box" = "$(/root/bin/box.sh self 2>/dev/null)" ]; then out=$(/root/bin/claude-job.sh start "$name" "$STEWARD_BRIEF" 2>&1) || rc=$?
    else out=$(/root/bin/box.sh "$box" start "$name" < "$STEWARD_BRIEF" 2>&1) || rc=$?; fi
    log "steward: start $name on $box rc=$rc ${out//$'\n'/ }"
    # a refused start (name taken, mesh cap) still counts: retrying every 30 min is how a cap becomes a storm
    steward_at=$now
    [ $rc -eq 0 ] || curl -fsS --max-time 20 -H "Title: GEX45 steward did not start" -H "Tags: warning" \
      -d "GPU queue empty; starting $name on $box failed (rc=$rc): ${out:0:300}" "$NTFY_TOPIC" >/dev/null || true
  fi
fi

if [ "$DRY" = 0 ]; then
  python3 -c "import json; json.dump({'state':'$state','since':$since,'alerted_at':$palerted,'fails':$fails,'newest_output':$newest,'checked_at':$now,'steward_at':$steward_at}, open('$STATE','w'))"
fi
