#!/usr/bin/env bash
# timeout: 24h
# issue: 6871
# Row 4 full read, sharded (Derek 2026-10-25: resume only with a speed fix). One process read 4.4 min/page, CPU-bound on
# one core (the DRY logits processor) with ~2.3 GB VRAM, so N processes read disjoint shards side by side. Same model,
# prompt and greedy decoding as 61-tib-gutter-full.sh; pages already in full/ are skipped. Re-queue under a new name
# until full/ holds every page. Files only; applying the reads is a decision for Derek.
set -uo pipefail
J=/root/jobs/tib-gutter-6871; cd "$J"
N=${N:-6}
export OMP_NUM_THREADS=2
pids=()
for i in $(seq 0 $((N - 1))); do
  /root/jobs/mongol-synth-5664/venv/bin/python yig_page.py --manifest full.jsonl --out full --mode page --shard "$i" --nshards "$N" > "shard-$i.log" 2>&1 &
  pids+=($!)
done
( while sleep 3600; do echo "$(date -u +%FT%TZ) full: $(ls full | grep -c '\.txt$') txt of $(wc -l < full.jsonl); vram $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"; done ) &
mon=$!
trap 'kill "${pids[@]}" "$mon" 2>/dev/null' EXIT TERM INT  # never leave a reader on the card after the lock is released
wait "${pids[@]}"
kill $mon 2>/dev/null
echo "full: $(ls full | grep -c '\.txt$') txt, $(ls full | grep -c '\.err$') err of $(wc -l < full.jsonl)"
