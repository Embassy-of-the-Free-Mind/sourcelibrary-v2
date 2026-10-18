#!/usr/bin/env python3
"""read.py — one engine over the residue reference images, full text kept (#6871 item 3).

PRIOR ART: gex45 /root/jobs/gpu-bench-6871/code/vlm-bench.py (job gpu-bench-6871: the GLM-OCR and MinerU message
shapes and the timing loop, copied) — it keeps only the first 80 characters of each output, for speed only;
scripts/gpu/ocr-bakeoff-r3-5660/vlm-run.py (one .txt per page, a rented pod). This keeps the whole text as one jsonl
row per page and times the pass.

  read.py <mode> <img dir> <out.jsonl> [--url http://127.0.0.1:8000/v1] [--clients 16] [--max-tokens 4500]
mode: glm | generic (the preregistered plain prompt; PROMPT is shared with gemini-arm.mjs) | mineru
Writes <out.jsonl> rows {page_id, text, secs, finish, out_tok} and <out.jsonl>.run.json {wall_secs, pages_per_hour}.
"""
import argparse, base64, json, os, threading, time, urllib.request

PROMPT = ('This is one page of a Chinese woodblock-printed book. Transcribe ALL the Chinese text on it exactly as '
          'printed: traditional characters, keep variant character forms, do not modernise or simplify. Read the '
          'columns from right to left, each column from top to bottom, and write one line per printed column. '
          'Double-line small notes go inline where they occur. Do not add punctuation. Do not translate or explain. '
          'Write any Manchu, Mongolian or Tibetan script as [滿文], [蒙文] or [藏文]. If the page has no text, output '
          'nothing. Output only the transcription.')

ap = argparse.ArgumentParser()
ap.add_argument('mode'); ap.add_argument('imgs'); ap.add_argument('out')
ap.add_argument('--url', default='http://127.0.0.1:8000/v1'); ap.add_argument('--model', default='m')
ap.add_argument('--clients', type=int, default=16); ap.add_argument('--max-tokens', type=int, default=4500)
ap.add_argument('--temperature', type=float, default=0.0)
a = ap.parse_args()
names = sorted(f for f in os.listdir(a.imgs) if f.endswith('.jpg'))
done = set()
if os.path.exists(a.out):
    done = {json.loads(l)['page_id'] for l in open(a.out) if l.strip() and 'error' not in json.loads(l)}
todo = [n for n in names if n[:-4] not in done]


def b64(p): return base64.b64encode(open(p, 'rb').read()).decode()


def post(url, body, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **(headers or {})})
    return json.load(urllib.request.urlopen(req, timeout=900))


def call(path):
    if a.mode == 'mineru':
        from PIL import Image
        blocks = tls.client.two_step_extract(Image.open(path).convert('RGB'))
        txt = '\n'.join(str(getattr(b, 'content', None) or (b.get('content') if isinstance(b, dict) else '') or '') for b in blocks)
        return txt, None, None
    img = {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64(path)}}
    text = 'Text Recognition:' if a.mode == 'glm' else PROMPT
    body = {'model': a.model, 'temperature': a.temperature, 'max_tokens': a.max_tokens,
            'messages': [{'role': 'user', 'content': [img, {'type': 'text', 'text': text}]}]}
    r = post(a.url + '/chat/completions', body)
    c = r['choices'][0]
    return c['message']['content'] or '', c.get('finish_reason'), r.get('usage', {})


tls = threading.local(); lock = threading.Lock(); q = list(todo)
sink = open(a.out, 'a')


def run():
    if a.mode == 'mineru':
        from mineru_vl_utils import MinerUClient
        tls.client = MinerUClient(backend='http-client', server_url=a.url.rsplit('/v1', 1)[0], image_analysis=False)
    while True:
        with lock:
            if not q: return
            n = q.pop(0)
        s = time.time()
        rec = {'page_id': n[:-4]}
        for attempt in range(3):
            try:
                txt, fin, u = call(os.path.join(a.imgs, n))
                rec.update(text=txt, secs=round(time.time() - s, 2), finish=fin, out_tok=(u or {}).get('completion_tokens'),
                           in_tok=(u or {}).get('prompt_tokens'))
                rec.pop('error', None)
                break
            except Exception as e:  # noqa: BLE001
                rec['error'] = str(e)[:300]; time.sleep(5 * (attempt + 1))
        with lock: sink.write(json.dumps(rec, ensure_ascii=False) + '\n'); sink.flush()


t0 = time.time()
ths = [threading.Thread(target=run) for _ in range(a.clients)]
for t in ths: t.start()
for t in ths: t.join()
wall = time.time() - t0
rows = [json.loads(l) for l in open(a.out) if l.strip()]
run = {'mode': a.mode, 'model': a.model, 'pages_this_pass': len(todo), 'clients': a.clients, 'wall_secs': round(wall, 1),
       'pages_per_hour': round(len(todo) / wall * 3600) if todo else None,
       'errors': sum(1 for r in rows if 'error' in r), 'hit_cap': sum(1 for r in rows if r.get('finish') == 'length'),
       'out_tok': sum(r.get('out_tok') or 0 for r in rows), 'in_tok': sum(r.get('in_tok') or 0 for r in rows)}
json.dump(run, open(a.out + '.run.json', 'w'), indent=1)
print(json.dumps(run))
