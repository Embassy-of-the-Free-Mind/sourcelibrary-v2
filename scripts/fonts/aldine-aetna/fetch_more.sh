#!/bin/bash
cd "$(dirname "$0")"
for n in 9 11 13 15 17 21 25 27 31 33 35 37; do
  [ -f ia$n.jpg ] || curl -sL -o ia$n.jpg "https://archive.org/download/ita-bnc-ald-00000673-001/page/n$n/full/full/0/default.jpg"
done
ls ia*.jpg | wc -l
