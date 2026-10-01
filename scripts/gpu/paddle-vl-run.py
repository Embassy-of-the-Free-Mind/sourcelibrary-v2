#!/usr/bin/env python3
"""paddle-vl-run.py — PaddleOCR-VL over a manifest, one worker of N (#5547 step 4; #4743/#4925 recipe).

PRIOR ART: the #4743/#4925 Paddle arms (paddleocr[doc-parser] pipeline with a per-page alarm and the
whole arm under `timeout`, after the first run hung on page 4 and idled an L4 for 43 h, #4735) — that
runner lived on the box and was never committed. scripts/gpu/ndl-koten-lines.py is the NDL lane's
collector, not a runner. This is the runner, committed.

  python3 paddle-vl-run.py --manifest manifest.tsv --root /root/pv --worker 0 --workers 3 \
      --deadline <epoch secs> [--page-timeout 180]

manifest.tsv: <bid>\t<pn>\t<relative image path>. Writes <root>/out/<bid>/<pn>.txt (the reading: the
pipeline's parsing blocks in its reading order, one block per line) and appends one JSON line per page
to <root>/timings-<worker>.jsonl. A page whose .txt exists is skipped (the output IS the checkpoint).
Stops starting pages after --deadline. A hung page raises at --page-timeout and is logged as an error.
"""
import argparse, json, os, signal, socket, sys, time

ap = argparse.ArgumentParser()
ap.add_argument('--manifest', required=True); ap.add_argument('--root', required=True)
ap.add_argument('--worker', type=int, default=0); ap.add_argument('--workers', type=int, default=1)
ap.add_argument('--deadline', type=float, default=0); ap.add_argument('--page-timeout', type=int, default=180)
a = ap.parse_args()

class PageTimeout(Exception): pass
def on_alarm(signum, frame): raise PageTimeout()
signal.signal(signal.SIGALRM, on_alarm)

rows = [l.rstrip('\n').split('\t') for l in open(a.manifest) if l.strip()]
mine = [r for i, r in enumerate(rows) if i % a.workers == a.worker]
tlog = open(os.path.join(a.root, f'timings-{a.worker}.jsonl'), 'a')

t0 = time.time()
from paddleocr import PaddleOCRVL  # noqa: E402  (import is slow; time it)
pipe = PaddleOCRVL()
tlog.write(json.dumps({'event': 'loaded', 'worker': a.worker, 'secs': round(time.time() - t0, 1), 'host': socket.gethostname()}) + '\n'); tlog.flush()

def blocks_of(res):
    j = res.json if hasattr(res, 'json') else res
    if isinstance(j, dict) and 'res' in j: j = j['res']
    out = []
    for b in (j.get('parsing_res_list') or []) if isinstance(j, dict) else []:
        c = b.get('block_content') if isinstance(b, dict) else getattr(b, 'content', None)
        if c and str(c).strip(): out.append(str(c).strip())
    if not out:
        md = getattr(res, 'markdown', None)
        if isinstance(md, dict): md = md.get('markdown_texts')
        if md: out.append(str(md).strip())
    return out

for bid, pn, rel in mine:
    if a.deadline and time.time() > a.deadline: break
    dst = os.path.join(a.root, 'out', bid, f'{pn}.txt')
    if os.path.exists(dst): continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    s = time.time(); rec = {'bid': bid, 'pn': pn, 'worker': a.worker}
    try:
        signal.alarm(a.page_timeout)
        text = '\n'.join(blk for r in pipe.predict(os.path.join(a.root, rel)) for blk in blocks_of(r))
        signal.alarm(0)
        open(dst, 'w').write(text)
        rec.update(secs=round(time.time() - s, 2), chars=len(text))
    except PageTimeout:
        rec.update(secs=round(time.time() - s, 2), error=f'timeout {a.page_timeout}s'); open(dst, 'w').write('')
    except Exception as e:  # noqa: BLE001 — a failed page is a result, logged, never fatal
        signal.alarm(0); rec.update(secs=round(time.time() - s, 2), error=str(e)[:200]); open(dst, 'w').write('')
    tlog.write(json.dumps(rec) + '\n'); tlog.flush()
tlog.write(json.dumps({'event': 'worker-done', 'worker': a.worker, 'at': time.time()}) + '\n'); tlog.close()
