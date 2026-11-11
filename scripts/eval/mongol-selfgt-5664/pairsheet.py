# PRIOR ART: sheet2.py (cluster sheets); this pairs a crop with its label rendered in the training font.
# Crop beside its assigned label, rendered horizontally in Noto Sans Mongolian (same orientation as the crops).
import json, sys, random
from PIL import Image, ImageDraw, ImageFont, ImageOps
D, pairs, out, n, seed = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
key = sys.argv[6] if len(sys.argv) > 6 else 'read'
F = ImageFont.truetype('NotoSansMongolian-Regular.ttf', 40, layout_engine=ImageFont.Layout.RAQM)
P = [json.loads(l) for l in open(pairs)]; random.seed(seed); P = random.sample(P, min(n, len(P)))
rows = []
for p in P:
    im = ImageOps.autocontrast(Image.open(f'{D}/w/{p["wid"]}.png').convert('L'), cutoff=1)
    t = p[key]; l, tp, r, b = F.getbbox(t, language='mn')
    lab = Image.new('L', (r - l + 20, 84), 255); ImageDraw.Draw(lab).text((10 - l, 10), t, font=F, fill=0, language='mn')
    row = Image.new('L', (40 + im.width + 20 + lab.width, 86), 255); d = ImageDraw.Draw(row)
    d.text((2, 30), f'{len(rows):02d}', fill=0); row.paste(im, (40, 0)); row.paste(lab, (40 + im.width + 20, 0)); rows.append(row)
cols = 2; per = (len(rows) + cols - 1) // cols; W = max(r.width for r in rows)
s = Image.new('L', (cols * (W + 20), per * 88), 220)
for i, r in enumerate(rows): s.paste(r, ((i // per) * (W + 20), (i % per) * 88))
s.save(out, quality=90)
