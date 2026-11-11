# PRIOR ART: scripts/eval/mongol-synth-5664/render.py --sheet makes render contact sheets; this makes cluster sheets of real crops.
# Readable purity sheets: for each picked cluster, 12 random members at native height (84 px), contrast-stretched,
# in 2 rows of 6; 5 clusters per sheet (#5664, mongol-selfgt).
import json, sys, random
from collections import defaultdict
from PIL import Image, ImageDraw, ImageOps
D, tag, outp, seed = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
C = defaultdict(list)
for l in open(f'{D}/clusters-{tag}.jsonl'):
    r = json.loads(l); C[r['c']].append(r['wid'])
import os
minw = int(os.environ.get('MINW', 0))
if minw:
    wid_w = {}
    for l in open(f'{D}/words.jsonl'):
        r = json.loads(l); wid_w[r['wid']] = r['x1'] - r['x0']
    C = {c: m for c, m in C.items() if sorted(wid_w[w] for w in m)[len(m) // 2] >= minw}
top = sorted(C, key=lambda c: -len(C[c]))[:200]
random.seed(seed); pick = random.sample(top, 20)
members = {}
for k in range(4):
    blocks = []
    for c in pick[k * 5:(k + 1) * 5]:
        ms = random.sample(C[c], min(12, len(C[c]))); members[c] = ms
        ims = [ImageOps.autocontrast(Image.open(f'{D}/w/{w}.png').convert('L'), cutoff=1) for w in ms]
        cw = min(260, max(i.width for i in ims)) + 6
        b = Image.new('L', (120 + 6 * cw, 2 * 88 + 6), 255); d = ImageDraw.Draw(b)
        d.text((4, 30), f'#{pick.index(c):02d} c{c}\nn={len(C[c])}', fill=0)
        for j, im in enumerate(ims):
            b.paste(im.crop((0, 0, min(im.width, cw - 6), im.height)), (120 + (j % 6) * cw, (j // 6) * 88))
        blocks.append(b)
    W = max(b.width for b in blocks); s = Image.new('L', (W, sum(b.height + 10 for b in blocks)), 200); y = 0
    for b in blocks: s.paste(b, (0, y)); y += b.height + 10
    s.save(f'{outp}-{k}.jpg', quality=92)
json.dump({'pick': pick, 'members': members}, open(f'{outp}.json', 'w'))
