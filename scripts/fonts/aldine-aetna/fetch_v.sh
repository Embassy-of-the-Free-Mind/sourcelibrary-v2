#!/bin/bash
# lowercase z (ſyllogizari, Maiolo De gradibus p49) and k (Ockham, Maiolo Epiphyllides p56)
cd "$(dirname "$0")"
mkdir -p v
fetch() { f=v/ia_${1:17:3}_n$2.jpg; [ -f $f ] || curl -sL -o $f "https://archive.org/download/$1/page/n$2/full/full/0/default.jpg"; }
fetch ita-bnc-ald-00000692-001 48
fetch ita-bnc-ald-00000691-001 55
fetch ita-bnc-ald-00000692-001 28
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('v/*.jpg')):
    try: Image.open(f).load(); print(f, Image.open(f).size)
    except Exception: print('bad', f); os.remove(f)
EOF
NOCLUSTER=1 GLOB='v/*.jpg' PREFIX=v_ python3 segment.py 2>&1 | tail -1
BOX=1 HMIN=98 HMAX=125 WMIN=52 WMAX=85 LIMIT=320 python3 capsheet.py box_vk1.png v_
BOX=1 HMIN=98 HMAX=125 WMIN=52 WMAX=85 SKIP=320 LIMIT=320 python3 capsheet.py box_vk2.png v_
BOX=1 HMIN=56 HMAX=76 WMIN=46 WMAX=66 LIMIT=320 python3 capsheet.py box_vz1.png v_
BOX=1 HMIN=56 HMAX=76 WMIN=46 WMAX=66 SKIP=320 LIMIT=320 python3 capsheet.py box_vz2.png v_
BOX=1 HMIN=56 HMAX=76 WMIN=46 WMAX=66 SKIP=640 LIMIT=320 python3 capsheet.py box_vz3.png v_
