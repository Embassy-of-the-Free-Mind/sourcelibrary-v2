#!/bin/bash
# dots.ocr on the two priority cells only (time: ~40 s/page per client at native resolution); pages already read are kept
cd /root/pz; d=0; for s in $(cut -f2 bench/prio.tsv); do [ -f arms/dots-ocr/out/_bench/$s.txt ] && d=$((d+1)); done; echo "prio already done: $d of $(wc -l < bench/prio.tsv)"
/root/pz/vl/bin/python /root/pz/code/vlm-run.py /root/pz/bench/prio.tsv /root/pz/arms/dots-ocr http://127.0.0.1:8200/v1 m dots 8000
mv /root/pz/arms/dots-ocr/arm-run.json /root/pz/arms/dots-ocr/arm-run-prio.json; echo PRIO-END
