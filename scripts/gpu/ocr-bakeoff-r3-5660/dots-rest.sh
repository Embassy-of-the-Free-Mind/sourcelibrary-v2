#!/bin/bash
# dots.ocr over the full manifest; pages already read (priority cells first) are skipped by the client
cd /root/pz; t0=$(date +%s)
/root/pz/vl/bin/python /root/pz/code/vlm-run.py /root/pz/bench/acc.tsv /root/pz/arms/dots-ocr http://127.0.0.1:8200/v1 m dots 8000
mv /root/pz/arms/dots-ocr/arm-run.json /root/pz/arms/dots-ocr/arm-run-rest.json; echo REST-END
