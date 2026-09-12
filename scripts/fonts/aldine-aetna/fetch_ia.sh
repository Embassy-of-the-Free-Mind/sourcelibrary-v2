#!/bin/bash
cd "$(dirname "$0")"
for n in 19 23 29 39 45 51; do
  [ -f ia$n.jpg ] || curl -sL -o ia$n.jpg "https://archive.org/download/ita-bnc-ald-00000673-001/page/n$n/full/full/0/default.jpg"
  python3 -c "from PIL import Image; print('ia$n', Image.open('ia$n.jpg').size)"
done
