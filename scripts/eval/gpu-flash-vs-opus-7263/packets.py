#!/usr/bin/env python3
"""packets.py — #7263 blind-judge packets for scripts/eval/ocr-per-call-7522/judge.mjs (unchanged).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/judge-packets.py — the same packet shape and rules, copied: identical
texts shown once (the label maps to every arm that gave it), an arm with no text (< 30 letters) not shown and recorded
as not delivered, letters shuffled per packet from a seeded hash, the arm key written beside the packets, never in them.
What differs: the arm set is given on the command line (dev rounds and the test set judge different arms), and the
arms are this job's (O, C, C2, D-r<n>, D2-r<n>) plus the draft X and, on our pages, the stored OCR S.

  packets.py <J> <set name> <slug file> ARM=SOURCE [ARM=SOURCE ...]
    SOURCE: e2/<dir> (agy arm, `final`), O (Opus read), draft:<X|S|Y> (drafts/<k>.jsonl)
  writes <J>/judge-<set>/judge/packets/<slug>.json and <J>/judge-<set>/key.json
"""
import hashlib, json, os, random, re, sys

J, SET, SLUGS = sys.argv[1], sys.argv[2], sys.argv[3]
ARMS = [a.split('=', 1) for a in sys.argv[4:]]
HERE = os.path.dirname(os.path.abspath(__file__))
LANG = {'la': 'Latin', 'en': 'English', 'de': 'German', 'fr': 'French', 'it': 'Italian'}


def draft_text(t):
    t = re.sub(r'^\s*```[a-zA-Z]*\s*$', '', t or '', flags=re.M)
    if '<HistoricalDocument' in t or '<Metadata>' in t:
        t = re.sub(r'<Metadata>.*?</Metadata>', '', t, flags=re.S)
        t = re.sub(r'</(Line|Paragraph|Heading|PageNumber|Header|Footer)>', '\n', t)
        t = re.sub(r'<[^>\n]+>', '', t).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        t = '\n'.join(l.strip() for l in t.split('\n'))
        t = re.sub(r'\n\s*\n\s*\n+', '\n\n', t)
    return t.strip()


def jsonl(p):
    return {(r.get('page_id') or r.get('slug')): r for r in (json.loads(l) for l in open(p) if l.strip())} if os.path.exists(p) else {}


def source(spec):
    """slug -> text, or None when the arm did not run on that page."""
    if spec.startswith('draft:'):
        d = jsonl(os.path.join(J, 'drafts', spec[6:] + '.jsonl'))
        return lambda s: draft_text(d[s].get('text') or '') if s in d else None
    d = os.path.join(J, spec)
    def get(s):
        f = os.path.join(d, s + '.json')
        if not os.path.exists(f): return None
        return json.load(open(f)).get('final') or ''
    return get


pages = {p['slug']: p for p in json.load(open(os.path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json')))['pages']}
slugs = [l.strip() for l in open(SLUGS) if l.strip()]
src = {a: source(s) for a, s in ARMS}
base = os.path.join(J, f'judge-{SET}'); out = os.path.join(base, 'judge', 'packets'); os.makedirs(out, exist_ok=True)
key = {}
for s in slugs:
    p = pages[s]; texts, nd, missing = {}, [], []
    for a, _ in ARMS:
        t = src[a](s)
        if t is None: missing.append(a); continue
        if len(re.sub(r'\W', '', t)) < 30: nd.append(a); continue
        texts.setdefault(t.strip(), []).append(a)
    if len(texts) < 2: key[s] = {'slug': s, 'labels': {}, 'not_delivered': nd, 'missing': missing, 'skipped': 'fewer than 2 texts'}; continue
    rng = random.Random(int(hashlib.sha256(f'7263{SET}{s}'.encode()).hexdigest()[:8], 16))
    labels = list('ABCDEFGHJK')[:len(texts)]; rng.shuffle(labels)
    versions, kmap = [], {}
    for (t, who), lab in zip(texts.items(), labels):
        versions.append({'label': lab, 'text': t}); kmap[lab] = who
    versions.sort(key=lambda v: v['label'])
    json.dump({'image': os.path.join(J, 'img', f'{s}.jpg'), 'versions': versions, 'book_title': p.get('title') or 'unknown',
               'published': p.get('year'), 'language': LANG[p['lang']], 'page_number': p.get('page_number') or 'unknown'},
              open(os.path.join(out, f'{s}.json'), 'w'), ensure_ascii=False)
    key[s] = {'slug': s, 'lang': p['lang'], 'labels': kmap, 'not_delivered': nd, 'missing': missing}
json.dump({'arms': dict(ARMS), 'pages': key}, open(os.path.join(base, 'key.json'), 'w'), indent=1)
print(SET, len([k for k in key.values() if k['labels']]), 'packets;', sum(len(v['labels']) for v in key.values()), 'versions shown')
