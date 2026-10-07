#!/bin/bash
# PRIOR ART: scripts/workers/syriac-kraken-lane.mjs (#4883) — same Kraken 7.1 venv (/root/bench2-kraken/venv) and the
# same `segment -bl -d horizontal-rl … ocr --base-dir R` invocation, but that lane writes `pages`; this is a measurement
# over the #5525 Stage 1 manuscript page images and writes only local text files.
#
# Stage 1b arm 2 (#5525): blla segmentation ONCE per page (Kraken's default baseline segmenter, stored as ALTO), then
# every recognition model over the same stored lines, so the models differ only in recognition. CPU, niced.
# Usage: kraken_ocr.sh <imgdir> <workdir> <modeldir>     (models: see MODELS below; download URLs in the experiment log)
# Then:  python3 kraken_rows.py <sample.jsonl> <strata.json> <workdir>/out/<model> > <model>.jsonl  → persian_align.py
set -u
IMG=$(realpath "$1"); WORK="$2"; M=$(realpath "$3")
K=${KRAKEN:-/root/bench2-kraken/venv/bin/kraken}
MODELS=${MODELS:-"ppocrv6_medium.safetensors persian_best.mlmodel all_arabic_scripts.mlmodel ms_mellon_print_trans.mlmodel ms_pretrained_trans.mlmodel"}
mkdir -p "$WORK" && cd "$WORK"
SEG=(); for f in "$IMG"/*.jpg; do id=$(basename "$f" .jpg); [ -s "$id.seg.xml" ] || SEG+=(-i "$f" "$id.seg.xml"); done
[ ${#SEG[@]} -gt 0 ] && nice -n 15 "$K" -a "${SEG[@]}" segment -bl -d horizontal-rl
for m in $MODELS; do
  mkdir -p "out/$m"; IN=()
  for x in *.seg.xml; do id=${x%.seg.xml}; [ -s "out/$m/$id.txt" ] || IN+=(-i "$x" "out/$m/$id.txt"); done
  [ ${#IN[@]} -gt 0 ] && { echo "== $m $(date +%T)"; nice -n 15 "$K" -f alto "${IN[@]}" ocr -m "$M/$m" --base-dir R; }
done
echo ALLDONE "$(date +%T)"
