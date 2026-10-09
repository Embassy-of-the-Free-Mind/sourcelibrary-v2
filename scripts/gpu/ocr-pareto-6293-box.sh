#!/usr/bin/env bash
# ocr-pareto-6293-box.sh — the GPU half of #6293 Part B, ON a rented Scaleway GPU: PaddleOCR-VL 1.6 and olmOCR 2 7B
# on the chart pages they have not read (PREREGISTRATION-ocr-pareto-6293.md), each with the #5660 recipe unchanged.
#
# PRIOR ART: /root/olmocr-5660b/run.sh (#5660 Amendment 1, RunPod): the olmOCR serve + olm-run.py drive, copied here
# step for step; the Paddle arm is `paddle-zh-box.sh arm` with BACKEND=server CLIENTS=8 LAYOUT=1, as #5660's Paddle arm
# ran it (rev eec7802). Both scripts and olm-run.py are pushed from /root/olmocr-5660b/code by the driver, untouched;
# what differs is the host (a Scaleway L4, so VLLM_USE_FLASHINFER_SAMPLER=0) and the manifests (this run's gaps).
#
#   ocr-pareto-6293-box.sh all     setup (Paddle venv + genai server venv) → Paddle arm → olmOCR warm-up + arm → DONE
# Under idle-poweroff.sh:  idle-poweroff.sh run -- bash -c 'ocr-pareto-6293-box.sh all; <wait for pull>'
set -uo pipefail
W=/root/pz
C=$W/code
export PV_WORK=$W VLLM_USE_FLASHINFER_SAMPLER=0
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/box.log"; }

paddle() {
  SERVER=1 BACKEND=server bash "$C/paddle-zh-box.sh" setup || { log "paddle setup FAILED"; return 1; }
  BACKEND=server CLIENTS=8 LAYOUT=1 PAGE_TIMEOUT=300 bash "$C/paddle-zh-box.sh" arm paddle "$W/bench/paddle.tsv" || log "paddle arm non-zero"
  bash "$C/paddle-zh-box.sh" collect || true
  # free the GPU for olmOCR: stop the genai server by PID (never pkill -f: it matches this shell)
  for p in $(pgrep -x paddlex_genai_s 2>/dev/null) $(ps -eo pid,args | awk '/[p]addlex_genai_server/{print $1}'); do kill "$p" 2>/dev/null; done
  sleep 20
  log "paddle arm done: $(find $W/arms/paddle/out -name '*.txt' | wc -l) txt, $(find $W/arms/paddle/out -name '*.err' | wc -l) err; $(cat $W/arms/paddle/arm-run.json 2>/dev/null | head -c 400)"
}

olmocr() {
  (cd $W && PATH=$W/srv/bin:$PATH HF_HUB_ENABLE_HF_TRANSFER=0 nohup $W/srv/bin/vllm serve allenai/olmOCR-2-7B-1025-FP8 --served-model-name olmocr \
     --max-model-len 12000 --gpu-memory-utilization 0.90 --limit-mm-per-prompt '{"image":1}' --port 8200 > olm-server.log 2>&1 < /dev/null &)
  local t1; t1=$(date +%s)
  until curl -sf http://127.0.0.1:8200/v1/models >/dev/null; do
    [ $(( $(date +%s) - t1 )) -gt 1200 ] && { log "OLM-NOT-UP after 20 min"; tail -n 30 $W/olm-server.log | tee -a $W/box.log; return 1; }; sleep 15; done
  log "OLM-UP after $(( $(date +%s) - t1 )) s"
  ls /root/.cache/huggingface/hub/models--allenai--olmOCR-2-7B-1025-FP8/snapshots/ > $W/olm-revision.txt 2>&1
  for arm in olm-warm:warm olmocr:olmocr; do
    local name=${arm%%:*} man=${arm##*:}
    mkdir -p $W/arms/$name
    $W/srv/bin/python $C/olm-run.py $W/bench/$man.tsv $W/arms/$name http://127.0.0.1:8200/v1 olmocr >> $W/olm-drive-$name.log 2>&1
    log "olmOCR arm $name: $(cat $W/arms/$name/arm-run.json 2>/dev/null)"
  done
}

versions() {
  { echo "gpu: $(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader)"
    $W/venv/bin/pip freeze 2>/dev/null | grep -iE '^(paddlepaddle-gpu|paddleocr|paddlex)==' | sed 's/^/venv: /'
    $W/srv/bin/pip freeze 2>/dev/null | grep -iE '^(vllm|transformers|torch|flash.attn|paddleocr|paddlex)==' | sed 's/^/srv: /'
    sha256sum $C/* ; } > $W/versions.txt 2>&1
}

case ${1:-} in
  all) mkdir -p $W/arms; log "start"; paddle; olmocr; versions; touch $W/DONE; log DONE ;;
  *) echo "usage: $0 all"; exit 2 ;;
esac
