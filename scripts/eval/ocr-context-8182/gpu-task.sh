#!/usr/bin/env bash
# timeout: 3h
# issue: 8182
# #8182 ocr-context: Yigdzin (production worker, vLLM) and PaddleOCR-VL-1.6 (print-lane genai server, layout off) read
# the composed N/N2/S/W/B test images, N twice. Files only, no Mongo. Stops every model it starts.
# PRIOR ART: /root/gpu-queue/done/83a-yig-vllm029-parity-r2.sh (#6871: the Yigdzin worker's env and model path, reused)
# and scripts/gpu/paddle-print-gpu.sh (the print lane's genai server start/stop, reused). Neither reads local images
# of both scripts in one task.
set -uo pipefail
B=/root/jobs/ocr-context-8182; O=$B/reads; mkdir -p "$O"; cd "$B"
ts() { date -u +%FT%TZ; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }
echo "$(ts) start, GPU $(gpu_mib) MiB"
# todo rows from the build manifests (ok pages only)
/root/pz/venv/bin/python -I - <<'PY'
import json, os
B = "/root/jobs/ocr-context-8182"; T = open(f"{B}/reads/yig-todo.jsonl", "w"); Z = open(f"{B}/reads/pad-todo.jsonl", "w")
for l in open(f"{B}/todo.jsonl"):
    r = json.loads(l); d = f"{B}/build/{r['stem']}"
    try: m = json.load(open(f"{d}/manifest.json"))
    except Exception: continue
    if m.get("outcome") != "ok": continue
    f = T if r["script"] == "tib" else Z
    for im in ("N", "N2", "S", "W", "B"): f.write(json.dumps({"id": f"{r['stem']}__{im}", "path": f"{d}/{im}.png"}) + "\n")
    f.write(json.dumps({"id": f"{r['stem']}__N__r2", "path": f"{d}/N.png"}) + "\n")
PY
echo "$(ts) todo: yig $(wc -l < $O/yig-todo.jsonl), paddle $(wc -l < $O/pad-todo.jsonl)"

# --- Yigdzin: the production leaf worker, one image = one leaf (path rows) ---
J=/root/jobs/yig-vllm-6871; MODEL=/root/.cache/huggingface/hub/models--BDRC--tibetan-ocr/snapshots/50506eb6d8ed8738df86b448f6f6cdc688de29ea
( export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential HF_HUB_OFFLINE=1 TMPDIR=$J/tmp; unset OMP_NUM_THREADS
  timeout 5400 $J/venv/bin/python $J/harness/yig_leaf_worker.py --todo $O/yig-todo.jsonl --out $O/yig --mode whole \
    --batch 64 --model "$MODEL" --gpu-util 0.6 ) > $O/yig.log 2>&1
echo "$(ts) yig rc=$? txt=$(ls $O/yig/txt 2>/dev/null | wc -l), GPU $(gpu_mib) MiB"
sleep 10

# --- PaddleOCR-VL-1.6: the print lane's server + pipeline, layout off ---
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > $O/serve.log 2>&1 < /dev/null &
for i in $(seq 1 90); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null && break; sleep 5; done
if curl -sf http://127.0.0.1:8118/v1/models >/dev/null; then
  timeout 5400 /root/pz/venv/bin/python -I $B/code/read_paddle.py --todo $O/pad-todo.jsonl --out $O/pad > $O/pad.log 2>&1
  echo "$(ts) paddle rc=$? txt=$(ls $O/pad/*.txt 2>/dev/null | wc -l)"
else echo "$(ts) genai server did not come up"; tail -20 $O/serve.log; fi
pkill -INT -f "[p]addlex_genai_server.*--port 8118"; sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
echo "$(ts) done, GPU $(gpu_mib) MiB"
