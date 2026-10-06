#!/bin/bash
# #5924 (round 4 of #5660): GLM-OCR + Kraken/Calamari on one RunPod SECURE RTX PRO 4000 Blackwell (L4 fallback),
# prereg Amendment 3. The round-3 driver (../ocr-bakeoff-r3-5660/run.sh) cut down to the two arms, plus throughput.
#   1. GLM-OCR (the round-3 config: vLLM, MTP speculative decoding, "Text Recognition:", 4,500 tokens, 8 clients)
#      on acc.tsv (accuracy + population runs); meanwhile the CPU track binarizes, segments and runs Calamari on them.
#   2. Throughput, GPU alone: GLM on sweep.tsv at CLIENTS 4, 8, 16, 32, 64, GPU utilisation sampled every second.
#   3. End-to-end on whole books (tp.tsv): GLM at the plateau concurrency AND the CPU track on the same pages at once.
# The pod's deadline is in its name (MINUTES); the Hetzner RunPod watchdog sees GPU use and the heartbeat below.
# The EXIT trap terminates the pod and confirms it gone. VLLM_USE_FLASHINFER_SAMPLER=0 (round 3: SM 12.x JIT).
set -u
set -a; . /root/sourcelibrary/.env.production.local; set +a
export LANE_DIR=${LANE_DIR:-/root/latin-r4-5924/lane} POD=${POD:-r4} MINUTES=${MINUTES:-300}
S=$LANE_DIR/code/paddle-zh-runpod.sh
log() { echo "$(date -u +%FT%TZ) $*"; }
if [ -z "${RESUME:-}" ]; then
MIN_VCPU=16 GPU="NVIDIA RTX PRO 4000 Blackwell" CLOUD=SECURE bash $S create \
  || MIN_VCPU=8 GPU="NVIDIA RTX PRO 4000 Blackwell" CLOUD=SECURE bash $S create \
  || { export POD=r4l4; MIN_VCPU=8 GPU="NVIDIA L4" CLOUD=SECURE bash $S create; } || { echo NO-GPU; exit 1; }
fi
PODID=$(cat $LANE_DIR/runpod-pods/$POD/pod-id); WD=/root/paddle-zh-5600/runpod/$PODID; mkdir -p $WD
( while kill -0 $$ 2>/dev/null; do touch $WD/progress; sleep 120; done ) &
trap 'bash $S terminate; echo RUN-DONE' EXIT
P() { bash $S ssh "$@" < /dev/null; }
if [ -z "${RESUME:-}" ]; then
  bash $S push
  P "nproc; free -g | head -2; nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader; lscpu | grep -E 'Model name|^CPU\(s\)'" | tee $LANE_DIR/pod-info.txt
  P "nohup bash /root/pz/code/cpu-r4.sh install > /dev/null 2>&1 < /dev/null & echo cpu-install-started"
  t0=$(date +%s)
  P 'curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1; U=/root/.local/bin/uv; $U venv -p 3.12 /root/pz/vl > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/vl timeout 1800 $U pip install -U vllm --torch-backend auto > /root/pz/vl-setup.log 2>&1; tail -n 2 /root/pz/vl-setup.log; /root/pz/vl/bin/python -c "import vllm,torch,transformers;print(\"vllm\",vllm.__version__,\"torch\",torch.__version__,\"transformers\",transformers.__version__,\"cuda\",torch.cuda.is_available())"' | tee $LANE_DIR/vl-versions.txt
  log "VL-SETUP-DONE after $(( $(date +%s) - t0 )) s"
fi
serve() {
  P "pkill -f '[v]llm serve'; sleep 8; true"
  P "cd /root/pz && (VLLM_USE_FLASHINFER_SAMPLER=0 nohup /root/pz/vl/bin/vllm serve zai-org/GLM-OCR --served-model-name m --max-model-len 32768 --gpu-memory-utilization 0.85 --limit-mm-per-prompt '{\"image\":1}' --port 8200 $* > srv-glm.log 2>&1 < /dev/null &); echo serving"
  local t1=$(date +%s)
  until P "curl -sf http://127.0.0.1:8200/v1/models >/dev/null"; do
    if [ $(( $(date +%s) - t1 )) -gt 1500 ] || P "! pgrep -f '[v]llm serve' >/dev/null"; then log "SERVE-FAIL after $(( $(date +%s) - t1 )) s"; P "tail -n 25 /root/pz/srv-glm.log" | tee $LANE_DIR/srv-fail.log; return 1; fi
    sleep 20; done
  log "SERVE-UP ($*) after $(( $(date +%s) - t1 )) s"
  P "ls /root/.cache/huggingface/hub/models--zai-org--GLM-OCR/snapshots/" > $LANE_DIR/snapshot-glm.txt
}
glm() {  # glm <arm name> <manifest> <clients>: one client pass, GPU utilisation sampled each second
  local arm=$1 man=$2 c=$3
  P "mkdir -p /root/pz/arms/$arm && cd /root/pz && (nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits -lms 1000 > /root/pz/arms/$arm/gpu-util.csv 2>&1 &) && CLIENTS=$c A=/root/pz/arms/$arm nohup bash -c '/root/pz/vl/bin/python /root/pz/code/vlm-run.py /root/pz/bench/$man /root/pz/arms/$arm http://127.0.0.1:8200/v1 m glm 4500; pkill -f \"[n]vidia-smi --query-gpu=utilization\"; echo ARM-END' > /root/pz/drive-$arm.log 2>&1 < /dev/null &"
  until P "grep -q ARM-END /root/pz/drive-$arm.log"; do
    P "ls /root/pz/arms/$arm/out/_bench 2>/dev/null | grep -c txt; tail -n1 /root/pz/arms/$arm/gpu-util.csv; tail -n1 /root/pz/cpu/cpu.log" | tr '\n' ' ' | sed "s/^/$(date -u +%FT%TZ) [$arm c=$c] n,gpu | cpu: /"; echo
    sleep 60; done
  bash $S pull $arm < /dev/null
  log "ARM-DONE $arm: $(cat $LANE_DIR/bench/arms/$arm/arm-run.json 2>/dev/null)"
}
cpu_wait() {  # cpu_wait <marker>
  until P "grep -q '$1' /root/pz/cpu/cpu.log"; do P "tail -n1 /root/pz/cpu/cpu.log" | sed "s/^/$(date -u +%FT%TZ) [cpu] /"; sleep 60; done
}
want() { [ -z "${STEPS:-}" ] || [[ " $STEPS " == *" $1 "* ]]; }
serve "--speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":1}'" || serve || { log "NOT-RUN glm-ocr"; exit 1; }
if want acc; then
  cpu_wait INSTALL-END
  P "nohup bash /root/pz/code/cpu-r4.sh run /root/pz/bench/acc.tsv acc \$(nproc) > /dev/null 2>&1 < /dev/null & echo cpu-acc-started"
  glm glm-warm tput.tsv 8
  glm glm-ocr acc.tsv 8
  cpu_wait "RUN-END acc"
  bash $S pull calamari-acc < /dev/null
fi
if want sweep; then
  for c in 4 8 16 32 64; do glm glm-sweep-c$c sweep.tsv $c; done
  # plateau = the smallest concurrency whose pages/s is ≥ 95 % of the best (prereg Amendment 3)
  python3 - $LANE_DIR/bench/arms > $LANE_DIR/code/e2e-clients <<'PY'
import json, sys, os
r = {c: json.load(open(os.path.join(sys.argv[1], f'glm-sweep-c{c}', 'arm-run.json'))) for c in (4, 8, 16, 32, 64) if os.path.exists(os.path.join(sys.argv[1], f'glm-sweep-c{c}', 'arm-run.json'))}
pps = {c: v['pages'] / v['wall_secs'] for c, v in r.items()}
best = max(pps.values()); print(min(c for c, v in pps.items() if v >= 0.95 * best))
PY
  log "plateau concurrency: $(cat $LANE_DIR/code/e2e-clients)"
fi
if want e2e; then
  C=$(cat $LANE_DIR/code/e2e-clients 2>/dev/null || echo 16)
  P "nohup bash /root/pz/code/cpu-r4.sh run /root/pz/bench/tp.tsv tp \$(nproc) > /dev/null 2>&1 < /dev/null & echo cpu-tp-started"
  glm glm-e2e tp.tsv $C
  cpu_wait "RUN-END tp"
  bash $S pull calamari-tp < /dev/null
fi
P "/root/pz/vl/bin/pip freeze 2>/dev/null | grep -iE '^(vllm|torch|transformers)'; VIRTUAL_ENV=/root/pz/vl /root/.local/bin/uv pip freeze 2>/dev/null | grep -iE '^(vllm|torch|transformers)'; cat /root/pz/cpu/cpu.log" > $LANE_DIR/freeze-and-cpu-log.txt
log "ALL-DONE"
