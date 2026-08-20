#!/bin/bash
cd "$(dirname "$0")"
mkdir -p w
fetch() { # id leaf
  f=w/ia_${1:17:3}_n$2.jpg
  [ -f $f ] || curl -sL -o $f "https://archive.org/download/$1/page/n$2/full/full/0/default.jpg"
}
fetch ita-bnc-ald-00000039-001 61
fetch ita-bnc-ald-00000688-001 291
fetch ita-bnc-ald-00000688-001 300
fetch ita-bnc-ald-00000688-001 253
fetch ita-bnc-ald-00000688-001 285
fetch ita-bnc-ald-00000691-001 85
fetch ita-bnc-ald-00000690-001 27
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('w/*.jpg')):
    try: print(f, Image.open(f).size)
    except Exception as e: print('bad', f); os.remove(f)
EOF
