#!/usr/bin/env bash
# PRIOR ART: ./chained-draw.sh — the one-off chained-lane draw that commits a branch for a claude.ai routine. That
# shape does not fit a rolling gate: one branch per date, refuses to re-run, and pushes. This draws ONE time window
# of pages the chained lane wrote into a scratch dir on Hetzner (no branch, no push); the gate session copies the
# packets back, judges them on the subscription, and decides OK / ABORT for speed test A (ops handoff
# 2026-09-30-chained-quality-sample.md "Amended"). $0 API: a Mongo read.
#
#   on Hetzner:  GATE_REF=<branch> GATE_SINCE=<ISO> GATE_UNTIL=<ISO> GATE_NAME=w1 [GATE_BOOKS_FILE=<ids>] bash gate-window-draw.sh
set -euo pipefail
REPO=/root/sourcelibrary                  # the lane's checkout: read-only here (node_modules, .env)
WORK=/root/tca-work                       # chained-draw.sh's clone, reused
REF=${GATE_REF:?GATE_REF}
NAME=${GATE_NAME:?GATE_NAME}
OUT=/root/speedtest-a/gate/$NAME
SEED=${GATE_SEED:-$(date -u +%Y%m%d%H)}
GIT_AUTH=(-c "credential.helper=" -c "credential.helper=!gh auth git-credential")
if [ -e "$OUT/manifest.jsonl" ]; then echo "$OUT already drawn — refusing to redraw over it"; exit 0; fi
cd "$WORK"
git "${GIT_AUTH[@]}" fetch --quiet origin "$REF"
git checkout --quiet --detach FETCH_HEAD
ln -sfn "$REPO/node_modules" node_modules
set -a; . "$REPO/.env.production.local"; set +a
EXTRA=()
if [ -n "${GATE_BOOKS_FILE:-}" ]; then EXTRA+=(--book-ids "$GATE_BOOKS_FILE"); fi
node scripts/eval/translation-corpus-audit/draw-chained.mjs --out "$OUT" --seed "$SEED" \
  --books "${GATE_BOOKS:-45}" --seams "${GATE_SEAMS:-10}" --swap 10 --drop 10 --repeat 10 \
  --since "${GATE_SINCE:?GATE_SINCE}" --until "${GATE_UNTIL:?GATE_UNTIL}" "${EXTRA[@]}"
node scripts/eval/translation-corpus-audit/build-packets.mjs --dir "$OUT" --seed "$SEED"
echo "drawn → $OUT: $(grep -c '"kind":"main"' "$OUT/manifest.jsonl") main, $(grep -c -E '"kind":"(swap|drop|repeat)"' "$OUT/manifest.jsonl") controls, $(ls "$OUT/packets" | grep -c packet-) packets"
