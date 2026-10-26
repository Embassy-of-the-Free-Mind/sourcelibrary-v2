#!/usr/bin/env bash
# siglip2-requeue.sh — keep the full SigLIP2 page run (#6871 row 8) trickling through the gex45 GPU queue, behind any
# transcription work: it adds the next embedding chunk only when NO other task is pending, and never more than two
# embedding chunks pending + running at once.
#
# PRIOR ART: /root/bin/gpu-queue.sh (runs one queued task at a time, in name order; queues nothing by itself) and
# full-chunk.sh (this directory: one chunk's task). Nothing else decides WHEN to queue the next chunk of a long run.
#
# Chunk tasks are named zz-siglip2-full-cNNN[-rK]: `zz-` sorts after every digit-prefixed task (the queue convention),
# so a transcription task queued later (Tibetan split-leaf #5771, Chinese Paddle, …) still runs before the next chunk.
# A chunk is done when its out dir's manifest.json has shards_done == shards_total; a chunk that stopped at its deadline
# (exit 75, lands in failed/) is re-queued as -rK and resumes from its shard checkpoints. Root disk < 30 G: queue nothing.
# A chunk queued 5 times without finishing stops the chain and pages. Touch $J/full/PAUSE to stop adding chunks.
# Never moves, kills or reorders any other task.
#   gex45 cron: 2,32 * * * * /root/jobs/siglip2-6871/code-full/siglip2-requeue.sh >> /var/log/sourcelibrary/siglip2-requeue.log 2>&1
set -uo pipefail
J=/root/jobs/siglip2-6871; Q=/root/gpu-queue; TPL=$J/code-full/full-chunk.sh
TOPIC=${NTFY_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
page() { curl -fsS -m 15 -H "Title: $1" -H "Priority: high" -H "Tags: gpu" -d "$2" "$TOPIC" >/dev/null 2>&1 || true; }
exec 9>/tmp/siglip2-requeue.lock; flock -n 9 || exit 0
[ -e "$J/full/PAUSE" ] && exit 0
others=$(ls -1 "$Q"/pending 2>/dev/null | grep '\.sh$' | grep -vc '^zz-siglip2-full-')
[ "$others" -gt 0 ] && exit 0   # transcription (or anything else) is waiting: it goes first, add nothing
ours=$(ls -1 "$Q"/pending "$Q"/running 2>/dev/null | grep -c '^zz-siglip2-full-')
[ "$ours" -ge 2 ] && exit 0
free_g=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "${free_g:-0}" -lt 30 ] && { echo "$(now) root disk ${free_g}G free < 30G: queueing nothing"; exit 0; }
done_chunk() {   # 0 when every shard of chunk $1 has its checkpoint
  python3 -c "import json,sys; m=json.load(open(sys.argv[1])); sys.exit(0 if m['shards_done']==m['shards_total'] else 1)" \
    "$J/out/full/chunk-$1/manifest.json" 2>/dev/null
}
for f in $(ls -1 "$J"/full/chunk-*.jsonl | sort); do
  n=$(basename "$f" .jsonl); n=${n#chunk-}
  done_chunk "$n" && continue
  ls -1 "$Q"/pending "$Q"/running 2>/dev/null | grep -q "^zz-siglip2-full-c$n" && continue   # already queued / running
  tries=$(ls -1 "$Q"/done "$Q"/failed 2>/dev/null | grep -c "^zz-siglip2-full-c$n")
  if [ "$tries" -ge 5 ]; then
    echo "$(now) chunk $n queued $tries times without finishing: chain paused (fix it, then rm $J/full/PAUSE)"
    touch "$J/full/PAUSE"; page "SigLIP2 full run stopped (#6871)" "chunk $n ran $tries times without finishing; see gex45:/root/jobs/gpu-queue/zz-siglip2-full-c$n*/task.log"
    exit 0
  fi
  name="zz-siglip2-full-c$n$([ "$tries" -gt 0 ] && echo "-r$tries")"
  tmp=$(mktemp); sed "s/^CHUNK=__CHUNK__$/CHUNK=$n/" "$TPL" > "$tmp"
  grep -q "^CHUNK=$n$" "$tmp" || { echo "$(now) template has no CHUNK=__CHUNK__ line: not queueing"; rm -f "$tmp"; exit 1; }
  /root/bin/gpu-queue.sh add "$tmp" "$name"; rm -f "$tmp"
  echo "$(now) queued $name (root disk ${free_g}G free)"
  ours=$((ours + 1)); [ "$ours" -ge 2 ] && exit 0
done
