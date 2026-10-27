#!/usr/bin/env python3
"""judge-packets.py — #7567 E2: the blind Opus judge's packets, for scripts/eval/ocr-per-call-7522/judge.mjs unchanged.

PRIOR ART: scripts/eval/ocr-per-call-7522/prep.mjs builds that judge's packets for one-book page runs read by agy arms
(neighbour images, Mongo pages); these pages are partly not ours and have no neighbours on disk, so this writes the same
packet shape {image, versions:[{label,text}], book_title, published, language, page_number} from the E2 outputs.

Per page, up to two packets, each judged in its own call:
  lite : S (stored OCR, library pages), L (lite draft), a, a2, f (lite→Opus), e (fresh Flash read)
  gpu  : S, G (GLM draft), X (best other E1 draft), b, c, d, e
S and e sit in both, so a winner and "beats the stored OCR" are decided inside one call, and e anchors the two calls.
Identical texts (an UNCHANGED answer is its draft) are shown once and the label maps to every arm that gave it. An arm
with no text (CONTAIN, no answer, empty read) is not shown: it is recorded as not delivered. Labels are letters
shuffled per packet (seed 7567 + packet name); the arm key goes to <J>/judge-key.json, never into a packet.

  judge-packets.py <J>      writes <J>/judge-run/judge/packets/*.json and <J>/judge-key.json
"""
import hashlib, json, os, random, re, sys

J = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
LANG = {'la': 'Latin', 'en': 'English', 'de': 'German', 'fr': 'French', 'it': 'Italian'}
GROUPS = {'lite': ['S', 'L', 'a', 'a2', 'f', 'e'], 'gpu': ['S', 'G', 'X', 'b', 'c', 'd', 'e']}
AGY_ARMS = {'a', 'a2', 'b', 'c', 'd', 'e'}


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


pages = json.load(open(os.path.join(HERE, 'panel.json')))['pages']
src = {k: jsonl(os.path.join(J, 'drafts', f'{k}.jsonl')) for k in ['S', 'L', 'f', 'G', 'X']}
agy = {a: {f[:-5]: json.load(open(os.path.join(J, 'e2', a, f))) for f in os.listdir(os.path.join(J, 'e2', a))} if os.path.isdir(os.path.join(J, 'e2', a)) else {} for a in AGY_ARMS}

out = os.path.join(J, 'judge-run', 'judge', 'packets'); os.makedirs(out, exist_ok=True)
key = {}
for p in pages:
    s = p['slug']
    for g, arms in GROUPS.items():
        if g == 'lite' and not p['lite']: continue
        texts, nd = {}, []
        for a in arms:
            if a in AGY_ARMS:
                r = agy[a].get(s); t = (r or {}).get('final') or ''
            else:
                r = src[a].get(s); t = draft_text((r or {}).get('text') or '')
            if r is None: continue                      # arm not run on this page (e.g. S on an external page)
            if len(re.sub(r'\W', '', t)) < 30: nd.append(a); continue
            texts.setdefault(t.strip(), []).append(a)
        if len(texts) < 2: continue
        name = f'{s}__{g}'
        rng = random.Random(int(hashlib.sha256(f'7567{name}'.encode()).hexdigest()[:8], 16))
        labels = list('ABCDEFGHJK')[:len(texts)]; rng.shuffle(labels)
        versions, kmap = [], {}
        for (t, who), lab in zip(texts.items(), labels):
            versions.append({'label': lab, 'text': t}); kmap[lab] = who
        versions.sort(key=lambda v: v['label'])
        json.dump({'image': os.path.join(J, 'img', f'{s}.jpg'), 'versions': versions, 'book_title': p.get('title') or 'unknown',
                   'published': p.get('year'), 'language': LANG[p['lang']], 'page_number': p.get('page_number') or 'unknown'},
                  open(os.path.join(out, f'{name}.json'), 'w'), ensure_ascii=False)
        key[name] = {'slug': s, 'group': g, 'labels': kmap, 'not_delivered': nd}
json.dump(key, open(os.path.join(J, 'judge-key.json'), 'w'), indent=1)
print(len(key), 'packets;', sum(len(v['labels']) for v in key.values()), 'versions shown')
