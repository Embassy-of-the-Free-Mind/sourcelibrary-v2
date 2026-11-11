#!/usr/bin/env python3
"""build-panel.py — #6871 1800+ European print: the TYPED-reference panel (one page per book, year >= 1800).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/build-panel.py (E0: the same three sources, filtered there to 1470-1800,
and its panel/refs format, which score.py reads unchanged). This keeps the >= 1800 pages E0 left out:
  en  benchmark/english-ia-5124.json (#5216/#5182 English IA pages, Wikisource/Gutenberg references; the 8 rows marked
      reference_error by eye on 2026-09-28 dropped) — lite = the stored #5216 realtime read (refusals kept as refusals)
  de, la  scripts/eval/ground-truth-ws (Wikisource proofread pages, the 5660/6740 ref-ws bench), year >= 1800 —
      lite = E2's L.jsonl bench read, else the 6740 bench read
Images: the leaf the reference was checked against, long side capped at 2,400 px (E0's cap).
  build-panel.py <out dir>     → panel.json, refs.jsonl.gz, img/<slug>.jpg, L.jsonl (the lite arm)
"""
import glob, gzip, io, json, os, sys, urllib.request
from PIL import Image

EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = sys.argv[1]; os.makedirs(f'{OUT}/img', exist_ok=True)
MAIN_TEXTS = '/root/sourcelibrary/scripts/eval/results/en-ocr-ref-5124/texts'   # untracked lite texts (#5124 run)
PARETO = '/root/jobs/pareto-chains-6740/bench/ref-ws'
E2 = '/root/jobs/euro-gpu-correct-7567'


def save(slug, buf):
    im = Image.open(io.BytesIO(buf)).convert('RGB'); s = 2400 / max(im.size)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    im.save(f'{OUT}/img/{slug}.jpg', quality=90)


pages, refs, lite = [], [], []
# en
reg = json.load(open(f'{EV}/benchmark/english-ia-5124.json'))['rows']
store = {}
for l in open(f'{EV}/store/outputs/gemini-3.1-flash-lite/2026-09.jsonl'):
    r = json.loads(l)
    if r.get('run_id') == 'en-ocr-ref-5124-2026-09' and (r['slug'] not in store or r['attempt'] >= store[r['slug']]['attempt']): store[r['slug']] = r
for x in reg:
    s = x['slug']; jf = f'{EV}/benchmark/refs/{s}.json'
    if x.get('excluded') or not os.path.exists(jf) or x['catalogue']['published'] < 1800: continue
    if json.load(open(jf)).get('reference_error'): continue
    st = store.get(s)
    if not st: continue
    txt = open(f'{MAIN_TEXTS}/{s}.lite.txt').read() if st['outcome'] == 'text' else ''
    if not os.path.exists(f'{OUT}/img/{s}.jpg'):
        req = urllib.request.Request(''.join(x['image_url'].split()), headers={'User-Agent': 'sourcelibrary-eval-6871'})
        save(s, urllib.request.urlopen(req, timeout=60).read())
    y = x['catalogue']['published']
    pages.append({'slug': s, 'lang': 'en', 'set': 'english-ia-5124', 'century': y // 100 + 1, 'year': y, 'book_id': x['book_id'],
                  'page_number': x['page_number'], 'title': x['catalogue']['title']})
    refs.append({'slug': s, 'ref_text': open(f'{EV}/benchmark/refs/{s}.txt').read()})
    lite.append({'page_id': s, 'text': txt, 'finish': st.get('finish_reason'), 'outcome': st['outcome']})
# de + la: Wikisource proofread pages (scripts/eval/ground-truth-ws, the 5660/6740 ref-ws bench), lite bench reads
L2 = {json.loads(l)['page_id']: json.loads(l)['text'] for l in open(f'{E2}/drafts/L.jsonl')}
for jf in sorted(glob.glob(f'{EV}/ground-truth-ws/ws-*.json')):
    s = os.path.basename(jf)[:-5]; g = json.load(open(jf))
    lang = {'German': 'de', 'Latin': 'la'}.get(g.get('language'))
    try: y = int(str(g.get('year'))[:4])
    except ValueError: continue
    if not lang or y < 1800: continue
    img = f'{PARETO}/{s}.jpg' if os.path.exists(f'{PARETO}/{s}.jpg') else f'{E2}/img/{s}.jpg'
    lt = L2.get(s)
    if lt is None and os.path.exists(f'{PARETO}/out/gemini-3.1-flash-lite/{s}.txt'): lt = open(f'{PARETO}/out/gemini-3.1-flash-lite/{s}.txt').read()
    if not os.path.exists(img) or lt is None or not g.get('ocr_ground_truth'): print('skip', s); continue
    if not os.path.exists(f'{OUT}/img/{s}.jpg'): save(s, open(img, 'rb').read())
    pages.append({'slug': s, 'lang': lang, 'set': 'ref-ws', 'century': y // 100 + 1, 'year': y, 'book_id': None, 'work': g.get('work')})
    refs.append({'slug': s, 'ref_text': g['ocr_ground_truth']})
    lite.append({'page_id': s, 'text': lt, 'finish': None, 'outcome': 'text' if lt.strip() else 'empty'})
json.dump({'issue': 6871, 'rule': 'typed references, year >= 1800, one page per book (en) / per work (ws)', 'pages': pages}, open(f'{OUT}/panel.json', 'w'), indent=1)
with gzip.open(f'{OUT}/refs.jsonl.gz', 'wt') as f:
    for r in refs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
with open(f'{OUT}/L.jsonl', 'w') as f:
    for r in lite: f.write(json.dumps(r, ensure_ascii=False) + '\n')
from collections import Counter
print(Counter(p['lang'] for p in pages), 'lite refusals/empty', Counter(r['outcome'] for r in lite))
