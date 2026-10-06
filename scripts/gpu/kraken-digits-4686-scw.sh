#!/bin/bash
# kraken-digits-4686 (#4686): ONE leased Scaleway L4 reads the Gemini-refused English pages twice — GLM-OCR
# (for its numbers) and Kraken CATMuS-Print on the GPU (for the text) — and is deleted. Nothing is written
# to Mongo here; the gate and the write are scripts/eval/kraken-refused-4686/ and the lane script.
#
# PRIOR ART: scripts/gpu/glm-english-scw.sh (PR #5816: the Scaleway create / lease / vLLM-serve-GLM / pull /
# delete lifecycle — copied, trimmed to one run, no Mongo apply) and glm-english-run.py (its pod client,
# copied unchanged). What differs: Kraken runs on the same box, the on-box job runs under
# scripts/gpu/idle-poweroff.sh `run --` with the `watch` service installed too (no Mongo progress exists to
# give the Hetzner watchdog an idle signal, so the lease is short and the box guards itself), and the
# driver deletes the box after the pull whatever happens (trap).
#
#   LANE_DIR=/root/kraken-digits-4686 CAP_USD=5 scripts/gpu/kraken-digits-4686-scw.sh run | spend | down
# Env: TYPE (L4-1-24G), ZONE (fr-par-2; check /products/servers/availability — fr-par L4 was 'shortage' 2026-10-06, pl-waw-2 'scarce'), LEASE_H (3), EUR_USD (1.17), KRAKEN_MODEL (CATMuS-Print large).
set -u
set -a; . /root/sourcelibrary/.env.production.local; . /root/.scaleway.env; set +a
LANE_DIR=${LANE_DIR:-/root/kraken-digits-4686}; BOX=${BOX:-k1}
TYPE=${TYPE:-L4-1-24G}; ZONE=${ZONE:-fr-par-2}; LEASE_H=${LEASE_H:-3}; ROOT_GB=${ROOT_GB:-80}
CAP_USD=${CAP_USD:-5}; MARGIN_USD=${MARGIN_USD:-0.25}; POLL=${POLL:-120}; EUR_USD=${EUR_USD:-1.17}
KRAKEN_MODEL=${KRAKEN_MODEL:-/root/.local/share/htrmopo/d96caf7a-122e-5576-ab2b-a246c4e64221/catmus-print-fondue-large.mlmodel}
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
D=$LANE_DIR/boxes/$BOX; mkdir -p "$D" "$LANE_DIR/out" "$LANE_DIR/kr"
NAME=sl-kraken-digits-4686-$BOX
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
  [ -s "$LANE_DIR/manifest.tsv" ] || { log "no $LANE_DIR/manifest.tsv"; exit 1; }
  if [ ! -s "$D/server-id" ]; then
    IMAGE=$(curl -s "${H[@]}" "https://api.scaleway.com/marketplace/v2/local-images?zone=$ZONE&type=instance_sbs&page_size=100&image_label=ubuntu_noble_gpu_os_12" \
      | TYPE=$TYPE python3 -c 'import json,sys,os; t=os.environ["TYPE"]; L=[i for i in json.load(sys.stdin).get("local_images",[]) if t in i.get("compatible_commercial_types",[])]; print(L[0]["id"] if L else "")')
    [ -n "$IMAGE" ] || { log "no GPU OS image for $TYPE in $ZONE"; exit 1; }
    until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
    body=$(printf '{"name":"%s","commercial_type":"%s","image":"%s","project":"%s","dynamic_ip_required":true,"tags":["lease-until=%s","owner=4686"],"volumes":{"0":{"size":%s,"volume_type":"sbs_volume"}}}' "$NAME" "$TYPE" "$IMAGE" "$PROJECT" "$until" "$((ROOT_GB*1000000000))")
    r=$(curl -s -X POST "${H[@]}" "$API/servers" -d "$body")
    echo "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin)["server"]["id"])' > "$D/server-id" 2>/dev/null || { rm -f "$D/server-id"; log "create failed ($TYPE $ZONE): ${r:0:300}"; exit 1; }
    hp=$(curl -s "${H[@]}" "$API/products/servers?per_page=100" | TYPE=$TYPE python3 -c 'import json,sys,os; print(json.load(sys.stdin)["servers"][os.environ["TYPE"]]["hourly_price"])')
    python3 -c "print(round($hp*$EUR_USD,4))" > "$D/cost-per-hr"; echo "$ZONE" > "$D/zone"; echo "$TYPE" > "$D/type"
    date -u +%s > "$D/created-at"
    log "created $(sid) $NAME $TYPE $ZONE (€$hp/h ≈ \$$(cat $D/cost-per-hr)/h) lease-until=$until"
    printf '#cloud-config\nssh_authorized_keys:\n  - %s\n' "$(cat /root/.ssh/id_ed25519.pub)" > "$D/user-data"
    curl -s -X PATCH -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: text/plain" --data-binary @"$D/user-data" "$API/servers/$(sid)/user_data/cloud-init" >/dev/null
    log "poweron: $(curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweron"}' | head -c 300)"
    ok=0; for i in $(seq 1 60); do s=$(state); [ "${s%% *}" = running ] && { ok=1; break; }; sleep 10; done
    [ $ok = 1 ] || { log "did not reach running ($(state)) — deleting"; delete_box; exit 1; }
    (cd "$REPO" && node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$ZONE" --hours "$LEASE_H" --owner 4686) 2>&1 | tail -1 | tee -a "$D/driver.log"
    for i in $(seq 1 90); do $SSH ubuntu@"$(ip)" "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && on true 2>/dev/null && break; sleep 10; done
    on true || { log "SSH-FAIL — deleting"; delete_box; exit 1; }
    log "SSH-OK $(ip)"
  fi
  trap 'delete_box; log "RUN-DONE spend \$$(spend)"' EXIT
  # the on-box idle guard: the provider-API poweroff, with a key that can act on this project
  on "mkdir -p /root/pz/code /root/pz/out; umask 077; printf 'SCW_SECRET_KEY=%s\nIDLE_MINUTES=25\nGRACE_MINUTES=40\n' '$SCALEWAY_SECRET_KEY' > /etc/gpu-idle.env"
  rsync -a -e "$SSH" "$HERE/idle-poweroff.sh" "$HERE/glm-english-run.py" "$HERE/kraken-digits-4686-box.sh" "$LANE_DIR/manifest.tsv" "$KRAKEN_MODEL" root@"$(ip)":/root/pz/code/
  on "bash /root/pz/code/idle-poweroff.sh install >/dev/null 2>&1; systemctl is-active gpu-idle-poweroff 2>/dev/null || true" | tee -a "$LANE_DIR/driver.log"
  if ! on "curl -sf http://127.0.0.1:8200/v1/models >/dev/null"; then
    on 'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync >/dev/null 2>&1); curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1; U=/root/.local/bin/uv; $U venv -p 3.12 /root/pz/vl > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/vl timeout 1800 $U pip install -U vllm pillow --torch-backend auto > /root/pz/vl-setup.log 2>&1; tail -n 2 /root/pz/vl-setup.log; $U venv -p 3.12 /root/pz/kr > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/kr timeout 1800 $U pip install "kraken==7.1" --torch-backend auto > /root/pz/kr-setup.log 2>&1; tail -n 2 /root/pz/kr-setup.log; /root/pz/vl/bin/python -c "import vllm,torch;print(\"vllm\",vllm.__version__, torch.__version__, torch.cuda.is_available())"; /root/pz/kr/bin/python -c "import torch;print(\"kraken-torch\",torch.__version__, torch.cuda.is_available())"; /root/pz/kr/bin/kraken --version' | tee "$LANE_DIR/versions.txt"
    on "pkill -f '[v]llm serve'; sleep 3; true"
    on "cd /root/pz; (VLLM_USE_FLASHINFER_SAMPLER=0 nohup /root/pz/vl/bin/vllm serve zai-org/GLM-OCR --served-model-name m --max-model-len 32768 --gpu-memory-utilization 0.6 --limit-mm-per-prompt '{\"image\":1}' --port 8200 --speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":1}' > srv.log 2>&1 < /dev/null &); echo serving"
    t1=$(date +%s)
    until on "curl -sf http://127.0.0.1:8200/v1/models >/dev/null"; do
      if [ $(( $(date +%s) - t1 )) -gt 1500 ] || ! on "pgrep -f '[v]llm serve' >/dev/null"; then
        log "SERVE-FAIL"; on "tail -n 120 /root/pz/srv.log" > "$LANE_DIR/srv-fail.log"; exit 1; fi
      sleep 20; done
    log "SERVE-UP after $(( $(date +%s) - t1 )) s"
  fi
  rev=$(on "ls /root/.cache/huggingface/hub/models--zai-org--GLM-OCR/snapshots/ | head -1")
  python3 -c "import json,sys; json.dump({'server_id':sys.argv[1],'host':'scaleway:'+sys.argv[2]+':'+sys.argv[1],'type':sys.argv[3],'glm_revision':sys.argv[4],'versions':open(sys.argv[5]).read(),'cost_per_hr':float(open(sys.argv[6]).read()),'code_rev':sys.argv[7]}, open(sys.argv[8],'w'), indent=1)" \
    "$(sid)" "$ZONE" "$TYPE" "$rev" "$LANE_DIR/versions.txt" "$D/cost-per-hr" "$(git -C "$REPO" rev-parse HEAD)" "$LANE_DIR/box.json"
  log "box: $(tr -d '\n' < $LANE_DIR/box.json)"
  on "cd /root/pz; rm -f run.end pulled; nohup bash /root/pz/code/idle-poweroff.sh run -- bash /root/pz/code/kraken-digits-4686-box.sh > box.out 2>&1 < /dev/null & echo launched"
  log "launched on $(wc -l < $LANE_DIR/manifest.tsv) pages"
  pull() { rsync -a --exclude '*.tmp' -e "$SSH" root@"$(ip)":/root/pz/out/ "$LANE_DIR/out/"; rsync -a --include '*.txt' --include '*.log' --exclude '*' -e "$SSH" root@"$(ip)":/root/pz/kr/ "$LANE_DIR/kr/"; true; }
  while :; do
    sleep $POLL
    pull
    n=$(find $LANE_DIR/out -name '*.txt' | wc -l); e=$(find $LANE_DIR/out -name '*.err' | wc -l); k=$(ls $LANE_DIR/kr/*.txt 2>/dev/null | grep -c _)
    log "pulled: glm $n read, $e err; kraken $k; spend \$$(spend); gpu $(on 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader' 2>/dev/null)"
    if on "test -f /root/pz/run.end"; then pull; on "cat /root/pz/glm.out /root/pz/kr/timing.txt; tail -n 3 /root/pz/kr/part.*.log" | tee -a "$LANE_DIR/driver.log"; on "touch /root/pz/pulled"; log "RUN-END"; break; fi
    if over; then log "BUDGET-STOP at \$$(spend) of \$$CAP_USD"; pull; break; fi
    [ "$(state | cut -d' ' -f1)" = running ] || { log "box no longer running ($(state))"; break; }
    [ -f "$LANE_DIR/STOP" ] && { pull; log "STOP file"; break; }
  done ;;
*) echo "usage: LANE_DIR=… $0 run|spend|down"; exit 2 ;;
esac
