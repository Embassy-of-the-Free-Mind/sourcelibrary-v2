#!/bin/bash
# GLM English lane (#5660), the Hetzner-side driver for ONE leased Scaleway GPU: create + lease → vLLM serve
# GLM-OCR → read the manifest → pull (and, with APPLY=1, apply finished books each poll) → delete.
#
# PRIOR ART: scripts/gpu/glm-english-pod.sh (the same driver for a RunPod pod — RunPod refused to rent on
# 2026-10-04: account balance −$0.06) and PR #5607's paddle-zh-gpu.sh (the Scaleway create / lease / ssh /
# delete lifecycle, copied here in the few lines this needs: the GPU OS image, the root-volume size, root
# ssh from the `ubuntu` user's keys, provider-API poweroff + server AND volume delete). The lease is the
# Hetzner gpu-lease-watchdog's (scripts/maintenance/gpu-lease-watchdog.mjs --lease): it stops the box when the
# lease expires and, with PROGRESS=1, when no page with `ocr.source: glm-ocr` was written for 30 min — which
# is why APPLY=1 writes finished books every poll instead of at the end.
#
# MONEY: every machine this lane rented (RunPod or Scaleway) is in $LANE_DIR/{runpod-pods,boxes}/<name>/
# with created-at, cost-per-hr (USD) and ended-at; the driver stops at CAP_USD − MARGIN_USD whatever is left.
#
#   LANE_DIR=/root/glm-english-5660d BOX=g1 LEASE_H=10 CAP_USD=10 [APPLY=1 PROGRESS=1] scripts/gpu/glm-english-scw.sh run
#   ... spend | down
# Env: TYPE (L4-1-24G), ZONE (fr-par-2), EUR_USD (1.17, rounded up), CLIENTS (16), MAX_TOKENS (8192).
set -u
set -a; . /root/sourcelibrary/.env.production.local; . /root/.scaleway.env; set +a
LANE_DIR=${LANE_DIR:-/root/glm-english-5660d}; BOX=${BOX:?BOX=<label>}
TYPE=${TYPE:-L4-1-24G}; ZONE=${ZONE:-fr-par-2}; LEASE_H=${LEASE_H:-6}; ROOT_GB=${ROOT_GB:-80}
CAP_USD=${CAP_USD:-10}; MARGIN_USD=${MARGIN_USD:-0.25}; POLL=${POLL:-120}; EUR_USD=${EUR_USD:-1.17}
CLIENTS=${CLIENTS:-16}; MAX_TOKENS=${MAX_TOKENS:-8192}
PROJECT=${SCW_PROJECT:-873752fd-c333-4f03-87ab-9db2af36a853}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
D=$LANE_DIR/boxes/$BOX; mkdir -p "$D"
NAME=sl-glm-english-5660-$BOX
API=https://api.scaleway.com/instance/v1/zones/$ZONE
H=(-H "X-Auth-Token: $SCALEWAY_SECRET_KEY" -H "Content-Type: application/json")
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=30"
log() { echo "$(date -u +%FT%TZ) [$BOX] $*" | tee -a "$LANE_DIR/driver.log"; }
sid() { cat "$D/server-id"; }
state() { curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("server"); print((s["state"]+" "+((s.get("public_ip") or {}).get("address",""))) if s else "gone -")'; }
ip() { state | awk '{print $2}'; }
on() { $SSH root@"$(ip)" "$@"; }

spend() {  # dollars over every machine of this lane (running ones counted to now)
  python3 - "$LANE_DIR" <<'PY'
import os, sys, time
tot = 0.0
for sub in ('runpod-pods', 'boxes'):
    root = os.path.join(sys.argv[1], sub)
    for p in (os.listdir(root) if os.path.isdir(root) else []):
        d = os.path.join(root, p)
        r = lambda f: open(os.path.join(d, f)).read().strip() if os.path.exists(os.path.join(d, f)) else None
        c, rate = r('created-at'), r('cost-per-hr')
        if not c or not rate or rate == 'None': continue
        end = float(r('terminated-at') or r('ended-at') or time.time())
        tot += (end - float(c)) / 3600 * float(rate)
print(f'{tot:.3f}')
PY
}
over() { python3 -c "import sys; sys.exit(0 if $(spend) >= $CAP_USD - $MARGIN_USD else 1)"; }

delete_box() {
  [ -s "$D/server-id" ] || { echo "no server"; return 0; }
  curl -s -X POST "${H[@]}" "$API/servers/$(sid)/action" -d '{"action":"poweroff"}' >/dev/null
  for i in $(seq 1 40); do s=$(state); [ "${s%% *}" = stopped ] || [ "${s%% *}" = gone ] && break; sleep 15; done
  date -u +%s > "$D/ended-at"
  vols=$(curl -s "${H[@]}" "$API/servers/$(sid)" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("server"); print(" ".join(v["id"] for v in (d or {}).get("volumes",{}).values()))')
  curl -s -X DELETE "${H[@]}" "$API/servers/$(sid)" >/dev/null
  for v in $vols; do for i in $(seq 1 12); do r=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" "https://api.scaleway.com/block/v1alpha1/zones/$ZONE/volumes/$v"); [ "$r" = 204 ] && break; sleep 10; done; log "volume $v delete -> $r"; done
  s=$(state); log "DELETED $(sid) (now: $s); billed ≈ \$$(python3 -c "print(round(($(cat $D/ended-at)-$(cat $D/created-at))/3600*$(cat $D/cost-per-hr),3))")"
  mv "$D/server-id" "$D/server-id.deleted"
}

case ${1:-} in
spend) spend ;;
down) delete_box ;;
run)
  over && { log "BUDGET: \$$(spend) already spent of \$$CAP_USD — not creating a box"; exit 3; }
  if [ ! -s "$D/server-id" ]; then
    IMAGE=$(curl -s "${H[@]}" "https://api.scaleway.com/marketplace/v2/local-images?zone=$ZONE&type=instance_sbs&page_size=100&image_label=ubuntu_noble_gpu_os_12" \
      | TYPE=$TYPE python3 -c 'import json,sys,os; t=os.environ["TYPE"]; L=[i for i in json.load(sys.stdin).get("local_images",[]) if t in i.get("compatible_commercial_types",[])]; print(L[0]["id"] if L else "")')
    [ -n "$IMAGE" ] || { log "no GPU OS image for $TYPE in $ZONE"; exit 1; }
    until=$(date -u -d "+${LEASE_H} hours" +%FT%TZ)
    body=$(printf '{"name":"%s","commercial_type":"%s","image":"%s","project":"%s","dynamic_ip_required":true,"tags":["lease-until=%s","owner=5660"],"volumes":{"0":{"size":%s,"volume_type":"sbs_volume"}}}' "$NAME" "$TYPE" "$IMAGE" "$PROJECT" "$until" "$((ROOT_GB*1000000000))")
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
    prog=(); [ -n "${PROGRESS:-}" ] && prog=(--progress mongo:glm-ocr)
    (cd "$REPO" && node scripts/maintenance/gpu-lease-watchdog.mjs --lease "$(sid)" --zone "$ZONE" --hours "$LEASE_H" --owner 5660 "${prog[@]}") 2>&1 | tail -1 | tee -a "$D/driver.log"
    for i in $(seq 1 90); do $SSH ubuntu@"$(ip)" "sudo bash -c 'cat /home/ubuntu/.ssh/authorized_keys >> /root/.ssh/authorized_keys'" 2>/dev/null && on true 2>/dev/null && break; sleep 10; done
    on true || { log "SSH-FAIL — deleting"; delete_box; exit 1; }
    log "SSH-OK $(ip)"
  fi
  trap 'delete_box; log "RUN-DONE spend \$$(spend)"' EXIT
  if ! on "curl -sf http://127.0.0.1:8200/v1/models >/dev/null"; then
    on 'mkdir -p /root/pz/code /root/pz/out; nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync >/dev/null 2>&1); curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1; U=/root/.local/bin/uv; $U venv -p 3.12 /root/pz/vl > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/vl timeout 1800 $U pip install -U vllm pillow --torch-backend auto > /root/pz/vl-setup.log 2>&1; tail -n 2 /root/pz/vl-setup.log; /root/pz/vl/bin/python -c "import vllm,torch;print(vllm.__version__, torch.__version__, torch.cuda.is_available())"' | tee "$LANE_DIR/vl-versions-$BOX.txt"
    serve() {  # serve <label> <env> <extra args>: 0 when the server answers within the budget
      on "pkill -f '[v]llm serve'; sleep 5; true"   # its own call: a pkill inside the serve line matches that line's own shell
      on "cd /root/pz && ($2 nohup /root/pz/vl/bin/vllm serve zai-org/GLM-OCR --served-model-name m --max-model-len 32768 --gpu-memory-utilization 0.85 --limit-mm-per-prompt '{\"image\":1}' --port 8200 $3 > srv-$1.log 2>&1 < /dev/null &); echo serving $1"
      t1=$(date +%s)
      until on "curl -sf http://127.0.0.1:8200/v1/models >/dev/null"; do
        if [ $(( $(date +%s) - t1 )) -gt 1500 ] || ! on "pgrep -f '[v]llm serve' >/dev/null"; then
          log "SERVE-FAIL $1"; on "grep -v '^(APIServer' /root/pz/srv-$1.log | grep -iE 'error|exception|cuda|out of memory' | head -n 40; echo ...; tail -n 200 /root/pz/srv-$1.log" > "$LANE_DIR/srv-fail-$BOX-$1.log"; return 1; fi
        sleep 20; done
      log "SERVE-UP $1 after $(( $(date +%s) - t1 )) s"
    }
    MTP="--speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":1}'"
    serve mtp "" "$MTP" || serve mtp-nofi "VLLM_USE_FLASHINFER_SAMPLER=0" "$MTP" || serve plain "VLLM_USE_FLASHINFER_SAMPLER=0" "" || exit 1
  fi
  rev=$(on "ls /root/.cache/huggingface/hub/models--zai-org--GLM-OCR/snapshots/ | head -1")
  gpu=$(on "nvidia-smi --query-gpu=name --format=csv,noheader | head -1")
  vv=$(on "/root/pz/vl/bin/python -c 'import vllm;print(vllm.__version__)'")
  python3 -c "import json,sys; json.dump({'pod_id':sys.argv[1],'host':'scaleway:'+sys.argv[9]+':'+sys.argv[1],'gpu':sys.argv[2],'revision':sys.argv[3] or None,'vllm_version':sys.argv[4],'clients':int(sys.argv[5]),'max_tokens':int(sys.argv[6]),'cost_per_hr':float(open(sys.argv[7]).read()),'code_rev':sys.argv[10]}, open(sys.argv[8],'w'))" \
    "$(sid)" "$gpu" "$rev" "$vv" "$CLIENTS" "$MAX_TOKENS" "$D/cost-per-hr" "$LANE_DIR/box.json" "$ZONE" "$(git -C "$REPO" rev-parse HEAD)"
  log "box: $(cat $LANE_DIR/box.json)"
  rsync -a -e "$SSH" "$HERE/glm-english-run.py" "$LANE_DIR/manifest.tsv" root@"$(ip)":/root/pz/code/
  on "cd /root/pz; rm -f run.end; CLIENTS=$CLIENTS nohup bash -c '/root/pz/vl/bin/python code/glm-english-run.py code/manifest.tsv /root/pz/out http://127.0.0.1:8200/v1 m $MAX_TOKENS > run.out 2>&1; echo END > run.end' > /dev/null 2>&1 < /dev/null & echo launched"   # ';' not '&&': with '&&' the whole list is the async job and holds the ssh channel
  log "launched on $(wc -l < $LANE_DIR/manifest.tsv) manifest rows, CLIENTS=$CLIENTS MAX_TOKENS=$MAX_TOKENS"
  pull() { rsync -a --ignore-existing --exclude '*.tmp' --exclude timings.jsonl -e "$SSH" root@"$(ip)":/root/pz/out/ "$LANE_DIR/out/"; rsync -a -e "$SSH" root@"$(ip)":/root/pz/out/timings.jsonl "$LANE_DIR/timings-$BOX.jsonl" 2>/dev/null; true; }
  applyb() { [ -n "${APPLY:-}" ] && (cd "$REPO" && node --env-file=/root/sourcelibrary/.env.production.local scripts/workers/glm-english-lane.mjs apply --apply --dir "$LANE_DIR" 2>&1 | tail -1 | tee -a "$LANE_DIR/driver.log"); true; }
  while :; do
    sleep $POLL
    pull; applyb
    n=$(find $LANE_DIR/out -name '*.txt' | wc -l); e=$(find $LANE_DIR/out -name '*.err' | wc -l)
    log "pulled: $n read, $e err; spend \$$(spend); gpu $(on 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader')"
    if on "test -f /root/pz/run.end"; then pull; applyb; log "RUN-END $(on 'tail -1 /root/pz/run.out')"; break; fi
    if over; then on "pkill -f glm-english-run.py"; sleep 5; pull; applyb; log "BUDGET-STOP at \$$(spend) of \$$CAP_USD"; break; fi
    [ -f "$LANE_DIR/STOP" ] && { on "pkill -f glm-english-run.py"; sleep 5; pull; applyb; log "STOP file"; break; }
  done ;;
*) echo "usage: LANE_DIR=… BOX=<label> $0 run|spend|down"; exit 2 ;;
esac
