#!/bin/bash
# #5660 round 3 (job ocr-bakeoff-5660c): four open OCR VLMs on one RunPod SECURE GPU, one after another, over the same
# 657 JPEGs (the 632 of rounds 1-2 + 25 EEBO-TCP Latin pages, prereg Amendment 2); Kraken + Calamari on the pod's CPUs.
# FlashInfer's JIT sampler needs a CUDA >= 12.9 toolkit for SM 12.x and the image has 12.8: VLLM_USE_FLASHINFER_SAMPLER=0.
# Each arm: install/serve budget 30 min, else "not run". Warm-up on tput.tsv (16 pages, discarded), then acc.tsv.
# The pod's deadline is in its name (MINUTES); the Hetzner watchdog also sees GPU utilisation and, while this
# driver is alive, a heartbeat file in its progress dir. The EXIT trap terminates the pod and confirms it gone.
set -u
set -a; . /root/sourcelibrary/.env.production.local; set +a
export LANE_DIR=/root/ocr-bakeoff-5660c/lane POD=${POD:-r3} MINUTES=${MINUTES:-360}
S=$LANE_DIR/code/paddle-zh-runpod.sh
log() { echo "$(date -u +%FT%TZ) $*"; }
if [ -z "${RESUME:-}" ]; then
MIN_VCPU=16 GPU="NVIDIA RTX PRO 4000 Blackwell" CLOUD=SECURE bash $S create \
  || MIN_VCPU=8 GPU="NVIDIA RTX PRO 4000 Blackwell" CLOUD=SECURE bash $S create \
  || { export POD=r3l4; MIN_VCPU=8 GPU="NVIDIA L4" CLOUD=SECURE bash $S create; } || { echo NO-GPU; exit 1; }
fi
PODID=$(cat $LANE_DIR/runpod-pods/$POD/pod-id); WD=/root/paddle-zh-5600/runpod/$PODID; mkdir -p $WD
( while kill -0 $$ 2>/dev/null; do touch $WD/progress; sleep 120; done ) &
trap 'bash $S terminate; echo RUN-DONE' EXIT
if [ -z "${RESUME:-}" ]; then
bash $S push
bash $S ssh "nproc; free -g | head -2; nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader" < /dev/null | tee $LANE_DIR/pod-info.txt
[ -n "${NOCPU:-}" ] || bash $S ssh "nohup bash /root/pz/code/cpu-arms.sh > /root/pz/cpu-arms.out 2>&1 < /dev/null & echo cpu-track-started" < /dev/null

t0=$(date +%s)
bash $S ssh 'curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1; U=/root/.local/bin/uv; $U venv -p 3.12 /root/pz/vl > /dev/null 2>&1 && VIRTUAL_ENV=/root/pz/vl timeout 1800 $U pip install -U vllm mineru-vl-utils --torch-backend auto > /root/pz/vl-setup.log 2>&1; tail -n 2 /root/pz/vl-setup.log; /root/pz/vl/bin/python -c "import vllm,torch,transformers,mineru_vl_utils as m;print(\"vllm\",vllm.__version__,\"torch\",torch.__version__,\"transformers\",transformers.__version__,\"mineru-vl-utils\",getattr(m,\"__version__\",\"?\"),\"cuda\",torch.cuda.is_available())"' < /dev/null | tee $LANE_DIR/vl-versions.txt
log "VL-SETUP-DONE after $(( $(date +%s) - t0 )) s"

fi
serve() {  # serve <arm> <hf model> <extra vllm args...>: 0 if up within the budget
  local arm=$1 model=$2; shift 2
  bash $S ssh "pkill -f '[v]llm serve'; sleep 8; true" < /dev/null
  bash $S ssh "cd /root/pz && (VLLM_USE_FLASHINFER_SAMPLER=0 nohup /root/pz/vl/bin/vllm serve $model --served-model-name m --max-model-len ${MAXLEN:-32768} --gpu-memory-utilization 0.85 --limit-mm-per-prompt '{\"image\":1}' --port 8200 $* > srv-$arm.log 2>&1 < /dev/null &); echo serving $arm" < /dev/null
  local t1=$(date +%s)
  until bash $S ssh "curl -sf http://127.0.0.1:8200/v1/models >/dev/null" < /dev/null; do
    if [ $(( $(date +%s) - t1 )) -gt ${SERVE_BUDGET:-1500} ] || bash $S ssh "! pgrep -f '[v]llm serve' >/dev/null" < /dev/null; then
      log "SERVE-FAIL $arm after $(( $(date +%s) - t1 )) s"; bash $S ssh "tail -n 25 /root/pz/srv-$arm.log" < /dev/null | tee $LANE_DIR/srv-fail-$arm.log; return 1; fi
    sleep 20; done
  log "SERVE-UP $arm ($model $*) after $(( $(date +%s) - t1 )) s"
  bash $S ssh "ls /root/.cache/huggingface/hub/models--$(echo $model | sed 's#/#--#')/snapshots/" < /dev/null > $LANE_DIR/snapshot-$arm.txt
}
drive() {  # drive <arm> <manifest> <client command, run on the pod with the arm dir as $A>
  local arm=$1 man=$2; shift 2
  bash $S ssh "mkdir -p /root/pz/arms/$arm && cd /root/pz && A=/root/pz/arms/$arm nohup bash -c '$* ; echo ARM-END' > /root/pz/drive-$arm.log 2>&1 < /dev/null &" < /dev/null
  until bash $S ssh "grep -q ARM-END /root/pz/drive-$arm.log" < /dev/null; do
    bash $S ssh "nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader; ls /root/pz/arms/$arm/out/_bench 2>/dev/null | grep -c txt; tail -n1 /root/pz/cpu/cpu.log 2>/dev/null; ls /root/pz/cpu/alto 2>/dev/null | wc -l" < /dev/null | tr '\n' ' ' | sed "s/^/$(date -u +%FT%TZ) [$arm] gpu,mem,n | cpu: /"; echo
    sleep 60; done
  bash $S pull $arm < /dev/null
  log "ARM-DONE $arm: $(cat $LANE_DIR/bench/arms/$arm/arm-run.json 2>/dev/null)"
}
arm() {  # arm <arm> <client: vlm|mineru> <mode> <max_tokens>
  local a=$1 client=$2 mode=$3 mt=$4
  local cmd_t cmd_a
  if [ $client = vlm ]; then
    cmd_t="/root/pz/vl/bin/python /root/pz/code/vlm-run.py /root/pz/bench/tput.tsv \$A http://127.0.0.1:8200/v1 m $mode $mt"
    cmd_a=$cmd_t; cmd_a=${cmd_a/tput.tsv/acc.tsv}
  else
    cmd_t="/root/pz/vl/bin/python /root/pz/code/mineru-run.py /root/pz/bench/tput.tsv \$A http://127.0.0.1:8200"
    cmd_a=${cmd_t/tput.tsv/acc.tsv}
  fi
  drive $a-warm tput "$cmd_t"
  drive $a acc "$cmd_a"
}

want() { [ -z "${ARMS:-}" ] || [[ " $ARMS " == *" $1 "* ]]; }   # ARMS="a b": resume with only these arms
if want glm-ocr && { serve glm-ocr zai-org/GLM-OCR "--speculative-config '{\"method\":\"mtp\",\"num_speculative_tokens\":1}'" || serve glm-ocr zai-org/GLM-OCR; }; then
  arm glm-ocr vlm glm 4500; elif want glm-ocr; then log "NOT-RUN glm-ocr"; fi
if want dots-ocr && serve dots-ocr dots-studio/dots.ocr --trust-remote-code; then arm dots-ocr vlm dots 8000; elif want dots-ocr; then log "NOT-RUN dots-ocr"; fi
if want nanonets-ocr2 && serve nanonets-ocr2 nanonets/Nanonets-OCR2-3B; then arm nanonets-ocr2 vlm nanonets 4500; elif want nanonets-ocr2; then log "NOT-RUN nanonets-ocr2"; fi
if want mineru25-pro && { serve mineru25-pro opendatalab/MinerU2.5-Pro-2605-1.2B --logits-processors mineru_vl_utils:MinerULogitsProcessor || serve mineru25-pro opendatalab/MinerU2.5-Pro-2605-1.2B; }; then
  arm mineru25-pro mineru - 0; elif want mineru25-pro; then log "NOT-RUN mineru25-pro"; fi
bash $S ssh "pkill -f '[v]llm serve'; /root/pz/vl/bin/pip freeze 2>/dev/null | grep -iE '^(vllm|torch|transformers|mineru)' ; VIRTUAL_ENV=/root/pz/vl /root/.local/bin/uv pip freeze 2>/dev/null | grep -iE '^(vllm|torch|transformers|mineru)'" < /dev/null > $LANE_DIR/vl-freeze.txt

log "GPU-ARMS-DONE; waiting for the CPU track"
t2=$(date +%s)
until [ -n "${NOCPU:-}" ] || bash $S ssh "grep -q CPU-END /root/pz/cpu/cpu.log" < /dev/null; do
  [ $(( $(date +%s) - t2 )) -gt 5400 ] && { log "CPU track not done after 90 min more — pulling what exists"; break; }
  bash $S ssh "tail -n1 /root/pz/cpu/cpu.log; ls /root/pz/cpu/alto | wc -l" < /dev/null | tr '\n' ' '; echo; sleep 60; done
bash $S ssh "cat /root/pz/cpu/cpu.log" < /dev/null > $LANE_DIR/cpu.log
bash $S pull kraken-catmus < /dev/null; bash $S pull calamari-gt4histocr < /dev/null
log "ALL-DONE"
