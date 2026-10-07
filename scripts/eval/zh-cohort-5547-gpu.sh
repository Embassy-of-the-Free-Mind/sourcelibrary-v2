#!/bin/bash
# PRIOR ART: scripts/eval/ocr-preprocessing/tibetan-gpu.sh (#5250 — start/push/run/pull/stop of an
# EXISTING leased L4 from Hetzner). This run has no box of its own, so `create` makes one (tagged with
# its lease at birth), cloud-init puts Hetzner's key on it (a reused box loses it on every poweron),
# and `delete` removes it and its volume once the outputs are pulled — a stopped box's volume still bills.
#
# #5547 step 4 — PaddleOCR-VL scale pilot, driven from Hetzner. Inputs are on Hetzner BEFORE `create`
# (zh-cohort-5547-pilot.mjs prep). Steps, each checkable:
#   create   server L4-1-24G in $ZONE, tags lease-until=now+LEASE_H, owner=5547; user-data adds this
#            host's ssh key; poweron; wait for ssh; re-issue the lease from boot via the watchdog
#   push     pilot dir (img/, manifest.tsv) + box scripts + /etc/gpu-idle.env (API key for self-poweroff)
#   run      on the box: idle-poweroff.sh run -- (paddle-vl-box.sh all; sleep 1500)
#   status   box log tail + pages out
#   pull     box outputs -> pilot dir
#   stop     API poweroff, confirm stopped
#   delete   terminate the server and delete its volume (only after pull)
set -eu
ZONE=${ZONE:-pl-waw-2}
NAME=sl-zh-paddle-5547
DIR=${PILOT_DIR:-/root/zh-ocr-eval-5547/pilot}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
LEASE_H=${LEASE_H:-5}
IMAGE=${IMAGE:-2b1e002a-f3c1-40e2-8da4-18caf1dd05a9}   # Ubuntu Noble GPU OS 12 passthrough, pl-waw-2
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
set -a; . /root/.scaleway.env; set +a
API=https://api.scaleway.com/instance/v1/zones/$ZONE
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
SID_FILE=$DIR/server-id
sid() { cat "$SID_FILE"; }
state() { curl -s "${H[@]}" $API/servers/$(sid) | python3 -c 'import json,sys; s=json.load(sys.stdin)["server"]; print(s["state"], (s.get("public_ip") or {}).get("address",""))'; }
ip() { state | awk '{print $2}'; }
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$DIR/driver.log"; }
case ${1:-} in
create)
  [ -s "$SID_FILE" ] && { echo "server exists: $(sid)"; exit 1; }
  until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
  r=$(curl -s -X POST "${H[@]}" $API/servers -d "{\"name\":\"$NAME\",\"commercial_type\":\"L4-1-24G\",\"image\":\"$IMAGE\",\"project\":\"$PROJECT\",\"dynamic_ip_required\":true,\"tags\":[\"lease-until=$until\",\"owner=5547\"]}")
  echo "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["server"]["id"])' > "$SID_FILE" || { echo "create failed: $r"; rm -f "$SID_FILE"; exit 1; }
  log "created $(sid) lease-until=$until"
  printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$DIR/user-data"
  curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$DIR/user-data" $API/servers/$(sid)/user_data/cloud-init; echo
  r=$(curl -s -X POST "${H[@]}" $API/servers/$(sid)/action -d '{"action":"poweron"}'); log "poweron: ${r:0:120}"
  for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && break; [ "${s%% *}" = stopped ] && [ $i -gt 4 ] && { log "back to stopped (out of stock?)"; exit 1; }; sleep 10; done
  log "state: $(state)"
  (cd "$REPO" && node scripts/maintenance/gpu-lease-watchdog.mjs --lease $(sid) --zone $ZONE --hours $LEASE_H --owner 5547) | tail -2
  # the GPU OS image puts user-data keys on `ubuntu` (disable_root), so copy them to root
  for i in $(seq 1 60); do $SSH ubuntu@$(ip) "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && $SSH root@$(ip) true 2>/dev/null && { log SSH-OK; exit 0; }; sleep 10; done
  log SSH-FAIL; exit 1 ;;
push)
  B=root@$(ip)
  $SSH $B 'mkdir -p /root/pv/code'
  rsync -a -e "$SSH" "$DIR/img" "$DIR/manifest.tsv" $B:/root/pv/
  rsync -a -e "$SSH" "$REPO/scripts/gpu/paddle-vl-box.sh" "$REPO/scripts/gpu/paddle-vl-run.py" "$REPO/scripts/gpu/idle-poweroff.sh" $B:/root/pv/code/
  printf 'SCW_SECRET_KEY=%s\n' "$SCALEWAY_SECRET_KEY" | $SSH $B 'umask 077; cat > /etc/gpu-idle.env'
  $SSH $B 'wc -l < /root/pv/manifest.tsv; du -sh /root/pv/img; ls -la /etc/gpu-idle.env; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader' | tee -a "$DIR/driver.log" ;;
run)
  $SSH root@$(ip) "cd /root/pv && WORKERS=${WORKERS:-3} INFER_HOURS=${INFER_HOURS:-3} nohup bash code/idle-poweroff.sh run -- bash -c 'bash code/paddle-vl-box.sh all; echo exit=\$? > /root/pv/job.exit; sleep 1500' > /root/pv/idle.log 2>&1 < /dev/null & echo launched" | tee -a "$DIR/driver.log" ;;
status)
  $SSH root@$(ip) 'tail -n 3 /root/pv/box.log 2>/dev/null; find /root/pv/out -name "*.txt" 2>/dev/null | wc -l; cat /root/pv/job.exit 2>/dev/null; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader; tail -n 2 /root/pv/worker-0.log 2>/dev/null' ;;
pull)
  B=root@$(ip)
  mkdir -p "$DIR/out"
  rsync -a -e "$SSH" $B:/root/pv/out/ "$DIR/out/"
  rsync -a -e "$SSH" $B:/root/pv/box.json $B:/root/pv/box.log $B:/root/pv/timings.jsonl $B:/root/pv/setup.log $B:/root/pv/idle.log "$DIR/" 2>/dev/null || true
  rsync -a -e "$SSH" $B:'/root/pv/timings-*.jsonl' $B:'/root/pv/worker-*.log' "$DIR/" 2>/dev/null || true
  log "pulled $(find "$DIR/out" -name '*.txt' | wc -l) page texts" ;;
stop)
  curl -s -X POST "${H[@]}" $API/servers/$(sid)/action -d '{"action":"poweroff"}'; echo
  for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] && { log "STOPPED $(sid)"; exit 0; }; sleep 15; done
  log NOT-CONFIRMED; exit 1 ;;
delete)
  s=$(state); [ "${s%% *}" = stopped ] || { echo "not stopped: $s"; exit 1; }
  vols=$(curl -s "${H[@]}" $API/servers/$(sid) | python3 -c 'import json,sys; print(" ".join(v["id"] for v in json.load(sys.stdin)["server"]["volumes"].values()))')
  curl -s -X DELETE "${H[@]}" $API/servers/$(sid); echo
  for v in $vols; do for i in $(seq 1 12); do r=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" https://api.scaleway.com/block/v1alpha1/zones/$ZONE/volumes/$v); [ "$r" = 204 ] && break; sleep 10; done; log "volume $v delete -> $r"; done
  log "deleted server $(sid)" ;;
*) echo "usage: $0 create|push|run|status|pull|stop|delete"; exit 2 ;;
esac
