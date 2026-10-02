#!/usr/bin/env python3
"""paddle-zh-run.py — PaddleOCR-VL over a manifest of page-image URLs, one runner of N (#5600 lane).

PRIOR ART: scripts/gpu/paddle-vl-run.py (#5547 — the runner this extends: output-file-is-the-checkpoint,
a per-page watchdog that EXITS 3 on a wedged page so the box script restarts the process). That runner
read images pushed from Hetzner; this one is for a million pages, so the box fetches its own images
from R2 with a CPU thread pool that keeps a queue ahead of the GPU (#5600 step 3 arm d), can cap the
long side (arm b), can skip the layout stage (arm c), and can send recognition to PaddleOCR's genai
server (arm a: vLLM batches the VLM across runners). paddle-vl-run.py is kept unchanged: it is the
#5547 evidence's instrument.

  python3 paddle-zh-run.py --manifest manifest.tsv --root /root/pz --worker 0 --workers 2 \
      --deadline <epoch> [--page-timeout 90] [--max-side 0] [--layout 1] [--backend native|server] \
      [--server-url http://127.0.0.1:8118/v1] [--prefetch 4]

manifest.tsv: <bid>\t<pn>\t<image URL or path relative to --root>. Writes <root>/out/<bid>/<pn>.txt (the
pipeline's parsing blocks in its reading order, one per line) or <pn>.err (fetch failure / timeout /
exception — never an empty .txt, so the lane can tell "read, no text" from "not read"), and one JSON
line per page to <root>/timings-<worker>.jsonl (secs = recognition, fetch_secs, w×h fed to the model).
"""
import argparse, io, json, os, queue, socket, sys, threading, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('--manifest', required=True); ap.add_argument('--root', required=True)
ap.add_argument('--worker', type=int, default=0); ap.add_argument('--workers', type=int, default=1)
ap.add_argument('--deadline', type=float, default=0); ap.add_argument('--page-timeout', type=int, default=90)
ap.add_argument('--max-width', type=int, default=2400, help='the #5547 rule: pages wider than this are resized to it')
ap.add_argument('--max-side', type=int, default=0, help='additionally cap the long side (0 = off)')
ap.add_argument('--layout', type=int, default=1); ap.add_argument('--backend', default='native')
ap.add_argument('--server-url', default='http://127.0.0.1:8118/v1'); ap.add_argument('--prefetch', type=int, default=4)
a = ap.parse_args()

from PIL import Image  # noqa: E402

rows = [l.rstrip('\n').split('\t') for l in open(a.manifest) if l.strip()]
mine = [r for i, r in enumerate(rows) if i % a.workers == a.worker]
out = lambda bid, pn, ext: os.path.join(a.root, 'out', bid, f'{pn}.{ext}')
todo = [r for r in mine if not (os.path.exists(out(r[0], r[1], 'txt')) or os.path.exists(out(r[0], r[1], 'err')))]
tlog = open(os.path.join(a.root, f'timings-{a.worker}.jsonl'), 'a')
def tw(rec): tlog.write(json.dumps(rec, ensure_ascii=False) + '\n'); tlog.flush()
def err(bid, pn, msg):
    os.makedirs(os.path.dirname(out(bid, pn, 'err')), exist_ok=True)
    open(out(bid, pn, 'err'), 'w').write(msg)

# ── prefetch: fetch + resize on CPU threads, a bounded queue ahead of the GPU ─────────────────────
tmp = os.path.join(a.root, 'tmp', str(a.worker)); os.makedirs(tmp, exist_ok=True)
jobs, ready = queue.Queue(), queue.Queue(maxsize=max(4, a.prefetch * 4))
for r in todo: jobs.put(r)
def fetch(src):
    if not src.startswith('http'): return open(os.path.join(a.root, src), 'rb').read()
    last = None
    for t in range(4):
        try:
            req = urllib.request.Request(src, headers={'User-Agent': 'sourcelibrary-paddle-lane/5600 (+https://sourcelibrary.org)'})
            with urllib.request.urlopen(req, timeout=60) as resp: return resp.read()
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(2 * (t + 1))
    raise last
def prep(buf, dst):
    im = Image.open(io.BytesIO(buf)); im.load()
    if im.mode not in ('RGB', 'L'): im = im.convert('RGB')
    w, h = im.size
    s = min(1.0, a.max_width / w if a.max_width else 1.0, a.max_side / max(w, h) if a.max_side else 1.0)
    if s < 1.0: im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    im.convert('RGB').save(dst, 'JPEG', quality=92)
    return im.size
def fetcher():
    while True:
        try: bid, pn, src = jobs.get_nowait()
        except queue.Empty: return
        s = time.time(); dst = os.path.join(tmp, f'{bid}_{pn}.jpg')
        try: size = prep(fetch(src), dst); ready.put((bid, pn, src, dst, size, round(time.time() - s, 2), None))
        except Exception as e:  # noqa: BLE001 — a page that cannot be fetched is a result
            ready.put((bid, pn, src, None, None, round(time.time() - s, 2), f'fetch: {str(e)[:160]}'))
threads = [threading.Thread(target=fetcher, daemon=True) for _ in range(max(1, a.prefetch))]
for t in threads: t.start()

# ── the pipeline ──────────────────────────────────────────────────────────────────────────────
t0 = time.time()
from paddleocr import PaddleOCRVL  # noqa: E402
kw = {}
if not a.layout: kw['use_layout_detection'] = False
if a.backend == 'server': kw.update(vl_rec_backend='vllm-server', vl_rec_server_url=a.server_url)
pipe = PaddleOCRVL(**kw)
tw({'event': 'loaded', 'worker': a.worker, 'secs': round(time.time() - t0, 1), 'host': socket.gethostname(), 'kw': kw, 'todo': len(todo)})

current = {}
def watchdog():
    while True:
        time.sleep(5)
        c = dict(current)
        if c and time.time() - c['start'] > a.page_timeout:
            err(c['bid'], c['pn'], f'timeout {a.page_timeout}s')
            tw(dict(c['rec'], secs=round(time.time() - c['start'], 2), error=f'timeout {a.page_timeout}s (process restarted)'))
            os._exit(3)
threading.Thread(target=watchdog, daemon=True).start()

def blocks_of(res):
    j = res.json if hasattr(res, 'json') else res
    if isinstance(j, dict) and 'res' in j: j = j['res']
    blocks = []
    for b in (j.get('parsing_res_list') or []) if isinstance(j, dict) else []:
        c = b.get('block_content') if isinstance(b, dict) else getattr(b, 'content', None)
        if c and str(c).strip(): blocks.append(str(c).strip())
    if not blocks:
        md = getattr(res, 'markdown', None)
        if isinstance(md, dict): md = md.get('markdown_texts')
        if md: blocks.append(str(md).strip())
    return blocks

done = 0
while done < len(todo):
    if a.deadline and time.time() > a.deadline: break
    bid, pn, src, path, size, fsecs, ferr = ready.get()
    done += 1
    rec = {'bid': bid, 'pn': pn, 'worker': a.worker, 'fetch_secs': fsecs}
    if ferr:
        err(bid, pn, ferr); tw(dict(rec, error=ferr)); continue
    os.makedirs(os.path.dirname(out(bid, pn, 'txt')), exist_ok=True)
    s = time.time(); current.update(bid=bid, pn=pn, rec=dict(rec), start=s)
    try:
        text = '\n'.join(blk for r in pipe.predict(path) for blk in blocks_of(r))
        current.clear()
        open(out(bid, pn, 'txt') + '.part', 'w').write(text); os.replace(out(bid, pn, 'txt') + '.part', out(bid, pn, 'txt'))
        rec.update(secs=round(time.time() - s, 2), chars=len(text), w=size[0], h=size[1], src=src)
    except Exception as e:  # noqa: BLE001
        current.clear(); rec.update(secs=round(time.time() - s, 2), error=str(e)[:200]); err(bid, pn, f'exception: {str(e)[:200]}')
    try: os.remove(path)
    except OSError: pass
    tw(rec)
tw({'event': 'worker-done', 'worker': a.worker, 'at': time.time(), 'pages': done})
tlog.close()
