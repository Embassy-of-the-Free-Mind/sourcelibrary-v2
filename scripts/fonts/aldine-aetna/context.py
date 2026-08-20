"""context.py OUT.png [PREFIX] idx...  — show each cluster medoid in its word context on the page."""
import json, sys, os, numpy as np
from PIL import Image, ImageDraw
os.chdir(os.path.dirname(os.path.abspath(__file__)))
prefix = sys.argv[2] if sys.argv[2].endswith('_') else ''
args = sys.argv[3:] if prefix else sys.argv[2:]
data = np.load(prefix + 'glyphs.npz', allow_pickle=True); meta = data['meta']
clusters = json.load(open(prefix + 'clusters.json'))
pages = {}
tiles = []
for a in args:
    c = clusters[int(a)]; g = meta[c['medoid']]
    p = g['page']
    if p not in pages:
        f = p + '.jpg'
        if not os.path.exists(f): f = 'extra/' + f
        if not os.path.exists(f): f = 'y/' + p[3:] + '.jpg' if p.startswith('ia_') else f
        if not os.path.exists(f): f = 'y/' + p + '.jpg'
        if not os.path.exists(f): f = 'z/' + p + '.jpg'
        pages[p] = Image.open(f).convert('L')
    im = pages[p]
    X0 = g['offx'] + g['x0']; X1 = g['offx'] + g['x1']; Y0 = g['offy'] + g['y0']; Y1 = g['offy'] + g['y1']
    crop = im.crop((X0 - 260, Y0 - 40, X1 + 260, Y1 + 40)).convert('RGB')
    d = ImageDraw.Draw(crop); d.rectangle((258, 38, 260 + X1 - X0 + 2, 40 + Y1 - Y0 + 2), outline=(255, 0, 0), width=3)
    d.text((4, 4), f'{a} n={c["n"]}', fill=(255, 0, 0))
    tiles.append(crop)
W = max(t.width for t in tiles); H = sum(t.height for t in tiles)
sheet = Image.new('RGB', (W, H), 'white'); y = 0
for t in tiles: sheet.paste(t, (0, y)); y += t.height
sheet.save(sys.argv[1])
