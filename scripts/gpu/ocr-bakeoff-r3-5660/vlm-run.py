#!/usr/bin/env python3
"""#5660 round 3: one open OCR VLM (vLLM OpenAI server) over the bench manifest, one .txt per page.

  vlm-run.py <manifest.tsv> <arm dir> <server url> <served model> <mode: glm|dots|nanonets> <max_tokens>

Each mode sends the model its OWN documented prompt and message shape (prereg Amendment 2), the page JPEG
as is (<= 2400 px wide, the same file every arm reads), temperature 0, one attempt, CLIENTS threads.
Client-side output handling is the only convention applied here, the same for every page:
  - a leading/trailing ``` code fence line is dropped (glm, nanonets);
  - dots: the layout JSON's `text` fields are joined in the model's own order, Picture elements skipped;
    if the JSON is cut off (finish=length) the `text` strings are recovered by regex (counted in timings).
The raw response is kept beside the text (<slug>.raw) for by-eye reads.
"""
import base64, json, os, re, sys, threading, time, urllib.request

man, root, url, model, mode, max_tokens = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], int(sys.argv[6])
CLIENTS = int(os.environ.get('CLIENTS', '8'))
BENCH = os.environ.get('BENCH', '/root/pz/bench')
rows = [l.rstrip('\n').split('\t') for l in open(man) if l.strip()]
out = os.path.join(root, 'out', '_bench'); os.makedirs(out, exist_ok=True)

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
NANONETS_PROMPT = ("Extract the text from the above document as if you were reading it naturally. Return the tables in html format. "
                   "Return the equations in LaTeX representation. If there is an image in the document and image caption is not present, "
                   "add a small description of the image inside the <img></img> tag; otherwise, add the image caption inside <img></img>. "
                   "Watermarks should be wrapped in brackets. Ex: <watermark>OFFICIAL COPY</watermark>. Page numbers should be wrapped in "
                   "brackets. Ex: <page_number>14</page_number> or <page_number>9/22</page_number>. Prefer using ☐ and ☑ for check boxes.")


def messages(b64):
    img = {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{b64}'}}
    if mode == 'glm':        # vLLM recipe zai-org/GLM-OCR: image, then "Text Recognition:"
        return [{'role': 'user', 'content': [img, {'type': 'text', 'text': 'Text Recognition:'}]}]
    if mode == 'dots':       # dots_ocr/model/inference.py: image, then the img-pad prefix + prompt_layout_all_en
        return [{'role': 'user', 'content': [img, {'type': 'text', 'text': '<|img|><|imgpad|><|endofimg|>' + DOTS_PROMPT}]}]
    if mode == 'nanonets':   # model card: system line, image, then the card's OCR prompt
        return [{'role': 'system', 'content': 'You are a helpful assistant.'}, {'role': 'user', 'content': [img, {'type': 'text', 'text': NANONETS_PROMPT}]}]
    raise SystemExit(f'unknown mode {mode}')


FENCE = re.compile(r'^\s*```[a-zA-Z]*\s*$', re.M)
def to_text(content):
    if mode != 'dots':
        return FENCE.sub('', content).strip('\n'), None
    s = content.strip()
    s = re.sub(r'^```(?:json)?\s*|\s*```$', '', s)
    try:
        els = json.loads(s)
        if isinstance(els, dict): els = els.get('layout') or els.get('elements') or [els]
        return '\n'.join(e.get('text', '') for e in els if isinstance(e, dict) and e.get('category') != 'Picture' and e.get('text')), 'json'
    except Exception:  # noqa: BLE001 — truncated JSON: recover the text strings in order
        texts = []
        for m in re.finditer(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', s):
            try: texts.append(json.loads('"' + m.group(1) + '"'))
            except Exception: texts.append(m.group(1))  # noqa: BLE001
        return '\n'.join(texts), 'regex'


lock = threading.Lock(); q = list(rows); tl = open(os.path.join(root, 'timings.jsonl'), 'a')
def work():
    while True:
        with lock:
            if not q: return
            _, pn, src = q.pop(0)
        dst = os.path.join(out, f'{pn}.txt')
        if os.path.exists(dst): continue
        s = time.time()
        try:
            b64 = base64.b64encode(open(os.path.join(BENCH, src), 'rb').read()).decode()
            body = {'model': model, 'temperature': 0, 'max_tokens': max_tokens, 'messages': messages(b64)}
            req = urllib.request.Request(url + '/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=600))
            c = r['choices'][0]; raw = c['message']['content'] or ''
            t, parse = to_text(raw)
            open(os.path.join(out, f'{pn}.raw'), 'w').write(raw); open(dst, 'w').write(t)
            rec = {'pn': pn, 'secs': round(time.time() - s, 2), 'finish': c.get('finish_reason'), 'chars': len(t), 'out_tok': r.get('usage', {}).get('completion_tokens'), 'parse': parse}
        except Exception as e:  # noqa: BLE001
            open(os.path.join(out, f'{pn}.err'), 'w').write(str(e)[:300]); rec = {'pn': pn, 'error': str(e)[:200]}
        with lock: tl.write(json.dumps(rec) + '\n'); tl.flush()


t0 = time.time(); ths = [threading.Thread(target=work) for _ in range(CLIENTS)]
for t in ths: t.start()
for t in ths: t.join()
json.dump({'pages': len(rows), 'wall_secs': round(time.time() - t0, 1), 'clients': CLIENTS, 'mode': mode, 'max_tokens': max_tokens}, open(os.path.join(root, 'arm-run.json'), 'w'))
print(open(os.path.join(root, 'arm-run.json')).read())
