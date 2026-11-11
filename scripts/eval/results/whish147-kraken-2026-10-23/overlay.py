"""Whish 147 Kraken line model (#7119): contact sheet of segment.py rows drawn over their leaves (the by-eye check).
PRIOR ART: none for row overlays (../whish147-best-attempt-2026-10-22/ has no row segmentation to draw).
Usage: python overlay.py <seg dir> <leaf dir> <out.jpg> <leaf> …
"""
import json, sys
from PIL import Image, ImageDraw
d, leaves, out = sys.argv[1], sys.argv[2], sys.argv[3]
ims = []
for k in sys.argv[4:]:
    m = json.load(open(f'{d}/{k}.seg.json')); im = Image.open(f'{leaves}/{k}.png').convert('RGB'); im = im.rotate(m.get('deskew', 0), resample=Image.BICUBIC) if m.get('deskew') else im; dr = ImageDraw.Draw(im)
    e = m['edges']; half = int(m['pitch'] * 0.55)
    for j, cs in enumerate(m['centres']):
        pts = [((e[i] + e[i + 1]) // 2, c) for i, c in enumerate(cs)]
        dr.line(pts, fill=(255, 0, 0), width=5)
        dr.line([(x, y - half) for x, y in pts], fill=(0, 160, 255), width=2)
        dr.text((10, pts[0][1] - 20), str(j + 1), fill=(255, 255, 0))
    ims.append(im.resize((im.width // 3, im.height // 3)))
W = max(i.width for i in ims); H = sum(i.height for i in ims)
s = Image.new('RGB', (W, H)); y = 0
for i in ims: s.paste(i, (0, y)); y += i.height
s.save(out, quality=80)
