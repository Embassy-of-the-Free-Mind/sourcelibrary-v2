"""Find the leaves on each Whish 147 scan and cut each leaf into a left and a right half (#7119).

PRIOR ART: ../whish147-palm-leaf-opus-2026-10-21/collation-multileaf/crop-boxes.json — hand-set left-half boxes for
pages 4–11 at 1/6 scale; this finds the leaves automatically on every page, so the same geometry reaches all 159.

A leaf is a light band on the dark backdrop: rows whose share of light pixels is high, then the columns of that band.
Each leaf is split at its horizontal midpoint (the leaf has two string holes, at about 1/3 and 2/3; the midpoint
falls between them, in the middle block of text). Crops keep full resolution (a half-leaf is ~2,300–2,600 px wide).
Writes $JOB_SCRATCH/crops/<page>-<t|b><L|R>.jpg and boxes.json here (full-resolution pixel boxes).
Run: $JOB_SCRATCH/venv/bin/python crop.py [first last]
"""
import io, json, os, sys, urllib.request
from pathlib import Path
from PIL import Image

S = Path(os.environ.get('JOB_SCRATCH', '/mnt/HC_Volume_105839809/jobs/whish147-best'))
IMG = S / 'img'
CROPS = S / 'crops'
IMG.mkdir(exist_ok=True)
CROPS.mkdir(exist_ok=True)
HERE = Path(__file__).parent
BOOK = '6ad845ec6037414ddef152af'


def fetch(n):
    f = IMG / f'{n}.jpg'
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(f'https://images.sourcelibrary.org/archived/{BOOK}/{n}.jpg', headers={'User-Agent': 'sourcelibrary-whish147-job/1.0'}), timeout=120).read())
    return Image.open(f)


def runs(flags, min_len):
    out, start = [], None
    for i, v in enumerate(flags + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def leaves(im):
    k = 8
    g = im.convert('L').resize((im.width // k, im.height // k))
    w, h = g.size
    px = g.load()
    light = lambda x, y: px[x, y] > 45
    rowshare = [sum(light(x, y) for x in range(w)) / w for y in range(h)]
    bands = runs([r > 0.45 for r in rowshare], max(8, h // 12))
    out = []
    for y0, y1 in bands:
        colshare = [sum(light(x, y) for y in range(y0, y1)) / (y1 - y0) for x in range(w)]
        cr = runs([c > 0.5 for c in colshare], w // 4)
        if not cr:
            continue
        x0, x1 = cr[0][0], cr[-1][1]
        out.append([x0 * k, y0 * k, x1 * k, y1 * k])
    return out


def main():
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    b = int(sys.argv[2]) if len(sys.argv) > 2 else 159
    bf = HERE / 'boxes.json'
    boxes = json.loads(bf.read_text()) if bf.exists() else {}
    for n in range(a, b + 1):
        im = fetch(n)
        ls = leaves(im)
        names = ['t', 'b'] if len(ls) == 2 else [f'l{i + 1}' for i in range(len(ls))]
        rec = {'size': list(im.size), 'leaves': {}}
        for name, (x0, y0, x1, y1) in zip(names, ls):
            pad = 20
            x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)
            mid = (x0 + x1) // 2
            halves = {'L': [x0, y0, mid, y1], 'R': [mid, y0, x1, y1]}
            rec['leaves'][name] = halves
            for hn, box in halves.items():
                c = im.crop(box)
                if c.width > 2600:
                    c = c.resize((2600, round(c.height * 2600 / c.width)), Image.LANCZOS)
                c.convert('RGB').save(CROPS / f'{n}-{name}{hn}.jpg', quality=92)
        boxes[str(n)] = rec
        print(n, im.size, len(ls), 'leaves', [l for l in ls])
    bf.write_text(json.dumps(boxes, indent=0))


if __name__ == '__main__':
    main()
