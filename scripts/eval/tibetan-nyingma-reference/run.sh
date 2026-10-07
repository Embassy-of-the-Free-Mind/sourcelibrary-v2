set -e
cd /root/nyingma-ref
A=/root/tibetan-eval/kanjur_align.py; I=gpb-index.pkl; R=results; mkdir -p $R
python3 $A control --index $I --noise 0.05 --n 50 --out $R/control-noise05.jsonl
python3 $A control --index $I --noise 0.05 --n 50 --span 2 --out $R/control-noise05-span2.jsonl
python3 $A score --index $I --pages draw/negative-kanjur.jsonl --out $R/negative-kanjur.jsonl
python3 $A score --index $I --pages draw/bridge-bl-other.jsonl --out $R/bridge-bl-other.jsonl
python3 $A score --index $I --pages draw/nyingma-sample.jsonl --out $R/nyingma.jsonl
python3 $A score --index $I --pages draw/nyingma-sample.jsonl --control-shuffle --out $R/chance-shuffle.jsonl
echo done > $R/done.txt
