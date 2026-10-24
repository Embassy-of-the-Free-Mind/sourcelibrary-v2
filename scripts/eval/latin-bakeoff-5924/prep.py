#!/usr/bin/env python3
"""prep.py — the fed images of the #5924 GEX45 Latin bake-off (prereg Amendment 4, "Pages and images").

PRIOR ART: scripts/eval/latin-refs-5924.mjs `fetch` (fetches the same leaves and records their sha256 in the sidecars:
this re-checks that hash, it does not re-derive it); scripts/gpu/gex45-bench-6871/build-manifest.mjs (the 2,400 px cap).

  prep.py <refs dir> <img dir with <slug>.jpg as fetched> <job dir>
Writes <job>/in/<slug>.jpg (every arm), <job>/in1288/<slug>.jpg (olmOCR), <job>/inputs.json. Stops on any hash mismatch.
"""
import hashlib, io, json, os, sys
from PIL import Image

refs, src, job = sys.argv[1:]
pages = json.load(open(os.path.join(refs, 'latin-refs-5924.json')))['pages']
for d in ('in', 'in1288'): os.makedirs(os.path.join(job, d), exist_ok=True)


def capped(im, side):
    w, h = im.size
    if max(w, h) <= side: return None
    s = side / max(w, h)
    return im.resize((round(w * s), round(h * s)), Image.LANCZOS)


rows = []
for p in pages:
    sc = json.load(open(os.path.join(refs, p['slug'] + '.json')))
    raw = open(os.path.join(src, p['slug'] + '.jpg'), 'rb').read()
    h0 = hashlib.sha256(raw).hexdigest()
    if h0 != sc['image']['sha256']: sys.exit(f"sha256 mismatch {p['slug']}: {h0} != {sc['image']['sha256']}")
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    out = {}
    for d, side in (('in', 2400), ('in1288', 1288)):
        r = capped(im, side)
        if r is None: b = raw
        else:
            buf = io.BytesIO(); r.save(buf, 'JPEG', quality=92); b = buf.getvalue()
        open(os.path.join(job, d, p['slug'] + '.jpg'), 'wb').write(b)
        out[d] = {'sha256': hashlib.sha256(b).hexdigest(), 'size': list((r or im).size), 'downscaled': r is not None}
    rows.append({'slug': p['slug'], 'century': p['substratum'], 'url': sc['image']['url'], 'sha256_original': h0,
                 'original_size': list(im.size), 'fed': out['in'], 'fed_olmocr': out['in1288']})
json.dump({'pages': rows, 'downscaled_2400': sum(r['fed']['downscaled'] for r in rows)}, open(os.path.join(job, 'inputs.json'), 'w'), indent=1)
print(len(rows), 'pages;', sum(r['fed']['downscaled'] for r in rows), 'downscaled to 2400;', sum(r['fed_olmocr']['downscaled'] for r in rows), 'to 1288')
