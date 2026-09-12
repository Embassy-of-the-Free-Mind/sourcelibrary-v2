#!/bin/bash
cd "$(dirname "$0")"
mkdir -p z
for id in ita-bnc-ald-00000688-001 ita-bnc-ald-00000187-001; do
  short=${id:17:3}
  for n in 11 19 27 35 43 51 59 67 75 83 91 99; do
    f=z/ia_${short}_n$n.jpg
    [ -f $f ] || curl -sL -o $f "https://archive.org/download/$id/page/n$n/full/full/0/default.jpg"
  done
done
python3 - <<'EOF'
import glob, os
from PIL import Image
for f in sorted(glob.glob('z/*.jpg')):
    try: Image.open(f).load()
    except Exception as e: print('bad', f); os.remove(f)
print(len(glob.glob('z/*.jpg')), 'ok')
EOF
