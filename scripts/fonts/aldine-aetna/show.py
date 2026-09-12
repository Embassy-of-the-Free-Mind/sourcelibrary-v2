"""show.py OUT.png idx...  — render cluster medoids (or all members with m:IDX) at full res."""
import json, sys, numpy as np
from PIL import Image, ImageDraw
data = np.load('glyphs.npz', allow_pickle=True); masks = data['masks']
clusters = json.load(open('clusters.json'))
items = []
for a in sys.argv[2:]:
    if a.startswith('m:'):
        c = clusters[int(a[2:])]; items += [(f'{a} #{i}', i) for i in c['members'][:40]]
    else:
        items.append((a, clusters[int(a)]['medoid']))
cell = 130; per = 10
rows = (len(items) + per - 1) // per
sheet = Image.new('L', (per * cell, rows * (cell + 16)), 255); dr = ImageDraw.Draw(sheet)
for k, (lab, idx) in enumerate(items):
    m = masks[idx]; im = Image.fromarray(((~m) * 255).astype(np.uint8))
    r, c = divmod(k, per)
    sheet.paste(im, (c * cell + (cell - im.width) // 2, r * (cell + 16) + (cell - im.height) // 2))
    dr.text((c * cell + 2, r * (cell + 16) + cell), lab, fill=0)
sheet.save(sys.argv[1])
