#!/bin/bash
# #5924 (round 4 of #5660), the CPU half on the pod: Kraken binarization + segmentation, then Calamari GT4HistOCR on
# the BINARIZED line crops — the round-3 `calamari-gt4histocr-bin` configuration, unchanged (cpu-arms.sh + calamari-bin.sh),
# except that segmentation runs WITHOUT CATMuS recognition (the round-3 ALTO came from `segment -bl ocr -m catmus`;
# the line polygons are blla's either way, and recognition is not needed here).
#   cpu-r4.sh install
#   cpu-r4.sh run <manifest.tsv> <tag> <workers>   → /root/pz/cpu/<tag>/{bin,alto,lines}, arms/calamari-<tag>/out/_bench,
#                                                     timings-<tag>.jsonl (per page: binarize s, segment s), cal-<tag>.json
# GPU hidden (CUDA_VISIBLE_DEVICES=): the GPU is the GLM server's. Each worker is single-threaded (OMP 1), so
# wall seconds per page per worker ≈ CPU seconds per page — the number the GEX45 projection needs.
set -u
W=/root/pz; C=$W/cpu; mkdir -p $C; export CUDA_VISIBLE_DEVICES=
log() { echo "$(date -u +%FT%TZ) $*" >> $C/cpu.log; }
case $1 in
install)
  t0=$(date +%s)
  # uv, not `python3 -m venv`: the Scaleway GPU OS image has no python3-venv (#5924 first attempt: KRAKEN-NOT-INSTALLED)
  ( command -v /root/.local/bin/uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh ) > $C/kraken-install.log 2>&1
  timeout 1800 bash -c "/root/.local/bin/uv venv -p 3.12 $C/kv && VIRTUAL_ENV=$C/kv /root/.local/bin/uv pip install 'kraken==7.1' pillow" >> $C/kraken-install.log 2>&1
  $C/kv/bin/kraken --version >> $C/cpu.log 2>&1 && log "KRAKEN-INSTALLED after $(( $(date +%s) - t0 )) s" || log "KRAKEN-NOT-INSTALLED"
  ( curl -LsSf https://astral.sh/uv/install.sh | sh ) > $C/calamari-install.log 2>&1
  UV=/root/.local/bin/uv
  timeout 1800 bash -c "$UV python install 3.10 && $UV venv -p 3.10 $C/cv && VIRTUAL_ENV=$C/cv $UV pip install 'calamari-ocr==2.3.1'" >> $C/calamari-install.log 2>&1
  ( cd $C && curl -sL -o gt4histocr.tar.gz https://github.com/Calamari-OCR/calamari_models/releases/download/2.2/gt4histocr.tar.gz && tar xzf gt4histocr.tar.gz ) >> $C/calamari-install.log 2>&1
  $C/cv/bin/python -c "import calamari_ocr; print('calamari', calamari_ocr.__version__)" >> $C/cpu.log 2>&1 && log "CALAMARI-INSTALLED; $(VIRTUAL_ENV=$C/cv $UV pip freeze 2>/dev/null | grep -iE '^(tensorflow|tfaip|calamari)' | tr '\n' ' ')" || log "CALAMARI-NOT-INSTALLED"
  log INSTALL-END ;;
fix)  # #5924: re-install Kraken alone (after a failed install), then mark it
  t0=$(date +%s)
  ( command -v /root/.local/bin/uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh ) > $C/kraken-install.log 2>&1
  rm -rf $C/kv; timeout 1800 bash -c "/root/.local/bin/uv venv -p 3.12 $C/kv && VIRTUAL_ENV=$C/kv /root/.local/bin/uv pip install 'kraken==7.1' pillow" >> $C/kraken-install.log 2>&1
  $C/kv/bin/kraken --version >> $C/cpu.log 2>&1 && log "KRAKEN-INSTALLED after $(( $(date +%s) - t0 )) s (fix)" || log "KRAKEN-NOT-INSTALLED (fix)"
  log FIX-END ;;
run)
  MAN=$2; TAG=$3; J=${4:-$(nproc)}; D=$C/$TAG; mkdir -p $D/bin $D/alto $D/logs
  log "run $TAG: $(wc -l < $MAN) pages, $J single-thread workers"
  t0=$(date +%s)
  work() { i=0; while IFS=$'\t' read -r _ slug src; do i=$((i+1)); [ $(( i % J )) -eq $1 ] || continue
      s=$(date +%s.%N)
      [ -s $D/bin/$slug.png ] || OMP_NUM_THREADS=1 timeout 600 $C/kv/bin/kraken -i $W/bench/$src $D/bin/$slug.png binarize > /dev/null 2>> $D/logs/$slug.log
      m=$(date +%s.%N)
      [ -s $D/alto/$slug.xml ] || OMP_NUM_THREADS=1 timeout 900 $C/kv/bin/kraken -a -i $W/bench/$src $D/alto/$slug.xml segment -bl > /dev/null 2>> $D/logs/$slug.log || echo fail > $D/alto/$slug.err
      e=$(date +%s.%N)
      echo "{\"pn\":\"$slug\",\"binarize_s\":$(python3 -c "print(round($m-$s,2))"),\"segment_s\":$(python3 -c "print(round($e-$m,2))")}" >> $C/timings-$TAG.jsonl
    done < $MAN; }
  for k in $(seq 0 $((J-1))); do work $k & done; wait
  t1=$(date +%s)
  $C/kv/bin/python $W/code/alto-lines.py crop $D/alto $W/bench $MAN $D/lines $D/bin >> $C/cpu.log 2>&1
  t2=$(date +%s)
  TF_CPP_MIN_LOG_LEVEL=2 $C/cv/bin/calamari-predict --checkpoint $C/gt4histocr/*.ckpt.json --data.images "$D/lines/*/*.png" --verbose False > $C/calamari-predict-$TAG.log 2>&1 || log "CALAMARI-PREDICT non-zero ($TAG)"
  t3=$(date +%s)
  rm -rf $W/arms/calamari-$TAG; mkdir -p $W/arms/calamari-$TAG
  $C/kv/bin/python $W/code/alto-lines.py join $D/alto $D/lines $W/arms/calamari-$TAG/out/_bench >> $C/cpu.log 2>&1
  echo "{\"tag\":\"$TAG\",\"pages\":$(wc -l < $MAN),\"workers\":$J,\"nproc\":$(nproc),\"lines\":$(ls $D/lines/*/*.png 2>/dev/null | wc -l),\"preds\":$(ls $D/lines/*/*.pred.txt 2>/dev/null | wc -l),\"kraken_wall_secs\":$((t1-t0)),\"crop_wall_secs\":$((t2-t1)),\"calamari_wall_secs\":$((t3-t2)),\"segmentation\":\"kraken 7.1 blla default\",\"binarization\":\"kraken nlbin default\"}" > $W/arms/calamari-$TAG/arm-run.json
  cp $C/timings-$TAG.jsonl $W/arms/calamari-$TAG/timings.jsonl
  log "RUN-END $TAG $(cat $W/arms/calamari-$TAG/arm-run.json)" ;;
esac
