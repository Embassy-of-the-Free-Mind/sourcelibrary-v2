"""capsheet.py OUT.png PREFIX [members:IDX]  — tall non-descending cluster medoids at a common scale."""
import json, sys, os, numpy as np
from PIL import Image, ImageDraw
os.chdir(os.path.dirname(os.path.abspath(__file__)))
out, prefix = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else '')
data = np.load(prefix + 'glyphs.npz', allow_pickle=True); masks, meta = data['masks'], data['meta']
clusters = json.load(open(prefix + 'clusters.json'))
items = []
if len(sys.argv) > 3 and sys.argv[3].startswith('members:'):
    c = clusters[int(sys.argv[3][8:])]
    items = [(f'#{i}', i) for i in c['members']]
else:
    for ci, c in enumerate(clusters):
        g = meta[c['medoid']]; h = g['y1'] - g['y0']; asc = g['base'] - g['y0']; desc = g['y1'] - g['base']
        w = g['x1'] - g['x0']
        if os.environ.get('PAGE') and not g['page'].startswith(os.environ['PAGE']): continue
        if os.environ.get('BOX') and (int(os.environ.get('HMIN','90')) <= h <= int(os.environ.get('HMAX','130')) and int(os.environ.get('WMIN','70')) <= w <= int(os.environ.get('WMAX','140'))): items.append((f'{ci}:{c["n"]}', c['medoid'])); continue
        if os.environ.get('BOX'): continue
        if asc >= 88 and desc <= 22 and 28 <= w < 50 and int(os.environ.get("NARROW","0")) or (not int(os.environ.get("NARROW","0")) and asc >= 88 and desc <= 22 and w >= 50): items.append((f'{ci}:{c["n"]}', c['medoid']))
cell = 100; per = 14; sc = 0.6
items = items[int(os.environ.get('SKIP','0')):int(os.environ.get('SKIP','0'))+int(os.environ.get('LIMIT','100000'))]
rows = (len(items) + per - 1) // per
sheet = Image.new('L', (per * cell, max(1, rows) * (cell + 16)), 255); d = ImageDraw.Draw(sheet)
for k, (lab, idx) in enumerate(items):
    m = masks[idx]; im = Image.fromarray(((~m) * 255).astype(np.uint8))
    im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))))
    r, c = divmod(k, per)
    sheet.paste(im, (c * cell + (cell - im.width) // 2, r * (cell + 16) + (cell - im.height) // 2))
    d.text((c * cell + 2, r * (cell + 16) + cell), lab, fill=0)
sheet.save(out); print(len(items), 'items')
