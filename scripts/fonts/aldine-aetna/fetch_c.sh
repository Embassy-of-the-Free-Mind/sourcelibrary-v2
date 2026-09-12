#!/bin/bash
cd "$(dirname "$0")"
mkdir -p c
for n in 10 11 12 14 16; do
  f=c/ia_693_n$n.jpg
  [ -f $f ] || curl -sL -o $f "https://archive.org/download/ita-bnc-ald-00000693-001/page/n$n/full/full/0/default.jpg"
done
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('c/*.jpg')):
    try:
        im = Image.open(f); im.load(); w, h = im.size; print(f, im.size)
    except Exception as e: print('bad', f, e); os.remove(f)
im = Image.open('c/ia_693_n11.jpg'); w, h = im.size
c = im.crop((int(w*0.08), int(h*0.1), int(w*0.6), int(h*0.4))); c.thumbnail((1400, 1400)); c.save('look_c11.png')
EOF
