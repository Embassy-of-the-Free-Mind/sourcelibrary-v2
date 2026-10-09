#!/usr/bin/env python3
"""#5660 round 3, CPU arms: from Kraken's ALTO (one per page)
  text  <alto dir> <out dir>           Kraken's own text: TextLine order, String CONTENTs joined by spaces
  crop  <alto dir> <bench dir> <manifest> <lines dir> [<binarized page dir>]   (binarized: <dir>/<slug>.png, Kraken nlbin)
        one grey PNG per TextLine for Calamari: the line polygon's bounding box, pixels outside the polygon
        set to white (so neighbouring lines' ascenders/descenders do not enter), 2 px pad
  join  <alto dir> <lines dir> <out dir>   Calamari's <line>.pred.txt per page, in line order, joined by newlines
Both recognisers therefore read the SAME segmentation (Kraken blla, default model).
"""
import os, re, sys
import xml.etree.ElementTree as ET


def lines_of(path):
    root = ET.parse(path).getroot()
    out = []
    for tl in root.iter():
        if not tl.tag.endswith('TextLine'): continue
        words = [s.get('CONTENT', '') for s in tl if s.tag.endswith('String')]
        poly = None
        for el in tl.iter():
            if el.tag.endswith('Polygon') and el.get('POINTS'):
                nums = [float(x) for x in re.split(r'[\s,]+', el.get('POINTS').strip()) if x]
                poly = list(zip(nums[0::2], nums[1::2])); break
        box = tuple(int(float(tl.get(k, 0))) for k in ('HPOS', 'VPOS', 'WIDTH', 'HEIGHT'))
        out.append({'text': ' '.join(w for w in words if w), 'poly': poly, 'box': box})
    return out


cmd = sys.argv[1]
if cmd == 'text':
    a, o = sys.argv[2:4]; os.makedirs(o, exist_ok=True); n = 0
    for f in sorted(os.listdir(a)):
        if f.endswith('.xml'):
            open(os.path.join(o, f[:-4] + '.txt'), 'w').write('\n'.join(l['text'] for l in lines_of(os.path.join(a, f)))); n += 1
        elif f.endswith('.err'):
            open(os.path.join(o, f[:-4] + '.txt'), 'w').write(''); n += 1   # a failed page is an empty output, never a missing one
    print('kraken text pages', n)
elif cmd == 'crop':
    from PIL import Image, ImageDraw
    a, bench, man, L = sys.argv[2:6]; BIN = sys.argv[6] if len(sys.argv) > 6 else None; n = 0
    for row in open(man):
        if not row.strip(): continue
        _, slug, src = row.rstrip('\n').split('\t')
        x = os.path.join(a, slug + '.xml')
        if not os.path.exists(x): continue
        im = Image.open(os.path.join(BIN, slug + '.png') if BIN else os.path.join(bench, src)).convert('L'); d = os.path.join(L, slug); os.makedirs(d, exist_ok=True)
        for i, l in enumerate(lines_of(x)):
            if l['poly'] and len(l['poly']) >= 3:
                xs = [p[0] for p in l['poly']]; ys = [p[1] for p in l['poly']]
                x0, y0, x1, y1 = max(0, int(min(xs)) - 2), max(0, int(min(ys)) - 2), min(im.width, int(max(xs)) + 2), min(im.height, int(max(ys)) + 2)
                if x1 - x0 < 4 or y1 - y0 < 4: continue
                crop = im.crop((x0, y0, x1, y1)); mask = Image.new('L', crop.size, 0)
                ImageDraw.Draw(mask).polygon([(p[0] - x0, p[1] - y0) for p in l['poly']], fill=255)
                white = Image.new('L', crop.size, 255); crop = Image.composite(crop, white, mask)
            else:
                h, v, w, ht = l['box']
                if w < 4 or ht < 4: continue
                crop = im.crop((h, v, h + w, v + ht))
            crop.save(os.path.join(d, f'{slug}__{i:05d}.png')); n += 1   # unique basenames: Calamari keys .pred.txt by basename
    print('line crops', n)
elif cmd == 'join':
    a, L, o = sys.argv[2:5]; os.makedirs(o, exist_ok=True); n = 0
    for slug in sorted(f[:-4] for f in os.listdir(a) if f.endswith('.xml') or f.endswith('.err')):
        d = os.path.join(L, slug)
        preds = sorted(f for f in os.listdir(d) if f.endswith('.pred.txt')) if os.path.isdir(d) else []
        open(os.path.join(o, slug + '.txt'), 'w').write('\n'.join(open(os.path.join(d, f)).read().strip('\n') for f in preds)); n += 1
    print('calamari pages', n)
