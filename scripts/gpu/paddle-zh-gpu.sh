#!/bin/bash
# PRIOR ART: scripts/eval/zh-cohort-5547-gpu.sh (#5547 — create/push/run/status/pull/stop/delete of ONE
# leased L4 for one pilot). This is the same lifecycle for MANY boxes of the #5600 lane: the box is named
# by BOX (its state lives in $LANE_DIR/boxes/$BOX), the type and zone are arguments, the root volume is
# sized at create (the GPU OS image's 17 GB root does not hold the Paddle wheels, #5547), the lease
# carries a progress tag (the Hetzner watchdog stops a box whose lane writes nothing for 30 min), and the
# box fetches its own page images from R2 (images.sourcelibrary.org) — nothing is pushed but a manifest.
#
#   BOX=zh1 TYPE=L4-1-24G ZONE=pl-waw-2 paddle-zh-gpu.sh create   server + lease (owner=5600) + ssh
#   BOX=zh1 paddle-zh-gpu.sh push <manifest.tsv>                   manifest + box scripts + /etc/gpu-idle.env
#   BOX=zh1 paddle-zh-gpu.sh setup                                 venv + the #5547 Paddle stack (+ genai server deps if SERVER=1)
#   BOX=zh1 paddle-zh-gpu.sh run                                   on the box: idle-poweroff.sh run -- paddle-zh-box.sh all
#   BOX=zh1 paddle-zh-gpu.sh status | pull | stop | delete | ssh <cmd> | lease <hours>
# Env: LANE_DIR (default /root/paddle-zh-5600), LEASE_H (default 6), WORKERS, BACKEND, CLIENTS, MAX_SIDE,
#      LAYOUT, INFER_HOURS (passed to the box). Stopping is ALWAYS the provider API (a guest poweroff bills).
set -eu
LANE_DIR=${LANE_DIR:-/root/paddle-zh-5600}
BOX=${BOX:?BOX=<name> required}
TYPE=${TYPE:-L4-1-24G}
ZONE_FILE=$LANE_DIR/boxes/$BOX/zone
ZONE=${ZONE:-$(cat "$ZONE_FILE" 2>/dev/null || echo pl-waw-2)}
OWNER=${PADDLE_ZH_ISSUE:-5600}   # a later run of the lane (#5660) names its own issue on the box and its lease
NAME=sl-zh-paddle-$OWNER-$BOX
D=$LANE_DIR/boxes/$BOX
mkdir -p "$D"
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
LEASE_H=${LEASE_H:-6}
ROOT_GB=${ROOT_GB:-80}
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
set -a; . /root/.scaleway.env; set +a
API=https://api.scaleway.com/instance/v1/zones/$ZONE
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
sid() { cat "$D/server-id"; }
state() { curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("server"); print((s["state"]+" "+((s.get("public_ip") or {}).get("address",""))) if s else "gone -")'; }
ip() { state | awk '{print $2}'; }
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
log() { echo "$(date -u +%FT%TZ) [$BOX] $*" | tee -a "$D/driver.log" >> "$LANE_DIR/fleet.log"; echo "$(date -u +%FT%TZ) [$BOX] $*"; }
image_for() {  # the Ubuntu Noble GPU OS image in this zone
  curl -s "${H[@]}" "https://api.scaleway.com/marketplace/v2/local-images?zone=$ZONE&type=instance_sbs&page_size=100&image_label=ubuntu_noble_gpu_os_12" \
    | python3 -c 'import json,sys,os; t=os.environ["TYPE"]; L=[i for i in json.load(sys.stdin).get("local_images",[]) if t in i.get("compatible_commercial_types",[])]; print(L[0]["id"] if L else "")'
}
case ${1:-} in
create)
  [ -s "$D/server-id" ] && { echo "server exists: $(sid)"; exit 1; }
  IMAGE=${IMAGE:-$(TYPE=$TYPE image_for)}
  [ -n "$IMAGE" ] || { log "no GPU OS image for $TYPE in $ZONE"; exit 1; }
  until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
  body=$(printf '{"name":"%s","commercial_type":"%s","image":"%s","project":"%s","dynamic_ip_required":true,"tags":["lease-until=%s","owner=%s","progress=mongo:paddle"],"volumes":{"0":{"size":%s,"volume_type":"sbs_volume"}}}' "$NAME" "$TYPE" "$IMAGE" "$PROJECT" "$until" "$OWNER" "$((ROOT_GB*1000000000))")
  r=$(curl -s -X POST "${H[@]}" "$API/servers" -d "$body")
  echo "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["server"]["id"])' > "$D/server-id" 2>/dev/null || { log "create failed ($TYPE $ZONE): ${r:0:300}"; rm -f "$D/server-id"; exit 1; }
  echo "$ZONE" > "$ZONE_FILE"; echo "$TYPE" > "$D/type"
  log "created $(sid) $TYPE $ZONE lease-until=$until"
  printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$D/user-data"
  curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$D/user-data" "$API/servers/$(sid)/user_data/cloud-init" >/dev/null
  r=$(curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweron"}'); log "poweron: ${r:0:160}"
  ok=0; for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && { ok=1; break; }; [ "${s%% *}" = stopped ] && [ "$i" -gt 6 ] && break; sleep 10; done
  date -u +%s > "$D/created-at"
  [ $ok = 1 ] || { log "did not reach running ($(state)) — out of stock? deleting"; "$0" delete-now; exit 1; }
  log "running $(ip)"
  (cd "$REPO" && node scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$ZONE" --hours "$LEASE_H" --owner "$OWNER" --progress mongo:paddle) 2>&1 | tail -1 | tee -a "$D/driver.log"
  # the GPU OS image puts user-data keys on `ubuntu` (disable_root); copy them to root
  for i in $(seq 1 90); do $SSH ubuntu@"$(ip)" "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && $SSH root@"$(ip)" true 2>/dev/null && { log SSH-OK; exit 0; }; sleep 10; done
  log SSH-FAIL; exit 1 ;;
lease)
  (cd "$REPO" && node scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$ZONE" --hours "${2:-$LEASE_H}" --owner "$OWNER" --progress mongo:paddle) 2>&1 | tail -1 | tee -a "$D/driver.log" ;;
push)
  B=root@$(ip); M=${2:?manifest}
  $SSH "$B" 'mkdir -p /root/pz/code'
  rsync -a -e "$SSH" "$M" "$B":/root/pz/manifest.tsv
  rsync -a -e "$SSH" "$HERE/paddle-zh-box.sh" "$HERE/paddle-zh-run.py" "$HERE/paddle-vl-box.sh" "$HERE/idle-poweroff.sh" "$B":/root/pz/code/
  printf 'SCW_SECRET_KEY=%s\n' "$SCALEWAY_SECRET_KEY" | $SSH "$B" 'umask 077; cat > /etc/gpu-idle.env'
  log "pushed $(wc -l < "$M") manifest rows" ;;
setup)
  $SSH root@"$(ip)" "cd /root/pz && PV_WORK=/root/pz SERVER=${SERVER:-0} bash code/paddle-zh-box.sh setup" 2>&1 | tail -3 | tee -a "$D/driver.log" ;;
run)
  # `;` not `&&`: with `&&` the WHOLE list is the async job, its fds are the ssh channel, and ssh never returns
  $SSH root@"$(ip)" "cd /root/pz; rm -f DONE job.exit; WORKERS=${WORKERS:-2} BACKEND=${BACKEND:-native} CLIENTS=${CLIENTS:-8} MAX_SIDE=${MAX_SIDE:-0} LAYOUT=${LAYOUT:-1} INFER_HOURS=${INFER_HOURS:-6} nohup bash code/idle-poweroff.sh run -- bash -c 'bash code/paddle-zh-box.sh ${MODE:-all}; echo exit=\$? > /root/pz/job.exit; sleep ${LINGER:-1800}' > /root/pz/idle.log 2>&1 < /dev/null & echo launched" | tee -a "$D/driver.log" ;;
status)
  $SSH root@"$(ip)" 'tail -n 2 /root/pz/box.log 2>/dev/null; echo "txt $(find /root/pz/out -name "*.txt" 2>/dev/null | wc -l)"; cat /root/pz/job.exit 2>/dev/null; ls /root/pz/DONE 2>/dev/null; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader' ;;
ssh)
  shift; $SSH root@"$(ip)" "$@" ;;
pull)
  B=root@$(ip); OUT=${2:-$LANE_DIR/out}
  mkdir -p "$OUT"
  rsync -a --ignore-existing -e "$SSH" "$B":/root/pz/out/ "$OUT/"
  rsync -a -e "$SSH" "$B":/root/pz/box.json "$B":/root/pz/box.log "$B":/root/pz/timings.jsonl "$D/" 2>/dev/null || true
  rsync -a -e "$SSH" "$B":'/root/pz/timings-*.jsonl' "$D/" 2>/dev/null || true
  log "pulled; $(find "$OUT" -name '*.txt' | wc -l) texts in $OUT" ;;
stop)
  curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweroff"}' >/dev/null
  for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] && { log "STOPPED $(sid)"; exit 0; }; sleep 15; done
  log "STOP NOT CONFIRMED: $(state)"; exit 1 ;;
delete|delete-now)
  s=$(state)
  if [ "${s%% *}" != stopped ] && [ "${s%% *}" != gone ]; then
    [ "$1" = delete-now ] || { echo "not stopped: $s"; exit 1; }
    curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweroff"}' >/dev/null
    for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] && break; sleep 15; done
  fi
  vols=$(curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("server"); print(" ".join(v["id"] for v in (d or {}).get("volumes",{}).values()))')
  curl -s -X DELETE "${H[@]}" "$API/servers/$(sid)" >/dev/null
  for v in $vols; do for i in $(seq 1 12); do r=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" "https://api.scaleway.com/block/v1alpha1/zones/$ZONE/volumes/$v"); [ "$r" = 204 ] && break; sleep 10; done; log "volume $v delete -> $r"; done
  log "deleted server $(sid)"; mv "$D/server-id" "$D/server-id.deleted.$(date +%s)" ;;
*) echo "usage: BOX=<name> $0 create|lease|push|setup|run|status|ssh|pull|stop|delete"; exit 2 ;;
esac
