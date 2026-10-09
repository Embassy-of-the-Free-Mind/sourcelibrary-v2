# PRIOR ART: scripts/eval/tibetan-nyingma-reference/run.sh — the same aligner calls and controls, once per work group.
# Run from /root/tib-bl-evidence after build_ref_opf.py. kanjur_align.py is used unchanged.
set -e
A=/root/tibetan-eval/kanjur_align.py
NEG=/root/nyingma-ref/draw/negative-kanjur.jsonl   # the #5459 negative set: 20 BL Kangyur pages
for d in refs/*/; do
  g=$(basename "$d"); R=results/$g; mkdir -p $R
  python3 -c "
import json
for l in open('draw/terma-scored.jsonl'):
    r = json.loads(l)
    if r['work'] == '$g': print(l, end='')" > $R/scored-in.jsonl
  python3 $A index --opf $d/opf --out $d/index.pkl 2>> $R/log
  python3 $A control --index $d/index.pkl --noise 0.05 --n 50 --out $R/control-noise05.jsonl 2>> $R/log
  python3 $A score --index $d/index.pkl --pages $R/scored-in.jsonl --out $R/scored.jsonl 2>> $R/log
  python3 $A score --index $d/index.pkl --pages $R/scored-in.jsonl --control-shuffle --out $R/chance-shuffle.jsonl 2>> $R/log
  python3 $A score --index $d/index.pkl --pages $NEG --out $R/negative-kanjur.jsonl 2>> $R/log
  rm -f $d/index.pkl
  echo "$g done"
done
echo done > results/done.txt
