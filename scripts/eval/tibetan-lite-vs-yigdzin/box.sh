#!/bin/bash
# yigdzin-527 (#4523): one rented L4 per shard for the per-leaf Yigdzin read of the 527 held lite-preview books.
# PRIOR ART: scripts/eval/zh-cohort-5547-gpu.sh (create with lease tag at birth, cloud-init key, ubuntu->root key copy,
# API stop, delete with volume) and /root/tib-step2/box/{run.sh,run-wrap.sh,setup.sh} (the 10-02 step-2 box: same
# worker yig_leaf_worker.py, partition mode, batch 128, pinned BDRC/tibetan-ocr 50506eb6 on vLLM 0.29.0). Only the
# todo and the box count differ; the worker, setup and read flags are copied unchanged.
#
#   BOX=<k> ZONE=<zone> [TYPE=L4-4-24G] box.sh create|push|run|status|stop|delete
# State: /root/yig527/boxes/<k>/{server-id,zone,type,driver.log}. Box name sl-yig527-<k>, owner 4523.
# Multi-GPU types (L4-2/L4-4; the L4-1 quota is 2 per zone and #5600 held the rest on 10-03): the shard is split into one
# todo per GPU, and one worker runs per GPU (CUDA_VISIBLE_DEVICES) in /root/tib2/g<i>/ -- same worker, same flags.
set -eu
K=${BOX:?BOX=<shard index>}
D=/root/yig527; S=$D/boxes/$K; mkdir -p "$S"
[ -s "$S/zone" ] || echo "${ZONE:?ZONE required at create}" > "$S/zone"
ZONE=$(cat "$S/zone")
[ -s "$S/type" ] || echo "${TYPE:-L4-1-24G}" > "$S/type"
TYPE=$(cat "$S/type"); GPUS=$(echo "$TYPE" | cut -d- -f2)
NAME=sl-yig527-$K
LEASE_H=${LEASE_H:-4}
case $ZONE in fr-par-1) IMAGE=d459b881-5396-40ff-9152-afbe50aa53fd ;; pl-waw-2) IMAGE=2b1e002a-f3c1-40e2-8da4-18caf1dd05a9 ;;
  *) echo "no image id for $ZONE"; exit 1 ;; esac   # Ubuntu Noble GPU OS 12 passthrough (the step-2 / #5547 image)
PROJECT=873752fd-c333-4f03-87ab-9db2af36a853
REPO=/root/sourcelibrary
set -a; . /root/.scaleway.env; set +a
API=https://api.scaleway.com/instance/v1/zones/$ZONE
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
sid() { cat "$S/server-id"; }
state() { curl -s "${H[@]}" $API/servers/$(sid) | python3 -c 'import json,sys; s=json.load(sys.stdin)["server"]; print(s["state"], (s.get("public_ip") or {}).get("address",""))'; }
ip() { state | awk '{print $2}'; }
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$S/driver.log"; }
lease() { (cd "$REPO" && set -a && . ./.env.production.local && set +a && node scripts/maintenance/gpu-lease-watchdog.mjs --lease $(sid) --zone $ZONE --hours ${1:-$LEASE_H} --owner 4523 ${2:+--progress $2}) | tail -1; }
case ${1:-} in
create)
  [ -s "$S/server-id" ] && { echo "server exists: $(sid)"; exit 1; }
  until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
  r=$(curl -s -X POST "${H[@]}" $API/servers -d "{\"name\":\"$NAME\",\"commercial_type\":\"$TYPE\",\"image\":\"$IMAGE\",\"project\":\"$PROJECT\",\"dynamic_ip_required\":true,\"volumes\":{\"0\":{\"size\":100000000000,\"volume_type\":\"sbs_volume\"}},\"tags\":[\"lease-until=$until\",\"owner=4523\"]}")
  echo "$r" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["server"]["id"])' > "$S/server-id" || { echo "create failed: $r"; rm -f "$S/server-id"; exit 1; }
  log "created $NAME $(sid) in $ZONE lease-until=$until"
  printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$S/user-data"
  curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$S/user-data" $API/servers/$(sid)/user_data/cloud-init; echo
  r=$(curl -s -X POST "${H[@]}" $API/servers/$(sid)/action -d '{"action":"poweron"}'); log "poweron: ${r:0:160}"
  for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && break; [ "${s%% *}" = stopped ] && [ $i -gt 4 ] && { log "back to stopped (out of stock?)"; exit 1; }; sleep 10; done
  log "state: $(state)"
  ssh-keygen -f /root/.ssh/known_hosts -R "$(ip)" >/dev/null 2>&1 || true   # Scaleway reuses IPs; a stale host key blocks BatchMode ssh
  for i in $(seq 1 60); do $SSH ubuntu@$(ip) "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && $SSH root@$(ip) true 2>/dev/null && { log SSH-OK; exit 0; }; sleep 10; done
  log SSH-FAIL; exit 1 ;;
push)
  B=root@$(ip)
  $SSH $B 'mkdir -p /root/tib2 /root/yig'
  rsync -a -e "$SSH" $D/box/yig_leaf_worker.py $D/box/leafsplit.py $REPO/scripts/gpu/idle-poweroff.sh $B:/root/tib2/
  rsync -a -e "$SSH" $D/box/setup.sh $B:/root/yig/setup.sh
  printf 'SCW_SECRET_KEY=%s\n' "$SCALEWAY_SECRET_KEY" | $SSH $B 'umask 077; cat > /etc/gpu-idle.env'
  if [ "$GPUS" = 1 ]; then
  rsync -a -e "$SSH" $D/shards/todo-$K.jsonl $B:/root/tib2/todo-main.jsonl
  # run.sh = /root/tib-step2/box/run.sh (same flags); run-wrap.sh = step 2's (hold for the Hetzner final pull)
  $SSH $B "cat > /root/tib2/run.sh" <<'RUN'
#!/bin/bash
cd /root/tib2
export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential
/root/venv/bin/python yig_leaf_worker.py --todo todo-main.jsonl --out /root/tib2/run --mode partition \
  --batch 128 --stop-file /root/tib2/STOP >> /root/tib2/run.log 2>&1
echo "exit=$? $(date -u +%FT%TZ)" > /root/tib2/run.exit
RUN
  $SSH $B "cat > /root/tib2/run-wrap.sh" <<'WRAP'
#!/bin/bash
[ -f /root/yig/SETUP-OK ] || bash /root/yig/setup.sh > /root/yig/setup.log 2>&1 || { echo "exit=setup-failed $(date -u +%FT%TZ)" > /root/tib2/run.exit; }
[ -f /root/yig/SETUP-OK ] && bash /root/tib2/run.sh
for i in $(seq 1 50); do [ -f /root/tib2/PULLED ] && break; sleep 30; done
WRAP
  $SSH $B 'wc -l < /root/tib2/todo-main.jsonl; ls -la /etc/gpu-idle.env; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader' | tee -a "$S/driver.log"
  else
  python3 - "$D/shards/todo-$K.jsonl" "$S" "$GPUS" <<'PY'
import sys
src, d, g = sys.argv[1], sys.argv[2], int(sys.argv[3]); rows = open(src).read().splitlines()
outs = [open(f"{d}/todo-g{i}.jsonl", "w") for i in range(g)]
for j in range(0, len(rows), 500):
    outs[(j // 500) % g].write("\n".join(rows[j:j + 500]) + "\n")
PY
  for i in $(seq 0 $((GPUS - 1))); do $SSH $B "mkdir -p /root/tib2/g$i"; rsync -a -e "$SSH" $S/todo-g$i.jsonl $B:/root/tib2/g$i/todo-main.jsonl; done
  $SSH $B "cat > /root/tib2/run-g.sh" <<'RUN'
#!/bin/bash
# one worker per GPU: same worker and flags as /root/tib-step2/box/run.sh, in /root/tib2/g<i>
G=$1; cd /root/tib2/g$G
export CUDA_VISIBLE_DEVICES=$G VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential
/root/venv/bin/python /root/tib2/yig_leaf_worker.py --todo todo-main.jsonl --out /root/tib2/g$G/run --mode partition \
  --batch 128 --stop-file /root/tib2/STOP >> /root/tib2/g$G/run.log 2>&1
echo "exit=$? $(date -u +%FT%TZ)" > /root/tib2/g$G/run.exit
RUN
  $SSH $B "cat > /root/tib2/run-wrap.sh" <<WRAP
#!/bin/bash
[ -f /root/yig/SETUP-OK ] || bash /root/yig/setup.sh > /root/yig/setup.log 2>&1 || { for i in \$(seq 0 $((GPUS - 1))); do echo "exit=setup-failed" > /root/tib2/g\$i/run.exit; done; }
if [ -f /root/yig/SETUP-OK ]; then for i in \$(seq 0 $((GPUS - 1))); do bash /root/tib2/run-g.sh \$i & sleep 20; done; wait; fi
for i in \$(seq 1 50); do [ -f /root/tib2/PULLED ] && break; sleep 30; done
WRAP
  $SSH $B 'wc -l /root/tib2/g*/todo-main.jsonl; ls -la /etc/gpu-idle.env; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader' | tee -a "$S/driver.log"
  fi ;;
run)
  $SSH root@$(ip) "nohup bash /root/tib2/idle-poweroff.sh run -- bash /root/tib2/run-wrap.sh > /root/tib2/idle.log 2>&1 < /dev/null & echo launched" | tee -a "$S/driver.log" ;;
status)
  echo "$(state)"; $SSH root@$(ip) 'for d in /root/tib2 /root/tib2/g*; do [ -f $d/run.log ] || continue; echo "== $d"; grep -a " done " $d/run.log | tail -n 1; ls $d/run/txt 2>/dev/null | wc -l; cat $d/run.exit 2>/dev/null; done; tail -n 3 /root/yig/setup.log 2>/dev/null; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader' ;;
lease) lease "${2:-$LEASE_H}" "${3:-}" ;;
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
*) echo "usage: BOX=k ZONE=z $0 create|push|run|status|lease [h] [progress]|stop|delete"; exit 2 ;;
esac
