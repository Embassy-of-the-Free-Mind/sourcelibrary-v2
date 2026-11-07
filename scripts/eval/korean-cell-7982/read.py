#!/usr/bin/env python3
"""read.py — one vLLM-served engine over the #7982 Korean test pages, full text kept.

PRIOR ART: scripts/eval/sanskrit-gex45-7243/read.py (copied unchanged but for mode `kore`, the Korean prompt below, which
replaces its Devanagari one; its own prior art is in that file). No other change: one jsonl row per page.

  read.py <mode> <img dir> <out.jsonl> [--url http://127.0.0.1:8010/v1] [--clients 8] [--max-tokens 6000]
mode: kore (the prompt below) | generic
"""
import argparse, base64, json, os, threading, time, urllib.request

PROMPT = ('Transcribe ALL text visible in this image using the appropriate Unicode script. '
          'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.')
DEVA = ('Transcribe ALL text visible in this image using the appropriate Unicode script. The main text is Devanagari '
        '(Sanskrit, sometimes Hindi or Marathi). Output ONLY the raw text, line by line. No commentary, no translation, '
        'no transliteration, no labels, no markdown.')
KORE = ('Transcribe ALL text visible in this image using the appropriate Unicode script. The page is from a historical '
        'Korean book: classical Chinese in hanja, Korean in hangul, or both mixed; often vertical columns read top to bottom, '
        'right to left, with small double-column notes. Keep hanja as hanja and hangul as hangul, exactly as written; do not '
        'convert, modernize or translate. Output ONLY the raw text, one column or line per line. No commentary, no labels, no markdown.')
DOTS_OCR = 'Extract the text content from this image.'   # dots.ocr prompt_ocr (dict_promptmode_to_prompt)
# olmOCR-2's own prompt (olmocr build_no_anchoring_v4_yaml_prompt), sent after the image as in its pipeline
OLMOCR = ('Attached is one page of a document that you must process. Just return the plain text representation of '
          'this document as if you were reading it naturally. Convert equations to LateX and tables to HTML.\n'
          'If there are any figures or charts, label them with the following markdown syntax '
          '![Alt text describing the contents of the figure](page_startx_starty_width_height.png)\n'
          'Return your output as markdown, with a front matter section on top specifying values for the '
          'primary_language, is_rotation_valid, rotation_correction, is_table, and is_diagram parameters.')

ap = argparse.ArgumentParser()
ap.add_argument('mode'); ap.add_argument('imgs'); ap.add_argument('out')
ap.add_argument('--url', default='http://127.0.0.1:8000/v1'); ap.add_argument('--model', default='m')
ap.add_argument('--clients', type=int, default=16); ap.add_argument('--max-tokens', type=int, default=6000)
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
    if a.mode == 'olmocr': content = [{'type': 'text', 'text': OLMOCR}, img]
    elif a.mode == 'dotsocr': content = [img, {'type': 'text', 'text': '<|img|><|imgpad|><|endofimg|>' + DOTS_OCR}]
    else: content = [img, {'type': 'text', 'text': {'glm': 'Text Recognition:', 'deva': DEVA, 'kore': KORE}.get(a.mode, PROMPT)}]
    body = {'model': a.model, 'temperature': a.temperature, 'max_tokens': a.max_tokens,
            'messages': [{'role': 'user', 'content': content}]}
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
