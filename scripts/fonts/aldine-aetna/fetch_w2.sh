#!/bin/bash
cd "$(dirname "$0")"
mkdir -p w k
[ -f k/ia_039_n61.jpg ] || mv w/ia_039_n61.jpg k/ 2>/dev/null
rm -f w/ia_690_n27.jpg w/ia_691_n85.jpg
for n in 252 254 286 287 289 290 292 293 299 301; do
  f=w/ia_688_n$n.jpg
  [ -f $f ] || curl -sL -o $f "https://archive.org/download/ita-bnc-ald-00000688-001/page/n$n/full/full/0/default.jpg"
done
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('w/*.jpg') + glob.glob('k/*.jpg')):
    try: Image.open(f).load()
    except Exception: print('bad', f); os.remove(f)
print(len(glob.glob('w/*.jpg')), 'w pages;', len(glob.glob('k/*.jpg')), 'k pages')
EOF
