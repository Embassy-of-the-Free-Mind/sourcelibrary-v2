#!/usr/bin/env python3
"""vlm-bench.py — throughput of one vLLM-served model on the GEX45 (#6871 capability card). Speed only.

PRIOR ART: scripts/gpu/ocr-bakeoff-r3-5660/vlm-run.py (the per-engine prompts and message shapes for GLM-OCR and
dots.ocr are copied from it unchanged) and mineru-run.py (MinerU two-step client). Those write one .txt per page
for scoring; this one keeps the outputs only as a sanity check and reports items/h, output tokens/s and errors.

  vlm-bench.py <mode> <items> <out dir> [--url http://127.0.0.1:8000/v1] [--clients 16] [--max-tokens 4500]

mode: glm | dots | olmocr | generic (any VLM, the bench transcription prompt) | mineru | llm (text items)
      | ll-img / ll-text: a SCORING pass (prefill only, prompt_logprobs) of a stored transcript, with and without
        the page image — the image-free vs image-conditioned likelihood check (#6871 row A; --texts ocr.jsonl)
items: a directory of .jpg (OCR modes) or a texts.jsonl ({text}) for llm.
A warm-up of 4 items (horizontally flipped images, so no prefix-cache hit) runs first and is not timed.
Writes <out>/run.json and <out>/items.jsonl.
"""
import argparse, base64, io, json, os, re, threading, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('mode'); ap.add_argument('items'); ap.add_argument('out')
ap.add_argument('--url', default='http://127.0.0.1:8000/v1'); ap.add_argument('--model', default='m')
ap.add_argument('--clients', type=int, default=16); ap.add_argument('--max-tokens', type=int, default=4500)
ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--texts', default='', help='ll modes: jsonl {item, text}, the transcript scored for each image')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

GENERIC = ('Transcribe ALL text visible in this image using the appropriate Unicode script. '
           'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.')
# olmOCR-2's own prompt (olmocr build_no_anchoring_v4_yaml_prompt), sent after the image as in its pipeline
OLMOCR = ('Attached is one page of a document that you must process. Just return the plain text representation of '
          'this document as if you were reading it naturally. Convert equations to LateX and tables to HTML.\n'
          'If there are any figures or charts, label them with the following markdown syntax '
          '![Alt text describing the contents of the figure](page_startx_starty_width_height.png)\n'
          'Return your output as markdown, with a front matter section on top specifying values for the '
          'primary_language, is_rotation_valid, rotation_correction, is_table, and is_diagram parameters.')
DOTS_PROMPT = """Please output the layout information from the PDF image, including each layout element's bbox, its category, and the corresponding text content within the bbox.

1. Bbox format: [x1, y1, x2, y2]

2. Layout Categories: The possible categories are ['Caption', 'Footnote', 'Formula', 'List-item', 'Page-footer', 'Page-header', 'Picture', 'Section-header', 'Table', 'Text', 'Title'].

3. Text Extraction & Formatting Rules:
    - Picture: For the 'Picture' category, the text field should be omitted.
    - Formula: Format its text as LaTeX.
    - Table: Format its text as HTML.
    - All Others (Text, Title, etc.): Format their text as Markdown.

4. Constraints:
    - The output text must be the original text from the image, with no translation.
    - All layout elements must be sorted according to human reading order.

5. Final Output: The entire output must be a single JSON object.
"""
# the text-LLM arm: a QC-screen-shaped call (a page of text in, a short JSON verdict out), thinking off
QC = ('You check one page of an English translation of a historical book for defects: untranslated passages, '
      'repeated or looping text, truncation, invented headings. Reply with JSON only: '
      '{"defects": [<short strings>], "ok": true|false}.\n\nPAGE:\n')

if a.mode == 'llm':
    items = [json.loads(l)['text'] for l in open(a.items) if l.strip()]
    names = [str(i) for i in range(len(items))]
else:
    names = sorted(f for f in os.listdir(a.items) if f.endswith('.jpg'))
    items = [os.path.join(a.items, f) for f in names]
if a.mode.startswith('ll-'):
    tx = {j['item']: j['text'][:8000] for j in map(json.loads, open(a.texts)) if len(j['text']) > 20}
    keep = [i for i, n in enumerate(names) if n in tx]
    names, items = [names[i] for i in keep], [items[i] for i in keep]
if a.limit:
    items, names = items[:a.limit], names[:a.limit]


def b64img(path, flip=False):
    if not flip:
        return base64.b64encode(open(path, 'rb').read()).decode()
    from PIL import Image, ImageOps
    buf = io.BytesIO(); ImageOps.mirror(Image.open(path).convert('RGB')).save(buf, 'JPEG', quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def messages(item, flip=False):
    if a.mode == 'llm':
        return [{'role': 'user', 'content': QC + item[:12000]}]
    img = {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64img(item, flip)}}
    if a.mode == 'glm':
        return [{'role': 'user', 'content': [img, {'type': 'text', 'text': 'Text Recognition:'}]}]
    if a.mode == 'dots':
        return [{'role': 'user', 'content': [img, {'type': 'text', 'text': '<|img|><|imgpad|><|endofimg|>' + DOTS_PROMPT}]}]
    if a.mode == 'olmocr':
        return [{'role': 'user', 'content': [{'type': 'text', 'text': OLMOCR}, img]}]
    return [{'role': 'user', 'content': [img, {'type': 'text', 'text': GENERIC}]}]


def call_ll(item, flip):
    name = os.path.basename(item)
    user = [{'type': 'text', 'text': GENERIC}]
    if a.mode == 'll-img':
        user = [{'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + b64img(item, flip)}}] + user
    body = {'model': a.model, 'max_tokens': 1, 'temperature': 0, 'prompt_logprobs': 0,
            'add_generation_prompt': False, 'continue_final_message': True,
            'messages': [{'role': 'user', 'content': user}, {'role': 'assistant', 'content': tx[name]}]}
    req = urllib.request.Request(a.url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=900))
    lp = [next(iter(d.values()))['logprob'] for d in (r.get('prompt_logprobs') or []) if d]
    tail = lp[-200:]   # the transcript's last 200 tokens: a sanity readout only (image-conditioned should be higher)
    return 'x' * len(tx[name]), 'scored', {'prompt_tokens': (r.get('usage') or {}).get('prompt_tokens'),
                                           'completion_tokens': 0, 'tail_mean_logprob': round(sum(tail) / len(tail), 4) if tail else None}


def call(item, flip=False):
    if a.mode.startswith('ll-'):
        return call_ll(item, flip)
    if a.mode == 'mineru':
        from PIL import Image, ImageOps
        im = Image.open(item).convert('RGB')
        if flip: im = ImageOps.mirror(im)
        blocks = tls.client.two_step_extract(im)
        txt = '\n'.join(str(getattr(b, 'content', None) or (b.get('content') if isinstance(b, dict) else '') or '') for b in blocks)
        return txt, None, None
    body = {'model': a.model, 'temperature': 0, 'max_tokens': a.max_tokens, 'messages': messages(item, flip)}
    if a.mode == 'llm':
        body['chat_template_kwargs'] = {'enable_thinking': False}
    req = urllib.request.Request(a.url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=900))
    c = r['choices'][0]
    return c['message']['content'] or '', c.get('finish_reason'), r.get('usage', {})


tls = threading.local()
lock = threading.Lock()


def pool(work_items, flip, sink):
    q = list(work_items)

    def run():
        if a.mode == 'mineru':
            from mineru_vl_utils import MinerUClient
            tls.client = MinerUClient(backend='http-client', server_url=a.url.rsplit('/v1', 1)[0], image_analysis=False)
        while True:
            with lock:
                if not q: return
                name, item = q.pop(0)
            s = time.time()
            try:
                txt, fin, usage = call(item, flip)
                rec = {'item': name, 'secs': round(time.time() - s, 2), 'chars': len(txt), 'finish': fin,
                       'in_tok': (usage or {}).get('prompt_tokens'), 'out_tok': (usage or {}).get('completion_tokens'), 'head': txt[:80],
                       'tail_mean_logprob': (usage or {}).get('tail_mean_logprob')}
            except Exception as e:  # noqa: BLE001
                rec = {'item': name, 'error': str(e)[:200]}
            if sink:
                with lock: sink.write(json.dumps(rec, ensure_ascii=False) + '\n'); sink.flush()
    ths = [threading.Thread(target=run) for _ in range(a.clients)]
    for t in ths: t.start()
    for t in ths: t.join()


pool(list(zip(names[:4], items[:4])), True, None)          # warm-up, untimed
t0 = time.time()
with open(os.path.join(a.out, 'items.jsonl'), 'w') as sink:
    pool(list(zip(names, items)), False, sink)
wall = time.time() - t0
recs = [json.loads(l) for l in open(os.path.join(a.out, 'items.jsonl'))]
ok = [r for r in recs if 'error' not in r]
out_tok = sum(r.get('out_tok') or 0 for r in ok)
run = {'mode': a.mode, 'items': len(items), 'ok': len(ok), 'errors': len(recs) - len(ok), 'clients': a.clients,
       'max_tokens': a.max_tokens, 'wall_secs': round(wall, 1), 'items_per_hour': round(len(ok) / wall * 3600),
       'secs_per_item': round(wall / max(1, len(ok)), 3), 'out_tok_per_s': round(out_tok / wall, 1) if out_tok else None,
       'mean_out_tok': round(out_tok / max(1, len(ok))) if out_tok else None,
       'hit_cap': sum(1 for r in ok if r.get('finish') == 'length')}
json.dump(run, open(os.path.join(a.out, 'run.json'), 'w'), indent=1)
print(json.dumps(run))
