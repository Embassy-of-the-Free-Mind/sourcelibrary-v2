#!/usr/bin/env python3
"""e5-judge-packets.py — #7567 E5: the blind Opus judge's packets over the E5 judged sample (8 pages a book).

PRIOR ART: judge-packets.py (this directory, E2: the same packet shape for scripts/eval/ocr-per-call-7522/judge.mjs,
labels shuffled per packet, identical texts shown once, the arm key kept out of the packet). E5 pages are ours, so each
packet also carries the neighbouring leaves (prev.jpg / next.jpg) for the judge's bleed check, as #7522's own packets do.

One packet per page: L (the stored Flash-Lite draft = what readers get now), X (arm c's GPU draft), a (L→Flash),
a2 (the same again, on the pages it ran), c (X→Flash). An arm with no text (CONTAIN, no answer) is not shown and is
recorded as not delivered.
  [FINAL=1] e5-judge-packets.py <J>      (J = the job's e5 dir) writes <J>/judge-run/judge/packets/*.json and <J>/judge-key.json
"""
import hashlib, json, os, random, re, sys

J = sys.argv[1]
LANG = {'la': 'Latin', 'en': 'English', 'de': 'German', 'fr': 'French', 'it': 'Italian'}
ARMS = ['L', 'X', 'a', 'a2', 'c']
AGY = {'a', 'a2', 'c'}


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
    return {r['page_id']: r for r in (json.loads(l) for l in open(p) if l.strip())} if os.path.exists(p) else {}


pages = {p['slug']: p for p in json.load(open(os.path.join(J, 'panel.json')))['pages']}
sample = [s for s in open(os.path.join(J, 'judge-sample.txt')).read().split() if s]
A2_SAMPLE = set(open(os.path.join(J, 'a2-sample.txt')).read().split()) if os.path.exists(os.path.join(J, 'a2-sample.txt')) else set()
FINAL = os.environ.get('FINAL') == '1'   # the last pass: judge a page without a2 when a2 stopped short
src = {k: jsonl(os.path.join(J, 'drafts', f'{k}.jsonl')) for k in ['L', 'X']}
agy = {a: {f[:-5]: json.load(open(os.path.join(J, 'arms', a, f))) for f in os.listdir(os.path.join(J, 'arms', a))} if os.path.isdir(os.path.join(J, 'arms', a)) else {} for a in AGY}
out = os.path.join(J, 'judge-run', 'judge', 'packets'); os.makedirs(out, exist_ok=True)
kp = os.path.join(J, 'judge-key.json')
key = json.load(open(kp)) if os.path.exists(kp) else {}
made = 0
for s in sample:
    p = pages[s]
    if s in key: continue                                   # a packet once made is never rebuilt (its verdict stands)
    if not all(s in agy[a] for a in ('a', 'c')): continue   # judged only once both arms have answered
    if s in A2_SAMPLE and s not in agy['a2'] and not FINAL: continue   # and a2, on its pages (the judge's own repeat)
    texts, nd = {}, []
    for a in ARMS:
        if a in AGY:
            r = agy[a].get(s); t = (r or {}).get('final') or ''
        else:
            r = src[a].get(s); t = draft_text((r or {}).get('text') or '')
        if r is None: continue
        if len(re.sub(r'\W', '', t)) < 30: nd.append(a); continue
        texts.setdefault(t.strip(), []).append(a)
    if len(texts) < 2: continue
    rng = random.Random(int(hashlib.sha256(f'7567e5{s}'.encode()).hexdigest()[:8], 16))
    labels = list('ABCDEFGHJK')[:len(texts)]; rng.shuffle(labels)
    versions, kmap = [], {}
    for (t, who), lab in zip(texts.items(), labels):
        versions.append({'label': lab, 'text': t}); kmap[lab] = who
    versions.sort(key=lambda v: v['label'])
    nb = lambda side: (lambda f: f if os.path.exists(f) else None)(os.path.join(J, 'nb', f'{s}.{side}.jpg'))
    json.dump({'image': os.path.join(J, 'img', f'{s}.jpg'), 'prev_image': nb('prev'), 'next_image': nb('next'), 'versions': versions,
               'book_title': p.get('title') or 'unknown', 'published': p.get('year'), 'language': LANG[p['lang']], 'page_number': p.get('page_number') or 'unknown'},
              open(os.path.join(out, f'{s}.json'), 'w'), ensure_ascii=False)
    key[s] = {'slug': s, 'group': 'e5', 'labels': kmap, 'not_delivered': nd}; made += 1
json.dump(key, open(kp, 'w'), indent=1)
print(made, 'new packets;', len(key), 'in key')
