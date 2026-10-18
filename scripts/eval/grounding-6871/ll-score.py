#!/usr/bin/env python3
"""ll-score.py — per-token log p(stored read | image) and log p(stored read | no image), teacher-forced, on gex45.

PRIOR ART: scripts/gpu/gex45-bench-6871/vlm-bench.py `ll-img` / `ll-text` (the capability card's speed check of the
same pair: one vLLM server, prompt_logprobs, prefill only). That kept only a tail mean per page; this keeps every
token's two log-probs and its character offsets in the read, so a span scorer can be run off-box.

  ll-score.py fetch <items.jsonl> <img dir>                     download each page image once (archived master)
  ll-score.py score <items.jsonl> <img dir> <out.jsonl> [--cap 2400] [--clients 16] [--only ids.txt] [--limit N]
Writes one row per item: {item, n, ok, off:[[s,e]..], img:[..], txt:[..]} (log-probs to 4 dp). Resumable: items
already in <out.jsonl> are skipped. Same prompt both ways (the bench transcription prompt); "no image" = the image
part removed, as in arXiv 2605.27750 (C.2). The model is whatever the server on --url serves.
"""
import argparse, base64, io, json, os, sys, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor

GENERIC = ('Transcribe ALL text visible in this image using the appropriate Unicode script. '
           'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.')

ap = argparse.ArgumentParser()
ap.add_argument('cmd'); ap.add_argument('items'); ap.add_argument('imgdir'); ap.add_argument('out', nargs='?')
ap.add_argument('--url', default='http://127.0.0.1:8000/v1'); ap.add_argument('--model', default='m')
ap.add_argument('--tokenizer', default='Qwen/Qwen2.5-VL-7B-Instruct-AWQ')
ap.add_argument('--cap', type=int, default=2400); ap.add_argument('--clients', type=int, default=16)
ap.add_argument('--only', default=''); ap.add_argument('--limit', type=int, default=0)
a = ap.parse_args()
items = [json.loads(l) for l in open(a.items) if l.strip()]
os.makedirs(a.imgdir, exist_ok=True)
imgf = lambda it: os.path.join(a.imgdir, it['page_id'] + '.jpg')

if a.cmd == 'fetch':
    todo = {it['page_id']: it['image'] for it in items if it.get('image') and not os.path.exists(imgf(it))}
    def get(kv):
        pid, url = kv
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'sourcelibrary-eval-6871'})
            data = urllib.request.urlopen(req, timeout=60).read()
            open(os.path.join(a.imgdir, pid + '.jpg'), 'wb').write(data); return 1
        except Exception as e:  # noqa: BLE001
            print(pid, str(e)[:100], file=sys.stderr); return 0
    with ThreadPoolExecutor(8) as ex: n = sum(ex.map(get, todo.items()))
    print(json.dumps({'wanted': len(todo), 'fetched': n})); sys.exit(0)

from PIL import Image
from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained(a.tokenizer)
done = set()
if os.path.exists(a.out):
    done = {json.loads(l)['item'] for l in open(a.out) if l.strip()}
only = set(open(a.only).read().split()) if a.only else None
todo = [it for it in items if it['item'] not in done and os.path.exists(imgf(it)) and (only is None or it['item'] in only)]
if a.limit: todo = todo[:a.limit]
lock = threading.Lock(); sink = open(a.out, 'a')


def b64(path):
    im = Image.open(path).convert('RGB')
    s = a.cap / max(im.size)
    if s < 1: im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def plp(text, img):
    user = [{'type': 'text', 'text': GENERIC}]
    if img: user = [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + img}}] + user
    body = {'model': a.model, 'max_tokens': 1, 'temperature': 0, 'prompt_logprobs': 0,
            'add_generation_prompt': False, 'continue_final_message': True,
            'messages': [{'role': 'user', 'content': user}, {'role': 'assistant', 'content': text}]}
    req = urllib.request.Request(a.url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=900))
    ids, lps = [], []
    for d in r.get('prompt_logprobs') or []:
        if not d: continue
        k, v = next(iter(d.items()))   # prompt_logprobs=0 → the prompt token itself only
        ids.append(int(k)); lps.append(v['logprob'])
    return ids, lps


def work(it):
    text = it['text']
    enc = tok(text, add_special_tokens=False, return_offsets_mapping=True)
    cid, off = enc['input_ids'], enc['offset_mapping']
    try:
        ii, li = plp(text, b64(imgf(it)))
        it_, lt = plp(text, None)
        n = len(cid)
        ok = ii[-n:] == cid and it_[-n:] == cid
        rec = {'item': it['item'], 'n': n, 'ok': ok, 'off': [list(o) for o in off],
               'img': [round(x, 4) for x in li[-n:]], 'txt': [round(x, 4) for x in lt[-n:]]}
    except Exception as e:  # noqa: BLE001
        rec = {'item': it['item'], 'error': str(e)[:300]}
    with lock:
        sink.write(json.dumps(rec) + '\n'); sink.flush()


with ThreadPoolExecutor(a.clients) as ex: list(ex.map(work, todo))
print(json.dumps({'scored': len(todo), 'skipped_done': len(done)}))
