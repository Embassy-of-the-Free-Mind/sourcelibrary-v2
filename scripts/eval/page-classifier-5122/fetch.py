# PRIOR ART: scripts/gpu/gex45-bench-6871 fetches one page per book for a speed card (no resize policy shared here),
# /root/jobs/image-search-6871/fetch.py (thumbnails for CLIP, 224 px). This keeps 1,280 px so the VLM arm and the
# image-statistics arm read the same file. Read only. Usage: python fetch.py MANIFEST OUTDIR
import sys, json, hashlib, io, urllib.request, concurrent.futures as cf
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
man, outdir = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(man)]
def key(u): return hashlib.sha1(u.encode()).hexdigest()[:16]
def get(r):
    u = r['image_url']; dst = f"{outdir}/{key(u)}.jpg"
    try:
        open(dst, 'rb').close(); return r['uid'], 'cached', None
    except FileNotFoundError: pass
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'SourceLibrary-eval/5122 (+https://sourcelibrary.org)'})
        b = urllib.request.urlopen(req, timeout=90).read()
        im = Image.open(io.BytesIO(b)); W, H = im.size
        im = im.convert('RGB'); im.thumbnail((1280, 1280))
        im.save(dst, quality=88)
        return r['uid'], 'ok', [W, H]
    except Exception as e:
        return r['uid'], 'err', str(e)[:200]
res = {}
with cf.ThreadPoolExecutor(16) as ex:
    for uid, st, info in ex.map(get, rows): res[uid] = [st, info]
json.dump(res, open(f"{outdir}/../fetch-status.json", 'w'))
from collections import Counter; print(Counter(v[0] for v in res.values()))
