#!/usr/bin/env python3
"""surya-print-read.py — the GPU half of scripts/workers/gpu-print-lane.mjs --lang sa (v3 #95): Surya 2 over the lane's
manifest.tsv (<bid>\t<pn>\t<pid>\t<url>), in batches, against a vLLM server already up.

PRIOR ART: scripts/gpu/gpu-print-read.py (the LightOnOCR manifest reader: skips pages already back, one file a page,
nothing to Mongo; it does not fit because Surya 2 is driven by its own CLI over a directory of images, not by one chat
request a page) and scripts/eval/sanskrit-gex45-7243/surya-collect.py (how the #7243 tests turned Surya 2's results.json
into text: blocks in reading_order, <br> and block tags to newlines, other tags dropped; `text_of` is copied from it so
the lane reads as the tests measured).

  surya-print-read.py <lane dir> --surya /root/bench/surya/bin/surya_ocr [--url http://127.0.0.1:8010/v1]
      [--batch 200] [--fetchers 8] [--limit N] [--deadline EPOCH]

Per batch: fetch each page image (long side capped at 2,400 px, the tests' cap) into <lane>/tmp/<batch>/in, run
`surya_ocr in --output_dir out` (SURYA_INFERENCE_URL / SURYA_INFERENCE_BACKEND=vllm, as drive.sh ran it), write
<lane>/out/<bid>/<pn>.json {page_id, text, labels, blocks, skipped_blocks, block_errors, image_sha256, image_url,
image_px, secs} or <pn>.err, then DELETE the batch directory (gex45's root disk is small). Nothing goes to Mongo.

A page whose image cannot be fetched gets an .err at once (the lane's requeue-errors retries a transient one). A page
the engine left out of results.json, or whose every block errored with no text, gets an .err too. A FAILED BATCH (a
non-zero exit, nothing back while the server does not answer, or most pages dead) writes nothing: its pages stay owed
and the next chunk reads them; two failed batches in a row stop the run with exit 1 (the filler counts failed chunks).
`labels` (the engine's block labels, counted) is kept for the lane's guard and for the pilot's tally.
"""
import argparse, collections, glob, hashlib, html, io, json, os, re, shutil, subprocess, sys, threading, time, urllib.request
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('lane'); ap.add_argument('--surya', required=True); ap.add_argument('--url', default='http://127.0.0.1:8010/v1')
ap.add_argument('--batch', type=int, default=200); ap.add_argument('--fetchers', type=int, default=8)
ap.add_argument('--limit', type=int, default=0); ap.add_argument('--deadline', type=float, default=0)
ap.add_argument('--batch-timeout', type=int, default=3600)
a = ap.parse_args()
OUT = os.path.join(a.lane, 'out'); TMP = os.path.join(a.lane, 'tmp'); MAX_SIDE = 2400

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
            req = urllib.request.Request(url, headers={'User-Agent': 'sourcelibrary-gpu-print'})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:  # noqa: BLE001
            err = e; time.sleep(3 * (i + 1))
    raise err


def text_of(h):
    """Surya 2 block html → text, as scripts/eval/sanskrit-gex45-7243/surya-collect.py did."""
    h = re.sub(r'(?i)<br\s*/?>|</(p|div|li|tr|h\d)>', '\n', h or '')
    return html.unescape(re.sub(r'<[^>]+>', ' ', h)).strip()


def page_read(pages):
    """One image's entry of results.json (a list of pages, or one page) → (text, labels, blocks, skipped, errors)."""
    parts, labels, n, skipped, errors = [], collections.Counter(), 0, 0, 0
    for p in (pages if isinstance(pages, list) else [pages]):
        for b in sorted(p.get('blocks', []), key=lambda b: b.get('reading_order', 0)):
            n += 1
            if b.get('error'): errors += 1
            if b.get('skipped'): skipped += 1; continue
            labels[str(b.get('label') or 'unlabelled')] += 1
            if b.get('html'): parts.append(text_of(b['html']))
        parts += [l.get('text', '') for l in p.get('text_lines', [])]   # Surya 1 layout, if ever present
    return '\n'.join(x for x in parts if x), dict(labels), n, skipped, errors


def stem(bid, pn):
    return f'{bid}__{pn}'


def server_up():
    try:
        urllib.request.urlopen(a.url + '/models', timeout=10).read(); return True
    except Exception:  # noqa: BLE001
        return False


def write_err(bid, pn, msg):
    os.makedirs(f'{OUT}/{bid}', exist_ok=True)
    open(f'{OUT}/{bid}/{pn}.err', 'w').write(msg[:500])


def fetch_batch(batch, indir):
    """Images of the batch into indir; returns {stem: meta} for the pages that have one. A fetch error is an .err now."""
    got, lock, q = {}, threading.Lock(), list(batch)

    def worker():
        while True:
            with lock:
                if not q: return
                bid, pn, pid, url = q.pop(0)
            try:
                buf = fetch(url)
                im = Image.open(io.BytesIO(buf)).convert('RGB'); s = MAX_SIDE / max(im.size)
                if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
                im.save(os.path.join(indir, stem(bid, pn) + '.jpg'), format='JPEG', quality=90)
                with lock: got[stem(bid, pn)] = dict(bid=bid, pn=pn, pid=pid, url=url, sha=hashlib.sha256(buf).hexdigest(), px=list(im.size))
            except Exception as e:  # noqa: BLE001
                write_err(bid, pn, f'{type(e).__name__}: {str(e)[:400]}')
                with lock: n['err'] += 1
    ths = [threading.Thread(target=worker) for _ in range(a.fetchers)]
    for t in ths: t.start()
    for t in ths: t.join()
    return got


n = {'ok': 0, 'err': 0, 'batches': 0, 'failed_batches': 0}
t_all = time.time(); failed_run = 0; i = 0
while i < len(rows):
    if a.deadline and time.time() > a.deadline: break
    batch = rows[i:i + a.batch]; i += a.batch
    bdir = os.path.join(TMP, f'b{int(time.time())}-{i}'); indir, outdir = os.path.join(bdir, 'in'), os.path.join(bdir, 'out')
    os.makedirs(indir, exist_ok=True); t0 = time.time()
    try:
        got = fetch_batch(batch, indir)
        if not got: continue
        env = dict(os.environ, SURYA_INFERENCE_URL=a.url, SURYA_INFERENCE_BACKEND='vllm')
        r = subprocess.run([a.surya, indir, '--output_dir', outdir], env=env, capture_output=True, text=True, timeout=a.batch_timeout)
        results = {}
        for f in glob.glob(os.path.join(outdir, '**', 'results.json'), recursive=True):
            results.update(json.load(open(f)))
        reads = {st: (page_read(results[k]) if (k := st if st in results else st + '.jpg') in results else None) for st in got}
        # every block errored and no text came back: the engine's fault on this page, not a blank leaf
        dead = {st for st, x in reads.items() if x is not None and not x[0].strip() and x[4] > 0}
        # A FAILED BATCH is the engine or the server failing, not the pages: a non-zero exit, nothing back while the
        # server does not answer, or most pages dead. Nothing is written; the pages stay owed for the next chunk.
        if r.returncode != 0 or (not results and not server_up()) or len(dead) > len(got) / 2:
            n['failed_batches'] += 1; failed_run += 1
            print(f'batch failed (rc {r.returncode}, {len(results)} results, {len(dead)} dead of {len(got)}): {(r.stderr or r.stdout)[-300:]}', flush=True)
            if failed_run >= 2: break
            continue
        failed_run = 0; n['batches'] += 1; secs = round((time.time() - t0) / max(1, len(got)), 2)
        for st, m in got.items():
            if reads[st] is None:
                write_err(m['bid'], m['pn'], 'SuryaMissing: the page is not in results.json'); n['err'] += 1; continue
            if st in dead:
                write_err(m['bid'], m['pn'], f'SuryaBlockError: {reads[st][4]} block(s) errored and no text came back'); n['err'] += 1; continue
            text, labels, blocks, skipped, errors = reads[st]
            os.makedirs(f"{OUT}/{m['bid']}", exist_ok=True)
            json.dump({'page_id': m['pid'], 'text': text, 'finish': None, 'labels': labels, 'blocks': blocks, 'skipped_blocks': skipped,
                       'block_errors': errors, 'image_sha256': m['sha'], 'image_url': m['url'], 'image_px': m['px'], 'secs': secs},
                      open(f"{OUT}/{m['bid']}/{m['pn']}.json", 'w'), ensure_ascii=False)
            n['ok'] += 1
    except subprocess.TimeoutExpired:
        n['failed_batches'] += 1; failed_run += 1
        print(f'batch timed out after {a.batch_timeout} s', flush=True)
        if failed_run >= 2: break
    finally:
        shutil.rmtree(bdir, ignore_errors=True)

w = time.time() - t_all
print(json.dumps({**n, 'wall_secs': round(w, 1), 'pages_per_hour': round((n['ok'] + n['err']) / w * 3600) if w else None, 'left': max(0, len(rows) - i)}), flush=True)
sys.exit(1 if failed_run >= 2 else 0)
