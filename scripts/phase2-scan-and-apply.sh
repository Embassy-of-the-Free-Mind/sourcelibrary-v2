#!/bin/bash
# Phase 2: scan remaining BPH books in batches of 25, then autoapply each batch.
# Progress saved per book; safe to interrupt and resume.
set -e
cd /Users/dereklomas/sourcelibrary/.claude/worktrees/bph-cover-fix
set -a; source /Users/dereklomas/sourcelibrary/.env.production.local; set +a

BATCH_SIZE=25
LOG=/tmp/phase2.log
echo "[phase2] $(date) — starting, $(wc -l < /tmp/phase2-ids.txt) books to scan" | tee -a "$LOG"

total=$(wc -l < /tmp/phase2-ids.txt)
done_count=0
while [ $done_count -lt $total ]; do
  # Build next batch ids list
  tail -n +$((done_count + 1)) /tmp/phase2-ids.txt | head -n $BATCH_SIZE > /tmp/phase2-batch.txt
  batch_size=$(wc -l < /tmp/phase2-batch.txt)
  if [ "$batch_size" -eq 0 ]; then break; fi
  echo "[phase2] $(date) — batch starting at offset $done_count, $batch_size books" | tee -a "$LOG"

  node scripts/dedup-scan-strict.mjs --book-list /tmp/phase2-batch.txt --concurrency 4 >> "$LOG" 2>&1

  # Move just-scanned proposals into a staging dir so autoapply only sees the
  # new batch (avoids re-vision-verifying already-applied books).
  mkdir -p .claude/docs/dedup-proposals-staging
  while read -r bid; do
    if [ -f ".claude/docs/dedup-proposals/${bid}.json" ]; then
      mv ".claude/docs/dedup-proposals/${bid}.json" ".claude/docs/dedup-proposals-staging/${bid}.json"
    fi
  done < /tmp/phase2-batch.txt

  node scripts/dedup-autoapply.mjs --in-dir .claude/docs/dedup-proposals-staging >> "$LOG" 2>&1

  # Move applied proposals to "applied" archive
  mkdir -p .claude/docs/dedup-proposals-applied
  mv .claude/docs/dedup-proposals-staging/*.json .claude/docs/dedup-proposals-applied/ 2>/dev/null || true

  done_count=$((done_count + batch_size))
  echo "[phase2] $(date) — $done_count/$total complete" | tee -a "$LOG"
done

echo "[phase2] $(date) — ALL DONE" | tee -a "$LOG"
