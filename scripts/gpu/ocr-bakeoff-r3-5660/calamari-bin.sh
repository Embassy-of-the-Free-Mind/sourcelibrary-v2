#!/bin/bash
# Calamari GT4HistOCR on BINARIZED lines (the OCR-D model's documented input): Kraken nlbin per page, the same
# Kraken line polygons cut from the binarized page, then the same 5-model ensemble.  -> arm calamari-gt4histocr-bin
set -u
W=/root/pz; C=$W/cpu; mkdir -p $C/bin $C/lines-bin; export CUDA_VISIBLE_DEVICES=
J=12; t0=$(date +%s)
work() { i=0; while IFS=$'\t' read -r _ slug src; do i=$((i+1)); [ $(( i % J )) -eq $1 ] || continue
  [ -s $C/bin/$slug.png ] || OMP_NUM_THREADS=2 timeout 600 $C/kv/bin/kraken -i $W/bench/$src $C/bin/$slug.png binarize > /dev/null 2>&1; done < $W/bench/cpu.tsv; }
for k in $(seq 0 $((J-1))); do work $k & done; wait
echo "binarized $(ls $C/bin | wc -l) pages in $(( $(date +%s) - t0 )) s"
$C/kv/bin/python $W/code/alto-lines.py crop $C/alto $W/bench $W/bench/cpu.tsv $C/lines-bin $C/bin
t1=$(date +%s)
TF_CPP_MIN_LOG_LEVEL=2 $C/cv/bin/calamari-predict --checkpoint $C/gt4histocr/*.ckpt.json --data.images "$C/lines-bin/*/*.png" --verbose False > $C/calamari-predict-bin.log 2>&1
rm -rf $W/arms/calamari-gt4histocr-bin; mkdir -p $W/arms/calamari-gt4histocr-bin
python3 $W/code/alto-lines.py join $C/alto $C/lines-bin $W/arms/calamari-gt4histocr-bin/out/_bench
echo "{\"pages\": 397, \"lines\": $(ls $C/lines-bin/*/*.png | wc -l), \"preds\": $(ls $C/lines-bin/*/*.pred.txt | wc -l), \"binarize_wall_secs\": $(( t1 - t0 )), \"recognise_wall_secs\": $(( $(date +%s) - t1 )), \"segmentation\": \"kraken-catmus arm (shared)\", \"binarization\": \"kraken nlbin, default\"}" > $W/arms/calamari-gt4histocr-bin/arm-run.json
echo CALBIN-END
