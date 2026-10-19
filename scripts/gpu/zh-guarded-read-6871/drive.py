#!/usr/bin/env python3
"""drive.py: guarded production Paddle over the held Chinese table + mixed residue, to files (#6871 row 3).

PRIOR ART: scripts/gpu/paddle-zh-box.sh `arm` (runners + exit-3 restart; called the same way here, minus its bare
`wait`); scripts/eval/zh-confirm-6871/{fetch.py, ink.py, guard.py} (the image prep, the ink features and the FROZEN
guard; imported unchanged, never edited); scripts/eval/zh-confirm-6871/paddle.sh (the P0 settings the bar was passed
with). None of them runs 27K pages resumably or keeps a per-page record a writer can check.

Run by task.sh on gex45, under the gpu-queue lock, with the genai server already up. Per chunk of whole books
(~CHUNK pages): fetch every image (sha256 of the bytes served, long side capped at 2,744 px exactly as fetch.py did),
compute ink.py's features, run CLIENTS paddle-zh-run.py runners (server backend, layout off: the P0 arm), retry each
page that errored once, then run guard.py on the raw output and write one JSONL per book:

  <out>/books/<bid>.jsonl   {page_id, book_id, page_number, class, text, error, guard{route, flags, n, ...},
                             image{url, sha256, bytes, w, h}, engine{...}, run, guard_code{...}, at}

`route`: PADDLE (passes the guard), FLASH (flagged, inked page: goes to agy Flash), HOLD (flagged, near-blank),
UNREAD (fetch or engine error after the retry). A book's JSONL is written only when every page in it has a
result; its images are then deleted. Re-running resumes: books with a JSONL are skipped, and the runners skip pages
that already have output. Nothing here talks to Mongo.

  /root/pz/venv/bin/python drive.py --manifest M --out O --code C [--chunk 600] [--clients 8] [--limit-books N]
"""
import argparse, hashlib, io, json, os, glob, shutil, socket, subprocess, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument('--manifest', required=True); ap.add_argument('--out', required=True); ap.add_argument('--code', required=True)
ap.add_argument('--chunk', type=int, default=600); ap.add_argument('--clients', type=int, default=8)
ap.add_argument('--fetchers', type=int, default=8); ap.add_argument('--limit-books', type=int, default=0)
ap.add_argument('--runner', default='/root/pz/code/paddle-zh-run.py'); ap.add_argument('--py', default='/root/pz/venv/bin/python')
a = ap.parse_args()

sys.path.insert(0, os.path.join(a.code, 'zh-confirm-6871'))
from PIL import Image  # noqa: E402
from ink import ink  # noqa: E402  (zh-confirm-6871/ink.py, unchanged)
from guard import guard, K  # noqa: E402  (zh-confirm-6871/guard.py, frozen in 282f64b54)

O = a.out
for d in ('books', 'img', 'meta', 'paddle', 'chunks'): os.makedirs(f'{O}/{d}', exist_ok=True)
log_f = open(f'{O}/drive.log', 'a')
def log(m):
    line = f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {m}'
    print(line, flush=True); log_f.write(line + '\n'); log_f.flush()

def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''): h.update(b)
    return h.hexdigest()

# ── the run record: engine, revision, settings, the guard's code ─────────────────────────────────────
run_f = f'{O}/run.json'
if os.path.exists(run_f):
    RUN = json.load(open(run_f))
else:
    wf = sorted(glob.glob(os.path.expanduser('~/.paddlex/official_models/PaddleOCR-VL*/**/*.safetensors'), recursive=True))
    h = hashlib.sha256()
    for f in wf:
        with open(f, 'rb') as fh:
            for b in iter(lambda: fh.read(1 << 22), b''): h.update(b)
    ver = subprocess.run([a.py, '-c', 'import paddle, paddleocr, paddlex; print(paddle.__version__, paddleocr.__version__, paddlex.__version__)'], capture_output=True, text=True).stdout.split()
    vllm = subprocess.run(['/root/pz/srv/bin/python', '-c', 'import vllm; print(vllm.__version__)'], capture_output=True, text=True).stdout.strip() or None
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
    RUN = {
        'run': f'zh-guarded-read-6871/{time.strftime("%Y%m%dT%H%MZ", time.gmtime())}', 'issue': 6871, 'host': socket.gethostname(), 'gpu': gpu,
        'engine': {'name': 'PaddleOCR-VL', 'model': 'PaddleOCR-VL-1.6-0.9B', 'version': '1.6', 'licence': 'Apache-2.0',
                   'revision': f'sha256:{h.hexdigest()}' if wf else None, 'weights_files': [os.path.relpath(f, os.path.expanduser('~/.paddlex/official_models')) for f in wf],
                   'stack': dict(zip(['paddlepaddle-gpu', 'paddleocr', 'paddlex'], ver)), 'vllm': vllm,
                   'serving': {'backend': 'vllm-server', 'runners': a.clients, 'layout': 0, 'max_width': 2400, 'input_long_side_cap': 2744}},
        'guard_code': {f: sha_file(os.path.join(a.code, f)) for f in ('zh-confirm-6871/guard.py', 'zh-confirm-6871/ink.py', 'zh-residue-refs-6871/compare.py')},
        'guard_constants': K, 'guard_frozen_in': '282f64b54 (preregistration 2026-10-18-zh-guarded-paddle-prereg-6871.md)',
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    json.dump(RUN, open(run_f, 'w'), indent=1)
log(f'run {RUN["run"]} revision {RUN["engine"]["revision"]}')

# ── manifest → books → chunks of whole books ─────────────────────────────────────────────────────────
books = {}
for line in open(a.manifest):
    if not line.strip(): continue
    bid, pn, pid, cls, url = line.rstrip('\n').split('\t')
    books.setdefault(bid, []).append({'bid': bid, 'pn': int(pn), 'pid': pid, 'class': cls, 'url': url})
todo = [b for b in books if not os.path.exists(f'{O}/books/{b}.jsonl')]
if a.limit_books: todo = todo[:a.limit_books]
chunks, cur = [], []
for b in todo:
    cur.append(b)
    if sum(len(books[x]) for x in cur) >= a.chunk: chunks.append(cur); cur = []
if cur: chunks.append(cur)
log(f'{len(books)} books, {sum(map(len, books.values()))} pages; {len(todo)} books to do in {len(chunks)} chunks')

# ── fetch: bytes → sha256 → long side ≤ 2,744 (fetch.py) → ink features ──────────────────────────────
def fetch_one(p):
    meta_f = f'{O}/meta/{p["bid"]}/{p["pn"]}.json'
    img_f = f'{O}/img/{p["bid"]}/{p["pn"]}.jpg'
    if os.path.exists(meta_f):
        m = json.load(open(meta_f))
        if m.get('error') or os.path.exists(img_f) or os.path.exists(f'{O}/paddle/out/{p["bid"]}/{p["pn"]}.txt'): return m
    os.makedirs(os.path.dirname(meta_f), exist_ok=True); os.makedirs(os.path.dirname(img_f), exist_ok=True)
    err = None
    for t in range(4):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(p['url'], headers={'User-Agent': 'sourcelibrary-paddle-lane/6871 (+https://sourcelibrary.org)'}), timeout=120).read()
            im = Image.open(io.BytesIO(raw)); im.load(); im = im.convert('RGB'); break
        except Exception as e:  # noqa: BLE001
            err = str(e)[:200]; time.sleep(5 * (t + 1))
    else:
        m = {'url': p['url'], 'error': f'fetch: {err}'}
        json.dump(m, open(meta_f, 'w')); return m
    w0, h0 = im.size; s = min(1, 2744 / max(w0, h0))
    if s < 1: im = im.resize((round(w0 * s), round(h0 * s)), Image.LANCZOS)
    im.save(img_f + '.part', 'JPEG', quality=90); os.replace(img_f + '.part', img_f)
    m = {'url': p['url'], 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'w': w0, 'h': h0,
         'fed_w': im.size[0], 'fed_h': im.size[1], 'ink': ink(img_f)}
    json.dump(m, open(meta_f, 'w')); return m

def fetch_chunk(ch):
    pages = [p for b in ch for p in books[b]]
    with ThreadPoolExecutor(a.fetchers) as ex: list(ex.map(fetch_one, pages))

# ── paddle: CLIENTS runners over a chunk manifest, restart on exit 3, then one retry of every .err ─────
def paddle(rows, tag):
    if not rows: return
    mf = f'{O}/chunks/{tag}.tsv'
    with open(mf, 'w') as f:
        for p in rows: f.write(f'{p["bid"]}\t{p["pn"]}\t{O}/img/{p["bid"]}/{p["pn"]}.jpg\n')
    def runner(i):
        for k in range(6):
            rc = subprocess.run([a.py, a.runner, '--manifest', mf, '--root', f'{O}/paddle', '--worker', str(i), '--workers', str(a.clients),
                                 '--page-timeout', '90', '--max-side', '0', '--layout', '0', '--backend', 'server', '--prefetch', '4'],
                                stdout=open(f'{O}/paddle/worker-{i}.log', 'a'), stderr=subprocess.STDOUT).returncode
            if rc != 3: return rc
            log(f'{tag} runner {i} exited 3 (wedged page): restart {k + 1}')
    ths = [threading.Thread(target=runner, args=(i,)) for i in range(a.clients)]
    for t in ths: t.start()
    for t in ths: t.join()

def out(p, ext): return f'{O}/paddle/out/{p["bid"]}/{p["pn"]}.{ext}'

def read_chunk(ch, n):
    rows = []
    for b in ch:
        for p in books[b]:
            m = json.load(open(f'{O}/meta/{p["bid"]}/{p["pn"]}.json'))
            if not m.get('error'): rows.append(p)
    t0 = time.time()
    paddle(rows, f'c{n:03d}')
    retry = [p for p in rows if os.path.exists(out(p, 'err')) and not os.path.exists(out(p, 'err.1'))]
    for p in retry: os.replace(out(p, 'err'), out(p, 'err.1'))
    if retry: log(f'c{n:03d}: retrying {len(retry)} errored pages once'); paddle(retry, f'c{n:03d}-retry')
    return len(rows), time.time() - t0

# ── assemble: guard + one JSONL per book, then drop its images ───────────────────────────────────────
def assemble(ch):
    tally = {}
    for b in ch:
        recs = []
        for p in books[b]:
            m = json.load(open(f'{O}/meta/{p["bid"]}/{p["pn"]}.json'))
            r = {'page_id': p['pid'], 'book_id': b, 'page_number': p['pn'], 'class': p['class'], 'text': None, 'error': None, 'guard': None,
                 'image': {k: m.get(k) for k in ('url', 'sha256', 'bytes', 'w', 'h', 'fed_w', 'fed_h')}, 'run': RUN['run'], 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            if m.get('error'): r['error'] = m['error']; r['route'] = 'UNREAD'
            elif os.path.exists(out(p, 'txt')):
                r['text'] = open(out(p, 'txt')).read()
                g = guard(r['text'], m['ink']); r['guard'] = g; r['route'] = g['route']
            else:
                e = out(p, 'err') if os.path.exists(out(p, 'err')) else out(p, 'err.1')
                r['error'] = 'paddle: ' + (open(e).read()[:200] if os.path.exists(e) else 'no output'); r['route'] = 'UNREAD'
            r['ink'] = m.get('ink')
            tally[r['route']] = tally.get(r['route'], 0) + 1
            recs.append(r)
        with open(f'{O}/books/{b}.jsonl.part', 'w') as f:
            for r in recs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
        os.replace(f'{O}/books/{b}.jsonl.part', f'{O}/books/{b}.jsonl')
        shutil.rmtree(f'{O}/img/{b}', ignore_errors=True)
    return tally

# ── the loop: fetch chunk n+1 while the GPU reads chunk n ────────────────────────────────────────────
total = {}
done_pages = 0; t_start = time.time()
nxt = threading.Thread(target=fetch_chunk, args=(chunks[0],)) if chunks else None
if nxt: nxt.start()
for n, ch in enumerate(chunks):
    nxt.join()
    if n + 1 < len(chunks): nxt = threading.Thread(target=fetch_chunk, args=(chunks[n + 1],)); nxt.start()
    k, secs = read_chunk(ch, n)
    t = assemble(ch)
    for r, c in t.items(): total[r] = total.get(r, 0) + c
    done_pages += sum(len(books[b]) for b in ch)
    rate = done_pages / max(1, time.time() - t_start) * 3600
    log(f'c{n:03d}: {len(ch)} books, {k} pages read in {secs:.0f}s; routes {t}; total {total}; {done_pages} pages, {rate:.0f} pp/h overall')
json.dump({'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'routes_this_pass': total,
           'books_done': len(glob.glob(f'{O}/books/*.jsonl')), 'books_total': len(books)}, open(f'{O}/finished.json', 'w'), indent=1)
log(f'FINISHED {total}')
