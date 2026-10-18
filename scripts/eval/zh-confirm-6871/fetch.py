#!/usr/bin/env python3
"""fetch.py — the fresh draw's page images: one engine input per page plus reader crops (#6871 row 3).

PRIOR ART: the zh-residue-refs-6871 / zh-bakeoff-6871 jobs did the same on gex45 by hand (never committed): IIIF full
image, long side capped at 2,744 px, crops _full/_R/_L/_R1/_R2/_L1/_L2 for the Opus readers (READER-PROMPT.md).

  fetch.py draw.json <out dir>      (gex45: /root/pz/venv/bin/python)
Writes <out>/in/<page_id>.jpg (engine input) and <out>/img/<page_id>_{full,R,L,R1,R2,L1,L2}.jpg, for each drawn page
and its first alternate (used only if the readers mark the drawn page blank or non-body).
"""
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

d = json.load(open(sys.argv[1])); out = sys.argv[2]
os.makedirs(f'{out}/in', exist_ok=True); os.makedirs(f'{out}/img', exist_ok=True)
jobs = []
for x in d['draws']:
    jobs.append((x['page_id'], x['photo']))
    if x['alternates']: jobs.append((x['alternates'][0]['page_id'], x['alternates'][0]['photo']))


def one(job):
    pid, url = job
    if os.path.exists(f'{out}/img/{pid}_L2.jpg'): return pid, 'have'
    for a in range(4):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'sourcelibrary-eval/6871'}), timeout=120).read()
            im = Image.open(io.BytesIO(raw)).convert('RGB'); break
        except Exception as e:  # noqa: BLE001
            err = str(e); time.sleep(10 * (a + 1))
    else:
        return pid, 'FAIL ' + err
    w, h = im.size; s = min(1, 2744 / max(w, h))
    if s < 1: im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    w, h = im.size
    im.save(f'{out}/in/{pid}.jpg', quality=90); im.save(f'{out}/img/{pid}_full.jpg', quality=90)
    ov = int(0.05 * w); hv = int(0.05 * h)
    R = im.crop((w // 2 - ov, 0, w, h)); L = im.crop((0, 0, w // 2 + ov, h))
    for name, c in (('R', R), ('L', L)):
        c.save(f'{out}/img/{pid}_{name}.jpg', quality=90)
        cw, ch = c.size
        c.crop((0, 0, cw, ch // 2 + hv)).save(f'{out}/img/{pid}_{name}1.jpg', quality=90)
        c.crop((0, ch // 2 - hv, cw, ch)).save(f'{out}/img/{pid}_{name}2.jpg', quality=90)
    return pid, f'{w}x{h}'


with ThreadPoolExecutor(6) as ex:
    for pid, st in ex.map(one, jobs): print(pid, st, flush=True)
