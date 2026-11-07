#!/usr/bin/env bash
# Tell gex45 how the display-mark backfill ended, now that the shards run on cloudlayer (#4406, moved 2026-11-07).
# PRIOR ART: the box mesh (box-rpc.sh) carries no files; run-chain.sh on gex45 waits on finished-*/stopped-* files in
# its own folder and must not be rewritten mid-run, so the same files are recreated there.
#   backfill-marks-relay.sh publish   on cloudlayer: one small R2 object per finished-/stopped- file
#   backfill-marks-relay.sh fetch     on gex45: recreates those files for the cold-copy chain
set -u
SL=/root/sourcelibrary; export DISK_STEWARD_SL=$SL
COLD="node --env-file=$SL/.env.production.local $SL/scripts/workers/cold-r2.mjs"
PREFIX=cold/transfer/backfill-4406
case "${1:-}" in
  publish)
    OUT=/data/scratch/sl/jobs/trithemian-images-4406/backfill
    for f in "$OUT"/finished-*-of-14.txt "$OUT"/stopped-*-of-14.txt; do
      [ -f "$f" ] || continue
      n=$(basename "$f" .txt); [ -f "$OUT/relayed-$n" ] && continue
      $COLD put-json "$PREFIX/$n.json" '{}' && touch "$OUT/relayed-$n"
    done ;;
  fetch)
    OUT=/root/jobs/trithemian-images-4406/backfill; mkdir -p "$OUT"
    for kind in finished stopped; do for i in $(seq 0 13); do
      f="$OUT/$kind-$i-of-14.txt"; [ -f "$f" ] && continue
      $COLD head "$PREFIX/$kind-$i-of-14.json" >/dev/null 2>&1 && echo "relayed from cloudlayer $(date -u +%FT%TZ)" > "$f"
    done; done ;;
  *) echo "usage: $0 publish|fetch"; exit 2 ;;
esac
