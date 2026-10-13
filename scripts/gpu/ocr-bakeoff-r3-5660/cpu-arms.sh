#!/bin/bash
# #5660 round 3, the CPU arms, run on the RunPod pod's CPUs while its GPU serves the VLM arms (the Hetzner box
# is ARM — no TensorFlow-addons wheel for Calamari — and was at load 32, Kraken at ~200 s/page there).
#   1. Kraken 7.1, blla segmentation + CATMuS-Print (catmus-print-fondue-large), ALTO out  -> arm kraken-catmus
#   2. Calamari 2.3.1 + GT4HistOCR (calamari_models 2.2, 5-model voting ensemble) on Kraken's line polygons
#      -> arm calamari-gt4histocr
# GPU hidden from both (CUDA_VISIBLE_DEVICES=) so neither touches the vLLM server's memory.
# Each install has a 30-minute budget (the brief); an arm that misses it is "not run".
set -u
W=/root/pz; C=$W/cpu; mkdir -p $C/alto $C/logs
export CUDA_VISIBLE_DEVICES=
log() { echo "$(date -u +%FT%TZ) $*" >> $C/cpu.log; }
NPROC=$(nproc); J=$(( NPROC / 2 )); [ $J -lt 1 ] && J=1; [ $J -gt 12 ] && J=12
log "start: nproc=$NPROC, kraken workers=$J (2 threads each)"

t0=$(date +%s)
python3 -m venv $C/kv && timeout 1800 bash -c "$C/kv/bin/pip install -q --upgrade pip && $C/kv/bin/pip install -q 'kraken==7.1'" > $C/kraken-install.log 2>&1
if $C/kv/bin/kraken --version >> $C/cpu.log 2>&1; then
  log "KRAKEN-INSTALLED after $(( $(date +%s) - t0 )) s"
  t1=$(date +%s)
  work() { i=0; while IFS=$'\t' read -r _ slug src; do i=$((i+1)); [ $(( i % J )) -eq $1 ] || continue
      [ -s $C/alto/$slug.xml ] && continue; s=$(date +%s.%N)
      OMP_NUM_THREADS=2 timeout 900 $C/kv/bin/kraken -a -i $W/bench/$src $C/alto/$slug.xml segment -bl ocr -m $W/code/catmus.mlmodel > /dev/null 2> $C/logs/$slug.log || echo fail > $C/alto/$slug.err
      echo "{\"pn\":\"$slug\",\"secs\":$(python3 -c "import time;print(round(time.time()-$s,2))")}" >> $C/kraken-timings.jsonl
    done < $W/bench/cpu.tsv; }
  for k in $(seq 0 $((J-1))); do work $k & done; wait
  log "KRAKEN-DONE $(ls $C/alto/*.xml 2>/dev/null | wc -l) xml, $(ls $C/alto/*.err 2>/dev/null | wc -l) err, wall $(( $(date +%s) - t1 )) s"
  mkdir -p $W/arms/kraken-catmus; $C/kv/bin/python $W/code/alto-lines.py text $C/alto $W/arms/kraken-catmus/out/_bench >> $C/cpu.log 2>&1
  echo "{\"pages\": $(wc -l < $W/bench/cpu.tsv), \"wall_secs\": $(( $(date +%s) - t1 )), \"workers\": $J, \"threads_per_worker\": 2, \"nproc\": $NPROC}" > $W/arms/kraken-catmus/arm-run.json
  cp $C/kraken-timings.jsonl $W/arms/kraken-catmus/timings.jsonl
  $C/kv/bin/python $W/code/alto-lines.py crop $C/alto $W/bench $W/bench/cpu.tsv $C/lines >> $C/cpu.log 2>&1
else
  log "KRAKEN-NOT-INSTALLED: $(tail -n 3 $C/kraken-install.log | tr '\n' ' ')"
fi

t0=$(date +%s)
( curl -LsSf https://astral.sh/uv/install.sh | sh ) > $C/calamari-install.log 2>&1
UV=/root/.local/bin/uv
timeout 1800 bash -c "$UV python install 3.10 && $UV venv -p 3.10 $C/cv && VIRTUAL_ENV=$C/cv $UV pip install 'calamari-ocr==2.3.1'" >> $C/calamari-install.log 2>&1
( cd $C && curl -sL -o gt4histocr.tar.gz https://github.com/Calamari-OCR/calamari_models/releases/download/2.2/gt4histocr.tar.gz && tar xzf gt4histocr.tar.gz ) >> $C/calamari-install.log 2>&1
if $C/cv/bin/python -c "import calamari_ocr; print('calamari', calamari_ocr.__version__)" >> $C/cpu.log 2>&1 && [ -d $C/lines ]; then
  log "CALAMARI-INSTALLED after $(( $(date +%s) - t0 )) s; $(VIRTUAL_ENV=$C/cv $UV pip freeze 2>/dev/null | grep -iE '^(tensorflow|tfaip|calamari)' | tr '\n' ' ')"
  t1=$(date +%s)
  # one predict call over all line images; the five GT4HistOCR checkpoints vote (calamari's default for >1 checkpoint)
  TF_CPP_MIN_LOG_LEVEL=2 $C/cv/bin/calamari-predict --checkpoint $C/gt4histocr/*.ckpt.json --data.images "$C/lines/*/*.png" --verbose False > $C/calamari-predict.log 2>&1 \
    || log "CALAMARI-PREDICT non-zero: $(tail -n 3 $C/calamari-predict.log | tr '\n' ' ')"
  mkdir -p $W/arms/calamari-gt4histocr
  python3 $W/code/alto-lines.py join $C/alto $C/lines $W/arms/calamari-gt4histocr/out/_bench >> $C/cpu.log 2>&1
  echo "{\"pages\": $(wc -l < $W/bench/cpu.tsv), \"lines\": $(ls $C/lines/*/*.png | wc -l), \"preds\": $(ls $C/lines/*/*.pred.txt 2>/dev/null | wc -l), \"recognise_wall_secs\": $(( $(date +%s) - t1 )), \"segmentation\": \"kraken-catmus arm (shared)\", \"nproc\": $NPROC}" > $W/arms/calamari-gt4histocr/arm-run.json
  log "CALAMARI-DONE $(cat $W/arms/calamari-gt4histocr/arm-run.json)"
else
  log "CALAMARI-NOT-RUN after $(( $(date +%s) - t0 )) s: $(tail -n 4 $C/calamari-install.log | tr '\n' ' ')"
fi
log CPU-END
