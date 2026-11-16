#!/usr/bin/env bash
# timeout: 3h
# issue: 60
# gpu-task.sh — the #60 half-leaf test's reads, as one gex45 gpu-queue task: arms A, A2 (A again: run-to-run noise),
# W, B, C, C3, each a separate yig_leaf_worker.py run over local crop files (`path` rows: the production read path,
# prompt, DRY settings and retries). Files only; nothing is written to Mongo, R2 or pages.
# PRIOR ART: the 83a-yig-vllm029-parity-r2 task of 2026-10-26 (scripts/eval/experiments/2026-10-26-yigdzin-vllm029-gex45-parity-6871.md:
# same venv, env and --gpu-util); it read one set, this reads six and waits for the card like the filler's chunks do.
# Queue: /root/bin/gpu-queue.sh add gpu-task.sh 60-tib-halfleaf
set -uo pipefail
J=${J:-/root/jobs/tib-halfleaf-60}; W=$J/work; CODE=${CODE:-/root/worktrees/job-tib-halfleaf-60}
PY=/root/jobs/yig-vllm-6871/venv/bin/python
unset OMP_NUM_THREADS          # a live libgomp pool in the parent deadlocks vLLM's forked EngineCore (#6871)
export VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential HF_HUB_OFFLINE=1
for i in $(seq 1 60); do       # 0.6 of the card is 14.7 GB
  f=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  [ "${f:-0}" -ge 15500 ] && break
  [ "$i" -eq 60 ] && { echo "card busy (${f} MiB free) for an hour"; exit 75; }
  sleep 60
done
echo "$(date -u +%FT%TZ) start, GPU free ${f} MiB"
rc=0
for arm in A W B C A2 C3; do
  todo=$W/todo-${arm%2}.jsonl; out=$J/reads/$arm
  [ -e "$out/DONE" ] && continue
  mkdir -p "$out"
  echo "$(date -u +%FT%TZ) arm $arm: $(wc -l < "$todo") images"
  "$PY" "$CODE/scripts/gpu/yigdzin-vllm/yig_leaf_worker.py" --todo "$todo" --out "$out" --model "$J/model" \
     --gpu-util 0.6 --batch 128 --threads 4 > "$out/run.log" 2>&1; r=$?
  tail -2 "$out/run.log"
  # an arm is DONE only when every image has a read: the worker exits 0 even when every row failed to load
  # (2026-11-12 first run: relative crop paths, 362 prep-failed rows, rc 0)
  got=$(ls "$out/txt" 2>/dev/null | wc -l); want=$(wc -l < "$todo")
  if [ $r -eq 0 ] && [ "$got" -eq "$want" ]; then touch "$out/DONE"; else rc=${r/#0/1}; echo "arm $arm: $got of $want reads"; fi
  echo "$(date -u +%FT%TZ) arm $arm rc=$r, GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
done
exit $rc
