#!/bin/bash
# 1497 Aldines set in the same Griffo roman as De Aetna: Leoniceno (690), Maiolo Epiphyllides (691), Maiolo De gradibus (692)
cd "$(dirname "$0")"
mkdir -p y
for id in ita-bnc-ald-00000690-001 ita-bnc-ald-00000691-001 ita-bnc-ald-00000692-001; do
  short=${id:17:3}
  for n in 9 15 21 27 33 39 45 51 57 63; do
    f=y/ia_${short}_n$n.jpg
    [ -f $f ] || curl -sL -o $f "https://archive.org/download/$id/page/n$n/full/full/0/default.jpg"
  done
done
python3 -c "
from PIL import Image; import glob
bad=0
for f in sorted(glob.glob('y/*.jpg')):
    try: print(f, Image.open(f).size)
    except Exception as e: print(f,'BAD'); bad+=1
print('bad',bad)"
