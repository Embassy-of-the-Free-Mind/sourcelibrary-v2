#!/bin/bash
# PRIOR ART: /root/kraken-on-refused.sh (the #4686 5-page probe: same Kraken call, no bench layout);
# scripts/eval/greek-ms-kraken-5619.sh (Kraken over a page list, niced, one model).
# run-arms.sh — the three CPU arms of refused-en-4686 (#4686), niced, low concurrency (box is shared).
#   bash scripts/eval/kraken-refused-4686/run-arms.sh /root/kraken-refused-4686/bench
# Writes <root>/refused-en-4686/out/<arm>/<slug>.txt and <arm>/_timings.tsv. Resumable: a page with
# output is skipped. Two Kraken processes side by side (one per model), then MinerU.
set -u
ROOT=${1:?bench root}
D="$ROOT/refused-en-4686"
K=${KRAKEN_BIN:-/root/bench2-kraken/venv/bin/kraken}
MINERU=${MINERU_BIN:-/root/mineru-eval/venv/bin/mineru}
HERE=$(cd "$(dirname "$0")" && pwd)

kraken_arm() { # arm model
  local arm=$1 model=$2 out="$D/out/$1"
  mkdir -p "$out"
  for img in "$D"/*.jpg; do
    local slug; slug=$(basename "$img" .jpg)
    [ -s "$out/$slug.txt" ] && continue
    local t0; t0=$(date +%s)
    OMP_NUM_THREADS=2 timeout 1800 nice -n 19 "$K" -i "$img" "$out/$slug.txt" segment -bl ocr -m "$model" >/dev/null 2>"$out/$slug.err"
    local rc=$?
    [ -f "$out/$slug.txt" ] || : > "$out/$slug.txt"
    printf '%s\t%s\t%s\n' "$slug" "$rc" "$(( $(date +%s) - t0 ))" >> "$out/_timings.tsv"
  done
}

kraken_arm kraken-catmus /root/bench2-kraken/models/catmus.mlmodel &
P1=$!
kraken_arm kraken-catmus-ft-5730 /root/models/kraken/catmus-ft-latin-5730/catmus-print-ft-eebo-5730.safetensors &
P2=$!
wait $P1 $P2

# MinerU, as scripts/workers/mineru-ocr-worker.mjs runs it, over the whole image dir.
MW="$ROOT/_mineru"; mkdir -p "$MW/img" "$MW/out"
cp -n "$D"/*.jpg "$MW/img/"
t0=$(date +%s)
nice -n 19 "$MINERU" -p "$MW/img" -o "$MW/out" -b pipeline -m ocr > "$MW/mineru.log" 2>&1
echo "mineru rc=$? $(( $(date +%s) - t0 ))s" >> "$MW/mineru.log"
node "$HERE/collect-mineru.mjs" "$MW/out" "$D/out/mineru"
touch "$ROOT/arms.done"
