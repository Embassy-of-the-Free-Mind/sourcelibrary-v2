#!/usr/bin/env python3
"""gpu-print-read.py — the GPU half of scripts/workers/gpu-print-lane.mjs (#6871): LightOnOCR-3-1B over the lane's
manifest.tsv (<bid>\t<pn>\t<pid>\t<url>), one page a request, against a vLLM server already up.

PRIOR ART: scripts/eval/print1800-gpu-6871/read.py (the eval's reader, mode `lighton`: image only, temperature 0.2,
top_p 0.9, 6,000 max tokens — copied so the lane reads as the eval measured) and scripts/gpu/paddle-zh-run.py (a
manifest reader that skips pages already back and writes one file per page). This one fetches each image itself
(long side capped at 2,400 px, the eval's cap) and keeps nothing but the text.
  gpu-print-read.py <lane dir> [--url http://127.0.0.1:8010/v1] [--clients 16] [--limit N] [--deadline EPOCH]
Writes <lane>/out/<bid>/<pn>.json {text, finish, out_tok, image_sha256, secs} or <pn>.err. Nothing goes to Mongo.
EARLY STOP (gex45 is power-capped, 2026-10-29): the reply is streamed, and a page whose text passes ABORT_OTHER_SCRIPT
letters of a non-Latin script is cut there (vLLM frees the request when the connection closes) and saved with finish
`abort_other_script`. The lane's guard (scripts/lib/gpu-print-lane.mjs pageVerdict) rejects any page with more than 3
such letters, so the cut page gets the verdict the full read would have got; the margin (40 vs 3) covers the few letters
convertRead can drop (image alt text). Measured before the change: those pages were 12.8% of the lane's output tokens.
"""
import argparse, base64, hashlib, io, json, os, re, threading, time, urllib.request
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('lane'); ap.add_argument('--url', default='http://127.0.0.1:8010/v1')
ap.add_argument('--clients', type=int, default=16); ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--deadline', type=float, default=0)
a = ap.parse_args()
OUT = os.path.join(a.lane, 'out')
rows = []
for l in open(os.path.join(a.lane, 'manifest.tsv')):
    p = l.rstrip('\n').split('\t')
    if len(p) != 4: continue
    bid, pn, pid, url = p
    if os.path.exists(f'{OUT}/{bid}/{pn}.json') or os.path.exists(f'{OUT}/{bid}/{pn}.err'): continue
    rows.append((bid, pn, pid, url))
if a.limit: rows = rows[:a.limit]
print(f'{len(rows)} pages to read', flush=True)


def fetch(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'sourcelibrary-gpu-print-6871'})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:  # noqa: BLE001
            err = e; time.sleep(3 * (i + 1))
    raise err


# The lane guard's OTHER_SCRIPT scripts as code-point ranges (Python re has no \p{Script=}): Greek, Cyrillic, Armenian,
# Hebrew, Arabic, Syriac, the Indic block, Thai, Tibetan, Georgian, Ethiopic, Hangul, kana, Han.
OTHER = re.compile('[\u0370-\u03ff\u1f00-\u1fff\u0400-\u052f\u0530-\u058f\u0590-\u05ff\u0600-\u06ff\u0750-\u077f'
                   '\u0700-\u074f\u0900-\u0d7f\u0e00-\u0e7f\u0f00-\u0fff\u10a0-\u10ff\u1200-\u139f\u1100-\u11ff\uac00-\ud7af'
                   '\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]')
ABORT_OTHER_SCRIPT = int(os.environ.get('ABORT_OTHER_SCRIPT', '40'))  # 0 = never cut


def read(buf):
    im = Image.open(io.BytesIO(buf)).convert('RGB'); s = 2400 / max(im.size)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, format='JPEG', quality=90)
    body = {'model': 'm', 'temperature': 0.2, 'top_p': 0.9, 'max_tokens': 6000, 'stream': True, 'stream_options': {'include_usage': True},
            'messages': [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()}}]}]}
    req = urllib.request.Request(a.url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    parts, fin, tok, other = [], None, None, 0
    with urllib.request.urlopen(req, timeout=900) as r:
        for line in r:
            line = line.decode('utf-8', 'replace').strip()
            if not line.startswith('data:'): continue
            data = line[5:].strip()
            if data == '[DONE]': break
            ev = json.loads(data)
            if ev.get('usage'): tok = ev['usage'].get('completion_tokens')
            for c in ev.get('choices') or []:
                d = (c.get('delta') or {}).get('content') or ''
                if d:
                    parts.append(d); other += len(OTHER.findall(d))
                if c.get('finish_reason'): fin = c['finish_reason']
            if ABORT_OTHER_SCRIPT and other > ABORT_OTHER_SCRIPT:
                fin = 'abort_other_script'; break  # leaving the with-block closes the stream; vLLM aborts the request
    return ''.join(parts), fin, tok


lock = threading.Lock(); q = list(rows); n = {'ok': 0, 'err': 0}


def worker():
    while True:
        with lock:
            if not q or (a.deadline and time.time() > a.deadline): return
            bid, pn, pid, url = q.pop(0)
        os.makedirs(f'{OUT}/{bid}', exist_ok=True); t0 = time.time()
        try:
            buf = fetch(url)
            text, fin, tok = read(buf)
            json.dump({'page_id': pid, 'text': text, 'finish': fin, 'out_tok': tok, 'image_sha256': hashlib.sha256(buf).hexdigest(),
                       'image_url': url, 'secs': round(time.time() - t0, 2)}, open(f'{OUT}/{bid}/{pn}.json', 'w'), ensure_ascii=False)
            k = 'ok'
        except Exception as e:  # noqa: BLE001
            open(f'{OUT}/{bid}/{pn}.err', 'w').write(f'{type(e).__name__}: {str(e)[:400]}'); k = 'err'
        with lock: n[k] += 1


t0 = time.time()
ths = [threading.Thread(target=worker) for _ in range(a.clients)]
for t in ths: t.start()
for t in ths: t.join()
w = time.time() - t0
print(json.dumps({**n, 'wall_secs': round(w, 1), 'pages_per_hour': round((n['ok'] + n['err']) / w * 3600) if w else None, 'left': len(q)}), flush=True)
