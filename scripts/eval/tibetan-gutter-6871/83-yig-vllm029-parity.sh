#!/usr/bin/env bash
# timeout: 2h
# issue: 6871
# 83-yig-vllm029-parity / 83a-…-r2 (job yig-vllm-6871): the production Yigdzin reader on vLLM 0.29.0 on gex45's Blackwell card,
# parity-checked against the HF reads it would replace. Files only, no Mongo.
#   L  the #5771 leaf crops (/root/jobs/split-leaves-5771/out/crops, READ ONLY) with yig_leaf_worker.py, crop rows
#   P  the 30 guttered pages of parity30.jsonl with yig_vllm.py page mode (the HF page reader's recipe)
#   T  throughput only: 200 more guttered pages that have HF reads, yig_vllm.py --batch 64
# Each arm runs first as production (CUDA graphs); if it fails or does not finish inside its watchdog, it is killed
# with a stack dump (PYTHONFAULTHANDLER + SIGABRT to the whole process group) and re-run with --enforce-eager and
# VLLM_ENABLE_V1_MULTIPROCESSING=0. The vLLM 0.31 attempt (73) hung silently after warm-up; this one leaves a trace.
set -uo pipefail
J=/root/jobs/yig-vllm-6871; H=$J/harness; R=$J/run; PY=$J/venv/bin/python
G=/root/jobs/tib-gutter-6871; C=/root/jobs/split-leaves-5771/out/crops
MODEL=/root/.cache/huggingface/hub/models--BDRC--tibetan-ocr/snapshots/50506eb6d8ed8738df86b448f6f6cdc688de29ea
mkdir -p "$R"; cd "$R"
export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential PYTHONFAULTHANDLER=1
# NO OMP_NUM_THREADS. Run 1 of this task (and 73) exported OMP_NUM_THREADS=8: the parent then starts an 8-thread libgomp
# pool before vLLM FORKS the EngineCore, and the child deadlocks in libgomp on its first CPU torch.zeros
# (py-spy, 2026-10-26: gpu_input_batch.py:134 -> at::native::fill_kernel -> libgomp). Unset, vLLM pins it to 1.
unset OMP_NUM_THREADS
export HF_HUB_OFFLINE=1 TMPDIR=$J/tmp; mkdir -p "$TMPDIR"
ts() { date -u +%FT%TZ; }
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader
# VRAM: every 2 s, per process on the card (ours and anyone else's), for the peak
( while :; do echo "$(date +%s) $(nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits | tr '\n' ';')"; sleep 2; done ) > vram.log 2>&1 &
VP=$!
trap 'kill $VP 2>/dev/null' EXIT

run_wd() {  # run_wd <secs> <log> cmd...   — own process group; on timeout dump stacks, then kill the group
  local T=$1 L=$2; shift 2; local t0=$(date +%s)
  setsid "$@" >> "$L" 2>&1 & local p=$!
  while kill -0 $p 2>/dev/null; do
    sleep 10
    if [ $(( $(date +%s) - t0 )) -ge "$T" ]; then
      echo "$(ts) WATCHDOG ${T}s: SIGABRT to group $p (stack dump in $L)"; kill -ABRT -- -$p 2>/dev/null; sleep 15
      kill -9 -- -$p 2>/dev/null; break
    fi
  done
  wait $p; local rc=$?
  for i in $(seq 1 30); do pgrep -g $p >/dev/null 2>&1 || break; sleep 2; done
  echo "$(ts) rc=$rc wall=$(( $(date +%s) - t0 ))s :: $*"; return $rc
}

# --- L: leaf crops, production worker ---
ls "$C"/*-L*.jpg | while read -r f; do b=$(basename "$f" .jpg); printf '{"id":"%s","path":"%s"}\n' "$b" "$f"; done > leaf-todo.jsonl
NL=$(wc -l < leaf-todo.jsonl); echo "$(ts) L: $NL crops"
leaf() {  # leaf <dir> [extra args]
  local d=$1; shift
  run_wd ${WD_L:-1800} "$d.log" "$PY" "$H/yig_leaf_worker.py" --todo leaf-todo.jsonl --out "$d" --mode partition \
    --batch 128 --model "$MODEL" --gpu-util 0.6 "$@"
  [ "$(ls "$d/txt" 2>/dev/null | wc -l)" -ge "$NL" ]
}
LD=L-graph
leaf L-graph || { echo "$(ts) L-graph incomplete ($(ls L-graph/txt 2>/dev/null | wc -l)/$NL); eager fallback"; LD=L-eager
  VLLM_ENABLE_V1_MULTIPROCESSING=0 WD_L=3600 leaf L-eager --enforce-eager || echo "$(ts) L-eager incomplete too"; }

# --- P: 30 guttered pages, page mode ---
page() {  # page <dir> <manifest> <batch> [extra]
  local d=$1 m=$2 b=$3; shift 3
  run_wd ${WD_P:-1500} "$d.log" "$PY" "$H/yig_vllm.py" --manifest "$m" --out "$d" --mode page --batch "$b" --gpu-util 0.6 "$@"
  [ "$(ls "$d" 2>/dev/null | grep -cE '\.(txt|err)$')" -ge "$(grep -c . "$m")" ]   # a failed fetch (.err) is not a hang
}
cp "$H/parity30.jsonl" P-todo.jsonl
EAGER=""; PD=P-graph
page P-graph P-todo.jsonl 30 || { echo "$(ts) P-graph incomplete; eager fallback"; EAGER=1; PD=P-eager
  VLLM_ENABLE_V1_MULTIPROCESSING=0 WD_P=3000 page P-eager P-todo.jsonl 30 --enforce-eager || echo "$(ts) P-eager incomplete too"; }

# --- T: throughput, 200 more pages with HF reads (skipped if P needed the eager fallback: that is a different engine) ---
if [ -z "$EAGER" ]; then
  "$PY" - "$G" > T-todo.jsonl <<'PY'
import json, os, random, sys
G = sys.argv[1]; skip = {json.loads(l)["id"] for l in open("P-todo.jsonl")}
rows = [r for r in map(json.loads, open(f"{G}/full.jsonl")) if r["id"] not in skip and os.path.exists(f"{G}/full/{r['id']}.txt")]
for r in random.Random(83).sample(rows, min(200, len(rows))):
    print(json.dumps(r))
PY
  WD_P=2400 page T-graph T-todo.jsonl 64 || echo "$(ts) T incomplete"
fi

# --- score (CPU) ---
python3 "$H/parity-vllm.py" /root/jobs/split-leaves-5771/out/txt "$LD/txt" --out L-items.jsonl; echo "L rc=$?"
python3 "$H/parity-vllm.py" "$G/full" "$PD" --out P-items.jsonl; echo "P rc=$?"
[ -d T-graph ] && { python3 "$H/parity-vllm.py" "$G/full" T-graph --out T-items.jsonl; echo "T rc=$?"; }
kill $VP 2>/dev/null
echo "$(ts) peak VRAM per pid (MiB):"; cut -d' ' -f2- vram.log | tr ';' '\n' | awk -F', ' 'NF==2{if($2>m[$1])m[$1]=$2} END{for(p in m)print p, m[p]}'
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo "$(ts) END"
