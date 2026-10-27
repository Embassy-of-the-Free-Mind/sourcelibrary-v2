#!/usr/bin/env bash
# timeout: 24h
# issue: 7546
# PRIOR ART: scripts/gpu/paddle-print-gpu.sh (#6101 — the gex45 gpu-queue task for the split-leaf PRINT lane: genai
# vLLM server started first and stopped by its own pid, N runner clients, a worker that exits 3 restarted, run.json
# provenance; copied) and scripts/gpu/paddle-zh-box.sh (#5600 — the same runner on a leased Scaleway L4, layout on,
# BACKEND=server). Neither fits: the print task reads split leaves (the SKQS manuscript lane reads whole pages and its
# 版心 conversions live in scripts/lib/paddle-zh-lane.mjs), and paddle-zh-box.sh needs a rented box and the fleet.
#
# The #5600 Siku Quanshu Paddle lane as ONE gex45 gpu-queue task, for a later cohort that names its own issue and hold
# (#7546: the Four Histories). Mongo half before and after is scripts/workers/paddle-zh-lane.mjs, run from CODE_DIR:
#   1. (once, CPU)  PADDLE_ZH_ISSUE=7546 PADDLE_ZH_HOLD=zh-histories-7546 LANE_DIR=$J \
#                   node --env-file=… scripts/workers/paddle-zh-lane.mjs plan --books ids.txt --apply
#   2. (this task)  manifest from plan/*.json (pages with no out/<bid>/<pn>.txt yet), read, stop the server, then
#                   `paddle-zh-lane.mjs apply --apply` (every guard, Kanripo WYG screen, revisions, hold KEPT).
#   cp scripts/gpu/paddle-zh-queue-task.sh /tmp/x.sh && /root/bin/gpu-queue.sh add /tmp/x.sh 70-zh-histories-7546-a
# Each run stops reading after DEADLINE_H (default 20) so the card is freed inside the timeout; queue -b, -c … until
# `paddle-zh-lane.mjs status` shows nothing left. The env file below must exist on gex45; nothing is paid, no Gemini.
set -uo pipefail
J=${LANE_DIR:-/root/jobs/zh-histories-7546}
CODE_DIR=${CODE_DIR:-/root/sourcelibrary}
ENV_FILE=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
export PADDLE_ZH_ISSUE=${PADDLE_ZH_ISSUE:-7546} PADDLE_ZH_HOLD=${PADDLE_ZH_HOLD:-zh-histories-7546} LANE_DIR=$J
[ -n "${PADDLE_ZH_HOLD_RELEASE:-}" ] && export PADDLE_ZH_HOLD_RELEASE
NAME=${GPU_TASK_NAME:-$(basename "$PWD")}
W=${CLIENTS:-6}
DEADLINE=$(( $(date +%s) + ${DEADLINE_H:-20} * 3600 ))
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] || return 0
  pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; SP=
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
[ -d "$J/plan" ] || { echo "no plan dir at $J/plan (run paddle-zh-lane.mjs plan --apply first)"; exit 1; }
RUNNER=$CODE_DIR/scripts/gpu/paddle-zh-run.py
[ -f "$RUNNER" ] || { echo "no runner at $RUNNER"; exit 1; }
mkdir -p "$J/runs" "$J/gpu/$NAME" "$J/out"

# the manifest: every planned page with no reading back yet (out/<bid>/<pn>.txt is the checkpoint; .err is retried
# by the next chunk only after it is moved aside by hand)
python3 - "$J" > "$J/gpu/$NAME/manifest.tsv" <<'PY'
import json, os, sys, glob
J = sys.argv[1]
# $J/priority.txt (book ids, optional) is read first, so a run cut short still covers the chapters asked for first
pri = [l.strip() for l in open(f'{J}/priority.txt')] if os.path.exists(f'{J}/priority.txt') else []
rank = {b: i for i, b in enumerate(pri)}
for f in sorted(glob.glob(f'{J}/plan/*.json'), key=lambda f: (rank.get(os.path.basename(f)[:-5], len(rank)), f)):
    p = json.load(open(f)); bid = p['bid']
    for r in p['pages']:
        if not os.path.exists(f"{J}/out/{bid}/{r['pn']}.txt") and not os.path.exists(f"{J}/out/{bid}/{r['pn']}.err"):
            print(f"{bid}\t{r['pn']}\t{r['src']}")
PY
M=$J/gpu/$NAME/manifest.tsv
echo "$(date -u +%FT%TZ) $(wc -l < "$M") pages to read"

if [ -s "$M" ]; then
  WF=/root/.paddlex/official_models/PaddleOCR-VL-1.6/model.safetensors
  read -r PV POV PXV < <(/root/pz/venv/bin/python -c 'import paddle, paddleocr, paddlex; print(paddle.__version__, paddleocr.__version__, paddlex.__version__)' 2>/dev/null)
  VV=$(/root/pz/srv/bin/python -c 'import vllm; print(vllm.__version__)' 2>/dev/null)
  cat > "$J/runs/$NAME.json" <<EOF
{"run": "$NAME", "issue": $PADDLE_ZH_ISSUE, "host": "$(hostname)", "gpu": "$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)",
 "backend": "server", "workers": $W, "layout": 1, "vllm_version": "$VV",
 "paddle_version": "$PV", "paddleocr_version": "$POV", "paddlex_version": "$PXV",
 "weights_files": ["PaddleOCR-VL-1.6/model.safetensors"], "weights_sha256": "$(sha256sum "$WF" | cut -d' ' -f1)",
 "started_at": "$(date -u +%FT%TZ)", "root": "$J", "manifest": "$M", "manifest_lines": $(wc -l < "$M")}
EOF
  PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/gpu/$NAME/serve.log" 2>&1 < /dev/null &
  SP=$!
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$J/gpu/$NAME/serve.log"; exit 1; }
  echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB, $W clients"
  s=$(date +%s) pids=()
  for w in $(seq 0 $((W - 1))); do
    ( while :; do
        /root/pz/venv/bin/python "$RUNNER" --manifest "$M" --root "$J" --worker $w --workers $W \
          --page-timeout 90 --layout 1 --backend server --prefetch 3 --deadline "$DEADLINE" >> "$J/gpu/$NAME/worker-$w.log" 2>&1
        rc=$?; echo "$(date -u +%FT%TZ) worker $w rc=$rc" >> "$J/gpu/$NAME/restarts.log"; [ $rc -eq 3 ] || break
      done ) & pids+=($!)
  done
  wait "${pids[@]}"   # NOT a bare wait: the genai server is also a child of this shell (#7184)
  echo "$(date -u +%FT%TZ) read in $(( $(date +%s) - s ))s: $(find "$J/out" -name '*.txt' | wc -l) txt, $(find "$J/out" -name '*.err' | wc -l) err in all runs"
  stop_server
fi

# the Mongo half, on the CPU, with the card already free: write every book whose planned pages are all back
# (APPLY=0: read only — a canary whose plan/ is a subset and whose out/ links to the main lane dir's)
[ "${APPLY:-1}" = 1 ] || exit 0
cd "$CODE_DIR" && node --env-file="$ENV_FILE" scripts/workers/paddle-zh-lane.mjs apply --apply 2>&1 | tail -5
node --env-file="$ENV_FILE" scripts/workers/paddle-zh-lane.mjs status 2>&1 | tail -8
