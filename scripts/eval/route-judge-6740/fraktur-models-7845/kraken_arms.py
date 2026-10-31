# PRIOR ART: scripts/eval/route-judge-6740/german-cheaper-7701/run.mjs `kraken` (the #7701 run: the kraken 7.1.1 CLI,
# `segment -bl ocr`, one text file a page). It does not fit: the CLI segments and recognises in one step, so the
# Calamari arms could not read the SAME lines, and it has no second segmenter. This script segments once and keeps it.
"""#7845 phase 1/2: segment once (S1 blla, S2 legacy nlbin+pageseg), cut the line crops every arm reads, and run the
Kraken recognisers over a stored segmentation. Run with the kraken 7.1.1 venv (`/root/bench/kraken/bin/python -I`).

  kraken_arms.py segment --imgs=DIR --ids=FILE --out=DIR [--threads=8]
      DIR/seg/{S1,S2}/<id>.pkl (kraken Segmentation), DIR/lines/S1/<id>/<nnn>.png (the dewarped crops, reading order),
      DIR/seg/timing.jsonl
  kraken_arms.py recognise --imgs=DIR --ids=FILE --out=DIR --seg=S1|S2 --model=FILE --arm=NAME [--threads=8]
      DIR/arms/<arm>/<id>.txt (lines joined by newlines), DIR/arms/<arm>/timing.jsonl
Read-only: images in, text files out.
"""
import json, os, pickle, sys, time

args = dict(a[2:].split('=', 1) for a in sys.argv[2:] if a.startswith('--') and '=' in a)
stage = sys.argv[1]
threads = int(args.get('threads', 8))
os.environ.setdefault('OMP_NUM_THREADS', str(threads))
import torch  # noqa: E402
torch.set_num_threads(threads)
from PIL import Image  # noqa: E402
from kraken import blla, pageseg, binarization, rpred  # noqa: E402
from kraken.lib import models  # noqa: E402
from kraken.lib.segmentation import extract_polygons  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
OUT = args['out']
ids = [l.strip() for l in open(args['ids']) if l.strip()]
img = lambda i: Image.open(os.path.join(args['imgs'], f'{i}.jpg'))


def log(f, row):
    with open(f, 'a') as fh:
        fh.write(json.dumps(row) + '\n')


if stage == 'segment':
    for s in ('S1', 'S2'):
        os.makedirs(os.path.join(OUT, 'seg', s), exist_ok=True)
    for i in ids:
        f1 = os.path.join(OUT, 'seg', 'S1', f'{i}.pkl')
        if os.path.exists(f1):
            continue
        im = img(i)
        t0 = time.time()
        s1 = blla.segment(im)                                   # default blla.mlmodel, horizontal-lr
        t1 = time.time()
        s2 = pageseg.segment(binarization.nlbin(im))            # legacy box segmenter on the nlbin image
        t2 = time.time()
        d = os.path.join(OUT, 'lines', 'S1', i)
        os.makedirs(d, exist_ok=True)
        n = 0
        for k, (crop, _line) in enumerate(extract_polygons(im, s1)):
            crop.save(os.path.join(d, f'{k:03d}.png'))
            n += 1
        pickle.dump(s2, open(os.path.join(OUT, 'seg', 'S2', f'{i}.pkl'), 'wb'))
        pickle.dump(s1, open(f1, 'wb'))
        log(os.path.join(OUT, 'seg', 'timing.jsonl'), {'id': i, 'size': im.size, 'S1_lines': len(s1.lines), 'S1_crops': n, 'S2_lines': len(s2.lines), 'S1_secs': round(t1 - t0, 2), 'S2_secs': round(t2 - t1, 2)})
        print(i, im.size, 'S1', len(s1.lines), 'S2', len(s2.lines), flush=True)

elif stage == 'recognise':
    arm, seg = args['arm'], args['seg']
    net = models.load_any(args['model'])
    d = os.path.join(OUT, 'arms', arm)
    os.makedirs(d, exist_ok=True)
    for i in ids:
        f = os.path.join(d, f'{i}.txt')
        if os.path.exists(f):
            continue
        s = pickle.load(open(os.path.join(OUT, 'seg', seg, f'{i}.pkl'), 'rb'))
        im = img(i)
        t0 = time.time()
        lines = [r.prediction for r in rpred.rpred(net, im, s)]
        secs = time.time() - t0
        open(f, 'w').write('\n'.join(l for l in lines if l.strip()) + '\n')
        log(os.path.join(d, 'timing.jsonl'), {'id': i, 'lines': len(lines), 'secs': round(secs, 2)})
        print(arm, i, len(lines), f'{secs:.1f}s', flush=True)
elif stage == 'binlines':
    # Amendment 1: the SAME S1 polygons cut from the nlbin image (kraken's ocropus nlbin), for a Calamari model trained
    # on normalised / binarised line images only (calamari_models 2.2: "normalized grayscale and nlbin").
    for i in ids:
        d = os.path.join(OUT, 'lines', 'S1bin', i)
        if os.path.isdir(d):
            continue
        s1 = pickle.load(open(os.path.join(OUT, 'seg', 'S1', f'{i}.pkl'), 'rb'))
        im = binarization.nlbin(img(i))
        os.makedirs(d, exist_ok=True)
        for k, (crop, _line) in enumerate(extract_polygons(im, s1)):
            crop.save(os.path.join(d, f'{k:03d}.png'))
        print('binlines', i, flush=True)
elif stage == 'paperlines':
    # Amendment 2: extract_polygons fills everything outside the line polygon with BLACK (0). Kraken models are trained
    # on exactly those crops; Calamari inverts and normalises its input, so the black wedges read as heavy ink. Here the
    # SAME S1 polygons are cut and the outside is filled with the line's own paper tone (90th percentile of the grey
    # values inside the polygon), as OCR-D's image_from_segment fills a segment's background.
    import numpy as np
    for i in ids:
        d = os.path.join(OUT, 'lines', 'S1w', i)
        if os.path.isdir(d):
            continue
        s1 = pickle.load(open(os.path.join(OUT, 'seg', 'S1', f'{i}.pkl'), 'rb'))
        g = img(i).convert('L')
        # grey in R and G, a constant 255 in B: one extraction gives the crop and its polygon mask (B is 0 outside)
        im = Image.merge('RGB', (g, g, Image.new('L', g.size, 255)))
        os.makedirs(d, exist_ok=True)
        for k, (crop, _l) in enumerate(extract_polygons(im, s1)):
            c = np.array(crop.convert('RGB'))
            a, m = c[:, :, 0], c[:, :, 2] > 127
            paper = np.percentile(a[m], 90) if m.any() else 255
            a = np.where(m, a, paper).astype(np.uint8)
            Image.fromarray(a).save(os.path.join(d, f'{k:03d}.png'))
        print('paperlines', i, flush=True)
else:
    sys.exit(f'usage: kraken_arms.py segment|recognise|binlines|paperlines ...')
