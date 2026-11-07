#!/bin/bash
# Whish 147 Kraken line model (#7119): training dirs (image + .gt.txt) and binary datasets from splits.tsv, on gex45.
# PRIOR ART: none (ketos `path` format and `ketos compile`, kraken 7.1.1). Run in /root/jobs/whish147-kraken after
# segment.py (lines/) and normalize.py (n-lines/). `--force-type baseline` turns off ketos' legacy centre-line
# normaliser for line strips: in `path` mode it ran on the CPU for every line (GPU at 0%) and the raw-strip runs
# collapsed (v1, see the experiment file).
set -euo pipefail
cd /root/jobs/whish147-kraken; source /root/bench/kraken/bin/activate
python3 - <<'PY'
import os
for l in open("splits.tsv"):
    s, name, cer, t = l.rstrip("\n").split("\t")
    d = f"train-n/{s}"; os.makedirs(d, exist_ok=True)
    p = f"{d}/{name}.png"
    if not os.path.exists(p): os.symlink(os.path.abspath(f"n-lines/{name}.png"), p)
    open(f"{d}/{name}.gt.txt", "w").write(t)
PY
mkdir -p ds
for s in val n100 n300 all; do
  ls train-n/$s/*.png > nlist-$s.txt
  ketos --workers 4 compile -f path --force-type baseline -F nlist-$s.txt -o ds/$s.arrow > logs/compile-$s.log 2>&1
done
echo "$PWD/ds/val.arrow" > ds/val.arrow.list
