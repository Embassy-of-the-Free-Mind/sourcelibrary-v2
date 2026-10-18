# PRIOR ART: scripts/eval/mongol-synth-5664/segment.py cuts pages into columns; nothing cuts columns into words.
# Cut word crops from every column in a column set (#5664, mongol-selfgt). Files only.
import json, sys, os, wordseg
from PIL import Image
from multiprocessing import Pool
SRC, OUT = sys.argv[1], sys.argv[2]   # SRC has columns.jsonl + img/ ; OUT gets words.jsonl + w/
os.makedirs(f'{OUT}/w', exist_ok=True)
cols = [json.loads(l) for l in open(f'{SRC}/columns.jsonl')]
def work(c):
    im = Image.open(f'{SRC}/{c["image"]}').convert('RGB')
    segs, s, r = wordseg.segment(im)
    segs = [(a, b, m) for a, b, m in segs if b - a >= 6 and not (a < 4 and b - a < 14) and not (b > im.width - 4 and b - a < 14)]
    rows = []
    for i, (a, b, m) in enumerate(segs):
        cx = (a + b) // 2; sp = int(r[min(cx, len(r) - 1)])
        wid = f'{c["id"].replace("/", "_")}_w{i:02d}'
        crop = im.crop((max(0, a - 2), 0, min(im.width, b + 2), im.height))
        crop.save(f'{OUT}/w/{wid}.png')
        rows.append({'wid': wid, 'col': c['id'], 'i': i, 'x0': a, 'x1': b, 'spine': sp, 'mass': round(m, 1)})
    return rows
with Pool(8) as p, open(f'{OUT}/words.jsonl', 'w') as f:
    n = 0
    for rows in p.imap(work, cols, chunksize=16):
        for r in rows: f.write(json.dumps(r) + '\n'); n += 1
print('columns', len(cols), 'words', n)
