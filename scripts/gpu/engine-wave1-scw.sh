#!/bin/bash
# engine-wave1-scw.sh (#6011 wave 1): ONE leased Scaleway GPU reads the 385 bench pages with DeepSeek-OCR,
# Qwen3-VL-8B-Instruct and Chandra OCR 2 (scripts/gpu/engine-wave1-box.sh), the outputs are pulled, and the
# box is deleted (trap) and its absence confirmed on the provider API. Nothing is written to Mongo.
#
# PRIOR ART: scripts/gpu/kraken-digits-4686-scw.sh (commit 93c1f8a95: the create / lease / idle-guard / pull /
# delete lifecycle, copied; it serves GLM-OCR and runs Kraken). What differs: the on-box work is
# engine-wave1-box.sh (three vLLM models in turn), the input is the bench image tree, owner=6011.
#
#   LANE_DIR=/root/engine-wave1-6011/gpu CAP_USD=9.5 TYPE=H100-1-80G ZONE=pl-waw-2 LEASE_H=3 scripts/gpu/engine-wave1-scw.sh run | spend | down
set -u
set -a; . /root/sourcelibrary/.env.production.local; . /root/.scaleway.env; set +a
LANE_DIR=${LANE_DIR:-/root/engine-wave1-6011/gpu}; BOX=${BOX:-g1}; BENCH=${BENCH:-/root/engine-wave1-6011/bench}
TYPE=${TYPE:-H100-1-80G}; ZONE=${ZONE:-pl-waw-2}; LEASE_H=${LEASE_H:-3}; ROOT_GB=${ROOT_GB:-80}
CAP_USD=${CAP_USD:-5}; MARGIN_USD=${MARGIN_USD:-0.25}; POLL=${POLL:-120}; EUR_USD=${EUR_USD:-1.17}
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
D=$LANE_DIR/boxes/$BOX; mkdir -p "$D" "$LANE_DIR/out"
NAME=sl-engine-wave1-6011-$BOX
API=https://api.scaleway.com/instance/v1/zones/$ZONE
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30"
log() { echo "$(date -u +%FT%TZ) [$BOX] $*" | tee -a "$LANE_DIR/driver.log"; }
sid() { cat "$D/server-id"; }
state() { curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("server"); print((s["state"]+" "+((s.get("public_ip") or {}).get("address",""))) if s else "gone -")'; }
ip() { state | awk '{print $2}'; }
on() { $SSH root@"$(ip)" "$@"; }

spend() {
  python3 - "$D" <<'PY'
import os, sys, time
d = sys.argv[1]
r = lambda f: open(os.path.join(d, f)).read().strip() if os.path.exists(os.path.join(d, f)) else None
c, rate = r('created-at'), r('cost-per-hr')
print(f'{((float(r("ended-at") or time.time()) - float(c)) / 3600 * float(rate)) if c and rate else 0:.3f}')
PY
}
over() { python3 -c "import sys; sys.exit(0 if $(spend) >= $CAP_USD - $MARGIN_USD else 1)"; }

delete_box() {
  [ -s "$D/server-id" ] || { echo "no server"; return 0; }
  curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweroff"}' >/dev/null
  for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] || [ "${s%% *}" = gone ] && break; sleep 15; done
  [ -s "$D/ended-at" ] || date -u +%s > "$D/ended-at"
  vols=$(curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("server"); print(" ".join(v["id"] for v in (d or {}).get("volumes",{}).values()))')
  curl -s -X DELETE "${H[@]}" "$API/servers/$(sid)" >/dev/null
  for v in $vols; do for i in $(seq 1 12); do r=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" "https://api.scaleway.com/block/v1alpha1/zones/$ZONE/volumes/$v"); [ "$r" = 204 ] && break; sleep 10; done; log "volume $v delete -> $r"; done
  s=$(state); log "DELETED $(sid) (now: $s); billed ≈ \$$(spend)"
  mv "$D/server-id" "$D/server-id.deleted"
}

case ${1:-} in
spend) spend ;;
down) delete_box ;;
run)
  over && { log "BUDGET: \$$(spend) already spent of \$$CAP_USD — not creating a box"; exit 3; }
  [ -s "$BENCH/selection.json" ] || { log "no $BENCH/selection.json"; exit 1; }
  if [ ! -s "$D/server-id" ]; then
    IMAGE=$(curl -s "${H[@]}" "https://api.scaleway.com/marketplace/v2/local-images?zone=$ZONE&type=instance_sbs&page_size=100&image_label=ubuntu_noble_gpu_os_12" \
      | TYPE=$TYPE python3 -c 'import json,sys,os; t=os.environ["TYPE"]; L=[i for i in json.load(sys.stdin).get("local_images",[]) if t in i.get("compatible_commercial_types",[])]; print(L[0]["id"] if L else "")')
    [ -n "$IMAGE" ] || { log "no GPU OS image for $TYPE in $ZONE"; exit 1; }
    until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
    body=$(printf '{"name":"%s","commercial_type":"%s","image":"%s","project":"%s","dynamic_ip_required":true,"tags":["lease-until=%s","owner=6011"],"volumes":{"0":{"size":%s,"volume_type":"sbs_volume"}}}' "$NAME" "$TYPE" "$IMAGE" "$PROJECT" "$until" "$((ROOT_GB*1000000000))")
    r=$(curl -s -X POST "${H[@]}" "$API/servers" -d "$body")
    echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["server"]["id"])' > "$D/server-id" 2>/dev/null || { rm -f "$D/server-id"; log "create failed ($TYPE $ZONE): ${r:0:300}"; exit 1; }
    hp=$(curl -s "${H[@]}" "$API/products/servers?per_page=100" | TYPE=$TYPE python3 -c 'import json,sys,os; print(json.load(sys.stdin)["servers"][os.environ["TYPE"]]["hourly_price"])')
    python3 -c "print(round($hp*$EUR_USD,4))" > "$D/cost-per-hr"; echo "$ZONE" > "$D/zone"; echo "$TYPE" > "$D/type"
    date -u +%s > "$D/created-at"
    log "created $(sid) $NAME $TYPE $ZONE (€$hp/h ≈ \$$(cat $D/cost-per-hr)/h) lease-until=$until"
    printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$D/user-data"
    curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$D/user-data" "$API/servers/$(sid)/user_data/cloud-init" >/dev/null
    curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweron"}' >/dev/null
    ok=0; for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && { ok=1; break; }; sleep 10; done
    [ $ok = 1 ] || { log "did not reach running ($(state)) — deleting"; delete_box; exit 1; }
    (cd "$REPO" && node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$ZONE" --hours "$LEASE_H" --owner 6011) 2>&1 | tail -1 | tee -a "$D/driver.log"
    for i in $(seq 1 90); do $SSH ubuntu@"$(ip)" "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && on true 2>/dev/null && break; sleep 10; done
    on true || { log "SSH-FAIL — deleting"; delete_box; exit 1; }
    log "SSH-OK $(ip)"
  fi
  trap 'delete_box; log "RUN-DONE spend \$$(spend)"' EXIT
  # the on-box idle guard: the provider-API poweroff, with a key that can act on this project
  on "mkdir -p /root/ew1/code /root/ew1/out; umask 077; printf 'SCW_SECRET_KEY=%s\nIDLE_MINUTES=25\nGRACE_MINUTES=45\n' '$SCALEWAY_SECRET_KEY' > /etc/gpu-idle.env"
  on 'command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync >/dev/null 2>&1)'
  rsync -a -e "$SSH" "$HERE/idle-poweroff.sh" "$HERE/engine-wave1-box.sh" "$HERE/engine-wave1-run.py" root@"$(ip)":/root/ew1/code/
  rsync -a --exclude out --exclude _export -e "$SSH" "$BENCH/" root@"$(ip)":/root/ew1/bench/
  on "bash /root/ew1/code/idle-poweroff.sh install >/dev/null 2>&1; systemctl is-active gpu-idle-poweroff 2>/dev/null || true" | tee -a "$LANE_DIR/driver.log"
  on "cd /root/ew1; rm -f DONE pulled; nohup bash /root/ew1/code/idle-poweroff.sh run -- bash -c 'EW1_WORK=/root/ew1 bash /root/ew1/code/engine-wave1-box.sh all; for i in \$(seq 1 90); do [ -f /root/ew1/pulled ] && break; sleep 20; done' > box.out 2>&1 < /dev/null & echo launched"
  log "launched on $(find "$BENCH" -maxdepth 2 -name '*.jpg' | wc -l) pages"
  pull() { rsync -a -e "$SSH" root@"$(ip)":/root/ew1/out/ "$LANE_DIR/out/"; rsync -a --include '*.log' --include 'box.json' --exclude '*' -e "$SSH" root@"$(ip)":/root/ew1/ "$LANE_DIR/box/"; true; }
  mkdir -p "$LANE_DIR/box"
  while :; do
    sleep $POLL
    pull
    log "pulled: $(for e in deepseek-ocr qwen3-vl-8b chandra-ocr-2; do echo -n "$e $(find $LANE_DIR/out/$e -name '*.txt' 2>/dev/null | wc -l) "; done)| spend \$$(spend) | gpu $(on 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader' 2>/dev/null) | $(tail -1 $LANE_DIR/box/box.log 2>/dev/null)"
    if on "test -f /root/ew1/DONE"; then pull; on "touch /root/ew1/pulled"; log "RUN-END"; break; fi
    if over; then log "BUDGET-STOP at \$$(spend) of \$$CAP_USD"; pull; break; fi
    [ "$(state | cut -d' ' -f1)" = running ] || { log "box no longer running ($(state))"; pull; break; }
    [ -f "$LANE_DIR/STOP" ] && { pull; log "STOP file"; break; }
  done ;;
*) echo "usage: LANE_DIR=… $0 run|spend|down"; exit 2 ;;
esac
