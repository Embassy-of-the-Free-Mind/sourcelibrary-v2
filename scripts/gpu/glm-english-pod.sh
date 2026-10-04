#!/bin/bash
# GLM English lane (#5660), the Hetzner-side driver for ONE RunPod pod: create → vLLM serve GLM-OCR → read the
# manifest → pull → terminate. The Mongo half (plan / apply) is scripts/workers/glm-english-lane.mjs.
#
# PRIOR ART: the #5660 round-3 bake-off driver (run.sh in the job dir of PR #5786) — same pod, same vLLM
# serve line for GLM-OCR (MTP speculative decoding, VLLM_USE_FLASHINFER_SAMPLER=0 on Blackwell), and the
# same pod lifecycle script (paddle-zh-runpod.sh of PR #5607: create / ssh / terminate, deadline in the pod
# NAME `sl-5600-<label>-until-<UTC>`, so the Hetzner runpod-pod-watchdog covers it). What is new here is a
# MONEY stop: the driver adds up every pod this lane has rented (created → terminated, × $/h) and stops at
# CAP_USD whatever is left, and it pulls outputs every POLL seconds so a kill loses at most one poll.
#
#   LANE_DIR=/root/glm-english-5660d POD=g1 MINUTES=600 CAP_USD=10 scripts/gpu/glm-english-pod.sh run
#   ... spend          — dollars so far, all pods of this lane
#   ... down           — terminate (also the EXIT trap of `run`)
# Env: RUNPOD_SH (the lifecycle script), GPU, CLOUD (SECURE), CLIENTS (16), MAX_TOKENS (8192).
set -u
set -a; . /root/sourcelibrary/.env.production.local; set +a
export LANE_DIR=${LANE_DIR:-/root/glm-english-5660d} POD=${POD:?POD=<label>} MINUTES=${MINUTES:-600}
CAP_USD=${CAP_USD:-10}; MARGIN_USD=${MARGIN_USD:-0.25}; POLL=${POLL:-120}
CLIENTS=${CLIENTS:-16}; MAX_TOKENS=${MAX_TOKENS:-8192}
S=${RUNPOD_SH:-/root/ocr-bakeoff-5660c/lane/code/paddle-zh-runpod.sh}
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "$(date -u +%FT%TZ) [$POD] $*" | tee -a "$LANE_DIR/driver.log"; }

spend() {  # dollars, every pod this lane has rented (running pods counted to now)
  python3 - "$LANE_DIR/runpod-pods" <<'PY'
import os, sys, time
root = sys.argv[1]; tot = 0.0
for p in (os.listdir(root) if os.path.isdir(root) else []):
    d = os.path.join(root, p); r = lambda f: open(os.path.join(d, f)).read().strip() if os.path.exists(os.path.join(d, f)) else None
    if not r('created-at') or not r('cost-per-hr') or r('cost-per-hr') == 'None': continue
    end = float(r('terminated-at') or time.time())
    tot += (end - float(r('created-at'))) / 3600 * float(r('cost-per-hr'))
print(f'{tot:.3f}')
PY
}
over() { python3 -c "import sys; sys.exit(0 if $(spend) >= $CAP_USD - $MARGIN_USD else 1)"; }

case ${1:-} in
spend) spend ;;
down) bash $S terminate ;;
run)
  over && { log "BUDGET: \$$(spend) already spent of \$$CAP_USD — not creating a pod"; exit 3; }
  D=$LANE_DIR/runpod-pods/$POD
  if [ ! -s "$D/pod-id" ]; then
    GPU=${GPU:-"NVIDIA RTX PRO 4000 Blackwell"} CLOUD=${CLOUD:-SECURE} MIN_VCPU=8 bash $S create \
      || { GPU="NVIDIA L4" CLOUD=SECURE MIN_VCPU=8 bash $S create; } || { log "NO-GPU"; exit 1; }
  fi
  PODID=$(cat $D/pod-id); WD=/root/paddle-zh-5600/runpod/$PODID; mkdir -p $WD
  trap 'bash $S terminate; log "RUN-DONE spend \$$(spend)"' EXIT
  if ! bash $S ssh "curl -sf http://127.0.0.1:8200/v1/models >/dev/null" < /dev/null; then
    bash $S ssh 'mkdir -p /root/pz/code /root/pz/out && (command -v rsync >/dev/null || (apt-get -qq update && apt-get -qq install -y rsync >/dev/null 2>&1)); curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1; U=/root/.local/bin/uv; $U venv -p 3.12 /root/pz/vl > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/vl timeout 1800 $U pip install -U vllm pillow --torch-backend auto > /root/pz/vl-setup.log 2>&1; /root/pz/vl/bin/python -c "import vllm,torch;print(vllm.__version__, torch.__version__, torch.cuda.is_available())"' < /dev/null | tee $LANE_DIR/vl-versions.txt
    bash $S ssh "cd /root/pz && (VLLM_USE_FLASHINFER_SAMPLER=0 nohup /root/pz/vl/bin/vllm serve zai-org/GLM-OCR --served-model-name m --max-model-len 32768 --gpu-memory-utilization 0.85 --limit-mm-per-prompt '{\"image\":1}' --port 8200 --speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":1}' > srv.log 2>&1 < /dev/null &); echo serving" < /dev/null
    t1=$(date +%s)
    until bash $S ssh "curl -sf http://127.0.0.1:8200/v1/models >/dev/null" < /dev/null; do
      [ $(( $(date +%s) - t1 )) -gt 1500 ] && { log "SERVE-FAIL"; bash $S ssh "tail -n 30 /root/pz/srv.log" < /dev/null | tee $LANE_DIR/srv-fail.log; exit 1; }
      touch $WD/progress; sleep 20; done
    log "SERVE-UP after $(( $(date +%s) - t1 )) s"
  fi
  rev=$(bash $S ssh "ls /root/.cache/huggingface/hub/models--zai-org--GLM-OCR/snapshots/ | head -1" < /dev/null)
  gpu=$(bash $S ssh "nvidia-smi --query-gpu=name --format=csv,noheader | head -1" < /dev/null)
  vv=$(bash $S ssh "/root/pz/vl/bin/python -c 'import vllm;print(vllm.__version__)'" < /dev/null)
  python3 -c "import json,sys; json.dump({'pod_id':sys.argv[1],'host':'runpod:'+sys.argv[1],'gpu':sys.argv[2],'revision':sys.argv[3] or None,'vllm_version':sys.argv[4],'clients':int(sys.argv[5]),'max_tokens':int(sys.argv[6]),'cost_per_hr':float(open(sys.argv[7]).read())}, open(sys.argv[8],'w'))" \
    "$PODID" "$gpu" "$rev" "$vv" "$CLIENTS" "$MAX_TOKENS" "$D/cost-per-hr" "$LANE_DIR/box.json"
  log "box: $(cat $LANE_DIR/box.json)"
  # the pod reads the manifest as it is NOW; re-run `run` after planning more books (the server stays up)
  bash $S ssh "mkdir -p /root/pz/code" < /dev/null
  ADDR=$(curl -s -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$PODID" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["publicIp"], d["portMappings"]["22"])')
  set -- $ADDR; IP=$1; PORT=$2
  SSHO="-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
  rsync -a -e "ssh $SSHO -p $PORT" "$HERE/glm-english-run.py" "$LANE_DIR/manifest.tsv" root@$IP:/root/pz/code/
  bash $S ssh "cd /root/pz && rm -f run.end && CLIENTS=$CLIENTS nohup bash -c '/root/pz/vl/bin/python code/glm-english-run.py code/manifest.tsv /root/pz/out http://127.0.0.1:8200/v1 m $MAX_TOKENS > run.out 2>&1; echo END > run.end' > /dev/null 2>&1 < /dev/null & echo launched" < /dev/null
  log "launched on $(wc -l < $LANE_DIR/manifest.tsv) manifest rows, CLIENTS=$CLIENTS MAX_TOKENS=$MAX_TOKENS"
  pull() { rsync -a --ignore-existing -e "ssh $SSHO -p $PORT" --exclude '*.tmp' root@$IP:/root/pz/out/ "$LANE_DIR/out/" && rsync -a -e "ssh $SSHO -p $PORT" root@$IP:/root/pz/out/timings.jsonl "$LANE_DIR/timings-$PODID.jsonl" 2>/dev/null; touch $WD/progress; }
  while :; do
    sleep $POLL
    pull
    n=$(find $LANE_DIR/out -name '*.txt' | wc -l); e=$(find $LANE_DIR/out -name '*.err' | wc -l)
    log "pulled: $n read, $e err; spend \$$(spend); gpu $(bash $S ssh 'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader' < /dev/null)"
    if bash $S ssh "test -f /root/pz/run.end" < /dev/null; then pull; log "RUN-END $(bash $S ssh 'cat /root/pz/run.out | tail -1' < /dev/null)"; break; fi
    if over; then bash $S ssh "pkill -f glm-english-run.py" < /dev/null; sleep 5; pull; log "BUDGET-STOP at \$$(spend) of \$$CAP_USD"; break; fi
    [ -f "$LANE_DIR/STOP" ] && { bash $S ssh "pkill -f glm-english-run.py" < /dev/null; sleep 5; pull; log "STOP file"; break; }
  done
  ;;
*) echo "usage: LANE_DIR=… POD=<label> $0 run|spend|down"; exit 2 ;;
esac
