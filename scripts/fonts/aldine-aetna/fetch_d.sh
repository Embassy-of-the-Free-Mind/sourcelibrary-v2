#!/bin/bash
cd "$(dirname "$0")"
mkdir -p d
fetch() { f=d/ia_${1:17:3}_n$2.jpg; [ -f $f ] || curl -sL -o $f "https://archive.org/download/$1/page/n$2/full/full/0/default.jpg"; }
fetch ita-bnc-ald-00000137-001 28
fetch ita-bnc-ald-00000001-001 21
fetch ita-bnc-ald-00000001-001 25
fetch ita-bnc-ald-00000006-001 19
fetch ita-bnc-ald-00000920-001 69
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('d/*.jpg')):
    try:
        im = Image.open(f); im.load(); w, h = im.size
        c = im.crop((int(w*0.1), int(h*0.08), int(w*0.9), int(h*0.5))); c.thumbnail((1400, 1400))
        c.save(f.replace('d/', 'look_d_').replace('.jpg', '.png')); print(f, im.size)
    except Exception as e: print('bad', f, e); os.remove(f)
EOF
