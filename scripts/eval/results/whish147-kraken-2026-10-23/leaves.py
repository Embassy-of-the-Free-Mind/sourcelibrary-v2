"""Whish 147 Kraken line model (#7119): full-resolution leaf crops for segmentation and training.
PRIOR ART: ../whish147-best-attempt-2026-10-22/leafimg.py — same boxes.json leaf boxes; that script downsizes each leaf to
2,600 px for the model probes, this one keeps full resolution (rows are ~130 px tall there) and writes greyscale PNG.
Usage: python leaves.py <scan-image dir> <out dir>
"""
import json, sys
from pathlib import Path
from PIL import Image
src, out = Path(sys.argv[1]), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
b = json.loads((Path(__file__).parent.parent / 'whish147-best-attempt-2026-10-22' / 'boxes.json').read_text())
for n, r in b.items():
    im = None
    for name, h in r['leaves'].items():
        o = out / f'{n}-{name}.png'
        if o.exists(): continue
        im = im or Image.open(src / f'{n}.jpg')
        x0, y0, _, y1 = h['L']; x1 = h['R'][2]
        im.crop((x0, y0, x1, y1)).convert('L').save(o)
