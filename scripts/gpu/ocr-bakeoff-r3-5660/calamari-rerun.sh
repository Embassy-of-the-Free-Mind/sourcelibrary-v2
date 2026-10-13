#!/bin/bash
# Calamari keys .pred.txt by image basename; per-page dirs of 00000.png… collided. Unique names, then predict again.
set -u
cd /root/pz/cpu/lines || exit 1
find . -name "*.pred.txt" -delete
for d in *; do for f in "$d"/[0-9]*.png; do [ -e "$f" ] && mv "$f" "$d/${d}__$(basename "$f")"; done; done
rm -rf /root/pz/arms/calamari-gt4histocr; mkdir -p /root/pz/arms/calamari-gt4histocr
t1=$(date +%s)
CUDA_VISIBLE_DEVICES= TF_CPP_MIN_LOG_LEVEL=2 /root/pz/cpu/cv/bin/calamari-predict --checkpoint /root/pz/cpu/gt4histocr/*.ckpt.json --data.images "/root/pz/cpu/lines/*/*.png" --verbose False > /root/pz/cpu/calamari-predict2.log 2>&1
python3 /root/pz/code/alto-lines.py join /root/pz/cpu/alto /root/pz/cpu/lines /root/pz/arms/calamari-gt4histocr/out/_bench
echo "{\"pages\": 397, \"lines\": $(ls /root/pz/cpu/lines/*/*.png | wc -l), \"preds\": $(ls /root/pz/cpu/lines/*/*.pred.txt | wc -l), \"recognise_wall_secs\": $(( $(date +%s) - t1 )), \"segmentation\": \"kraken-catmus arm (shared)\"}" > /root/pz/arms/calamari-gt4histocr/arm-run.json
echo CAL2-END
