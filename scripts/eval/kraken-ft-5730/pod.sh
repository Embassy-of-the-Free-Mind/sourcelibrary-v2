#!/bin/bash
# PRIOR ART: /root/paddle-zh-5600 `paddle-zh-runpod.sh` + `paddle-zh-box.sh` (#5600: create/push/ssh/pull/terminate a
# RunPod pod under the sl-5600- deadline watchdog — used as is, from the host side) and the #5660 olmOCR driver
# (`run.sh`: one arm on one pod). Neither trains a model; this is the pod-side half for the Kraken fine-tune (#5730).
#
# Runs ON THE POD, under /root/kf. Steps are idempotent (each leaves a marker) so a re-run resumes:
#   setup     venv + kraken 7.1 (torch from kraken's own pin), CUDA check, base model in place
#   fetch     training page images from R2 (manifest train.tsv: book<TAB>page<TAB>url), resized to width ≤ 2400, JPEG q92
#             (the benchmark-seal.mjs rule, so training and test images share a resolution)
#   read      blla segmentation + CATMuS-Print read of every training page → alto/<book>/<page>.xml (GPU)
#   align     align_lines.py per book → train/<book>/*.xml + stats/<book>.json
#   compile   ketos compile → train.arrow / val.arrow (val = 5 % of pages, seeded)
#   train     ketos train fine-tuning catmus-print-fondue-large (resize union), early stopping
#   test      blla segmentation of the sealed test images once, then CATMuS and the fine-tuned model on the SAME lines
set -u
W=/root/kf; cd $W
K=$W/venv/bin
BASE=$W/models/catmus-print-fondue-large.mlmodel
log() { echo "$(date -u +%FT%TZ) $*" | tee -a $W/pod.log; }

case ${1:-} in
setup)
  [ -f $W/.setup ] && exit 0
  (command -v rsync >/dev/null && dpkg -s libgl1 >/dev/null 2>&1) || (apt-get -qq update && apt-get -qq install -y rsync libgl1 libglib2.0-0 python3-venv parallel >/dev/null 2>&1)
  python3 -m venv $W/venv && $K/pip install -q --upgrade pip && $K/pip install -q "kraken==7.1" edlib lxml pillow >> $W/setup.log 2>&1
  # kraken pins its torch; if that wheel's CUDA is newer than the pod's driver, reinstall the same torch from a cu12x index
  if ! $K/python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"; then
    TV=$($K/python -c "import torch;print(torch.__version__.split('+')[0])")
    for cu in cu129 cu128 cu126; do $K/pip install -q --force-reinstall --no-deps "torch==$TV" --index-url https://download.pytorch.org/whl/$cu >> $W/setup.log 2>&1 && $K/python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" && { log "torch $TV from $cu"; break; }; done
  fi
  $K/python -c "import torch,kraken; print('torch',torch.__version__,'cuda',torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" | tee -a $W/pod.log
  $K/pip freeze | grep -iE "^(kraken|torch|lightning|pytorch-lightning)==" | tee $W/versions.txt
  touch $W/.setup ;;
fetch)
  [ -f $W/.fetch ] && exit 0
  mkdir -p $W/img
  $K/python - <<'PY'
import os, io, sys, urllib.request, concurrent.futures as cf
from PIL import Image
W = '/root/kf'
rows = [l.rstrip('\n').split('\t') for l in open(f'{W}/train.tsv') if l.strip()]
def one(r):
    book, page, url = r
    d = f'{W}/img/{book}'; os.makedirs(d, exist_ok=True)
    f = f'{d}/{page}.jpg'
    if os.path.exists(f): return 'cached'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'SourceLibrary-eval/1.0 (kraken fine-tune #5730; +https://sourcelibrary.org)'})
            with urllib.request.urlopen(req, timeout=120) as resp: b = resp.read()
            im = Image.open(io.BytesIO(b)); im.load()
            if im.mode not in ('L', 'RGB'): im = im.convert('RGB')
            if im.width > 2400: im = im.resize((2400, round(im.height * 2400 / im.width)), Image.LANCZOS)
            im.save(f, 'JPEG', quality=92); return 'ok'
        except Exception as e:  # noqa
            err = str(e)[:80]
    return 'fail ' + err
with cf.ThreadPoolExecutor(24) as ex:
    res = list(ex.map(one, rows))
from collections import Counter
print(Counter(r.split()[0] for r in res))
PY
  log "fetch: $(find $W/img -name '*.jpg' | wc -l) images"
  touch $W/.fetch ;;
read)
  # Kraken's CLI is single-threaded and CPU-bound here (blla vectorisation, line extraction): N readers share the GPU,
  # N = the container's CPU quota (7.65 cores on the A40 pod). Pages are dealt round-robin; a page already read is skipped.
  mkdir -p $W/alto
  N=${READERS:-7}
  find $W/img -name '*.jpg' | sort | awk -v n=$N '{print > "/root/kf/readq-" (NR % n)}'
  for k in $(seq 0 $((N-1))); do (
    todo=(); while read f; do b=$(basename $(dirname $f)); p=$(basename $f .jpg); mkdir -p $W/alto/$b; [ -s $W/alto/$b/$p.xml ] || todo+=("-i" "$f" "$W/alto/$b/$p.xml"); done < $W/readq-$k
    [ ${#todo[@]} -gt 0 ] && $K/kraken -d cuda:0 -a "${todo[@]}" segment -bl ocr -m $BASE > $W/read-$k.log 2>&1
    log "reader $k done" ) & done; wait
  log "read: $(find $W/alto -name '*.xml' | wc -l) alto total" ;;
align)
  mkdir -p $W/train $W/stats
  ls $W/alto | xargs -P ${READERS:-7} -I{} sh -c "$K/python $W/code/align_lines.py --map=$W/map/{}.json --alto-dir=$W/alto/{} --img-dir=$W/img/{} --out=$W/train/{} --stats=$W/stats/{}.json 2>&1 | tail -1 >> $W/align.log"
  log "align: $(find $W/train -name '*.xml' | wc -l) training pages" ;;
compile)
  find $W/train -name '*.xml' | sort > $W/all.txt
  $K/python -c "
import random; L=open('$W/all.txt').read().split(); random.Random(5730).shuffle(L); n=max(1,len(L)//20)
open('$W/val.txt','w').write('\n'.join(sorted(L[:n]))+'\n'); open('$W/tr.txt','w').write('\n'.join(sorted(L[n:]))+'\n'); print(len(L)-n,'train pages',n,'val pages')" | tee -a $W/pod.log
  $K/ketos --workers 8 compile -f alto -o $W/train.arrow -F $W/tr.txt > $W/compile.log 2>&1
  $K/ketos --workers 8 compile -f alto -o $W/val.arrow -F $W/val.txt >> $W/compile.log 2>&1
  log "compile: $(tail -n 3 $W/compile.log | tr '\n' ' ')" ;;
train)
  mkdir -p $W/model
  echo $W/train.arrow > $W/tr-bin.txt; echo $W/val.arrow > $W/val-bin.txt
  $K/ketos -d cuda:0 --workers 8 --threads 4 -s 5730 train -f binary -i $BASE --resize union -u NFD -B ${BATCH:-16} -r ${LR:-0.0001} --warmup 500 \
    -q early --lag ${LAG:-5} --min-epochs 3 -N ${EPOCHS:-30} --augment -o $W/model/ft \
    -t $W/tr-bin.txt -e $W/val-bin.txt > $W/train.log 2>&1
  log "train exit $?: $(ls $W/model | tail -n 5 | tr '\n' ' ')" ;;
test)
  # sealed test images in $W/test/img/<slug>.jpg; one segmentation, two recognisers
  mkdir -p $W/test/seg $W/test/out/kraken-catmus $W/test/out/kraken-ft-5730
  M=${MODEL:?MODEL=<fine-tuned model path>}
  for f in $W/test/img/*.jpg; do s=$(basename $f .jpg)
    [ -s $W/test/seg/$s.xml ] || $K/kraken -d cuda:0 -a -i $f $W/test/seg/$s.xml segment -bl >> $W/test/seg.log 2>&1
  done
  for arm in kraken-catmus kraken-ft-5730; do mm=$BASE; [ $arm = kraken-ft-5730 ] && mm=$M
    t0=$(date +%s.%N)
    for f in $W/test/seg/*.xml; do s=$(basename $f .xml)
      [ -s $W/test/out/$arm/$s.txt ] || $K/kraken -d cuda:0 -f xml -i $f $W/test/out/$arm/$s.txt ocr -m $mm >> $W/test/ocr-$arm.log 2>&1
    done
    log "test $arm: $(ls $W/test/out/$arm | wc -l) pages in $(echo "$(date +%s.%N) - $t0" | bc) s"
  done ;;
*) echo "usage: pod.sh setup|fetch|read|align|compile|train|test"; exit 2 ;;
esac
