"""Whish 147 Kraken line model (#7119): contrast-normalise line images (ink dark on white) before training/reading.
PRIOR ART: segment.py's ink() uses the same background division to find ink; here the ratio is kept as a grey image.
The palm leaf is mid-grey with darker strokes; ketos trained on the raw strips collapsed to one output string.
Usage: python normalize.py <in dir> <out dir>      (every *.png)
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
src, out = Path(sys.argv[1]), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
for f in sorted(src.glob('*.png')):
    o = out / f.name
    if o.exists(): continue
    im = Image.open(f).convert('L'); g = np.asarray(im, dtype=np.float32)
    bg = np.asarray(im.filter(ImageFilter.BoxBlur(25)), dtype=np.float32) + 1
    r = np.clip((g / bg - 0.55) / 0.40, 0, 1)
    Image.fromarray((r * 255).astype(np.uint8)).save(o)
