#!/bin/bash
# Whish 147 Kraken line model (#7119): read the held-out lines (9 verse leaves, 3 hand-B leaves) with one model.
# PRIOR ART: none — the kraken CLI (`kraken -I … ocr -s -m <weights>`, each image one line); runs on gex45 in /root/jobs/whish147-kraken.
# usage: predict.sh <model weights> <label>  -> preds/<label>.json {"<leaf>-rNN": text}; score with score.py
cd /root/jobs/whish147-kraken; source /root/bench/kraken/bin/activate
rm -rf pred-$2; mkdir -p pred-$2 preds; cp n-lines-test/*.png n-lines-handB/*.png pred-$2/
timeout 1200 python code/kraken_nonorm.py -d cpu --threads 2 -I "pred-$2/*.png" -o .txt ocr -s -m $1 > logs/pred-$2.log 2>&1
python3 -c "
import json,glob,os
d={os.path.basename(f)[:-4]:open(f).read().strip() for f in sorted(glob.glob('pred-$2/*.txt'))}
json.dump(d,open('preds/$2.json','w'),ensure_ascii=False); print(len(d),'lines')"
