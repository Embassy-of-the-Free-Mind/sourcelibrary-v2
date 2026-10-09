#!/usr/bin/env python3
"""GLM English lane (#5660), the pod half: GLM-OCR (vLLM OpenAI server) over a page manifest.

  glm-english-run.py <manifest.tsv> <out dir> <server url> <served model> <max_tokens>

PRIOR ART: the #5660 round-3 bake-off client (vlm-run.py, mode glm, in the job dir of PR #5786) — the same
request shape (image, then "Text Recognition:", temperature 0, one attempt) so the lane reads pages exactly
as the measured arm did. What differs: pages come from their image URLs (R2 / IIIF), not a local bench, and
each page records the call (finish, tokens, secs, max_tokens) beside its text, because the Mongo half's
truncation guard needs finish_reason and the token count.

Manifest rows: book_id \t page_number \t image_url. Outputs: <out>/<book_id>/<page>.txt (the model's
content, raw), .json (the call record), or .err. A page with an output is never re-read. The image is sent
as JPEG, downscaled to at most MAX_W px wide (the bench's <= 2400 px), never upscaled.
"""
import base64, io, json, os, sys, threading, time, urllib.request

man, root, url, model, max_tokens = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
CLIENTS = int(os.environ.get('CLIENTS', '16'))
MAX_W = int(os.environ.get('MAX_W', '2400'))
rows = [l.rstrip('\n').split('\t') for l in open(man) if l.strip()]

try:
    from PIL import Image
except Exception:  # noqa: BLE001
    Image = None


def fetch(src):
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(src, headers={'User-Agent': 'SourceLibrary-GLM-lane/1 (#5660; sourcelibrary.org)'})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(3 * (i + 1))
    raise last


def jpeg(b):
    if Image is None:
        return b, None
    im = Image.open(io.BytesIO(b)); im.load()
    w0 = im.size
    if im.mode not in ('RGB', 'L'): im = im.convert('RGB')
    if im.size[0] > MAX_W:
        im = im.resize((MAX_W, round(im.size[1] * MAX_W / im.size[0])), Image.LANCZOS)
    o = io.BytesIO(); im.save(o, 'JPEG', quality=90)
    return o.getvalue(), {'w0': w0[0], 'h0': w0[1], 'w': im.size[0], 'h': im.size[1]}


lock = threading.Lock(); q = list(rows); tl = open(os.path.join(root, 'timings.jsonl'), 'a')
def work():
    while True:
        with lock:
            if not q: return
            bid, pn, src = q.pop(0)
        d = os.path.join(root, bid); os.makedirs(d, exist_ok=True)
        dst = os.path.join(d, f'{pn}.txt')
        if os.path.exists(dst) or os.path.exists(os.path.join(d, f'{pn}.err')): continue
        s = time.time()
        try:
            img, size = jpeg(fetch(src))
            body = {'model': model, 'temperature': 0, 'max_tokens': max_tokens, 'messages': [{'role': 'user', 'content': [
                {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(img).decode()}},
                {'type': 'text', 'text': 'Text Recognition:'}]}]}
            req = urllib.request.Request(url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=900))
            c = r['choices'][0]; raw = c['message']['content'] or ''
            rec = {'bid': bid, 'pn': int(pn), 'secs': round(time.time() - s, 2), 'finish': c.get('finish_reason'), 'out_tok': r.get('usage', {}).get('completion_tokens'),
                   'in_tok': r.get('usage', {}).get('prompt_tokens'), 'max_tokens': max_tokens, 'image': size, 'chars': len(raw)}
            json.dump(rec, open(os.path.join(d, f'{pn}.json'), 'w'))
            open(dst + '.tmp', 'w').write(raw); os.replace(dst + '.tmp', dst)
        except Exception as e:  # noqa: BLE001
            open(os.path.join(d, f'{pn}.err'), 'w').write(str(e)[:300]); rec = {'bid': bid, 'pn': pn, 'error': str(e)[:200]}
        with lock: tl.write(json.dumps(rec) + '\n'); tl.flush()


t0 = time.time(); ths = [threading.Thread(target=work) for _ in range(CLIENTS)]
for t in ths: t.start()
for t in ths: t.join()
print(json.dumps({'pages': len(rows), 'wall_secs': round(time.time() - t0, 1), 'clients': CLIENTS, 'max_tokens': max_tokens}))
