#!/usr/bin/env python3
"""judge-packets.py — #6871 1800+ print: blind Opus packets for the judged panels (scripts/eval/ocr-per-call-7522/judge.mjs).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/e5-judge-packets.py (copied: labels shuffled per page with a seeded rng,
identical texts shown once, the arm key kept out of the packet, neighbour leaves attached; draft_text for CHURRO XML).
  judge-packets.py <panel dir> <candidate jsonl> <candidate guard jsonl> <ARMNAME>
    set a: two versions, L (the stored lite draft) and the candidate's guarded read.
    set b: one version, the candidate's guarded read (lite has none).
  A version with < 30 word characters (no read, or a guard refusal) is not shown; it is recorded in the key as
  not_delivered and scored as misleading. Writes <dir>/judge-run/judge/packets/*.json (judge.mjs --scratch=<dir>/judge-run) and <dir>/judge-key.json.
"""
import hashlib, json, os, random, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'euro-gpu-correct-7567'))

D, CAND, GUARD, NAME = sys.argv[1:5]
LANG = {'la': 'Latin', 'en': 'English', 'de': 'German', 'fr': 'French', 'it': 'Italian'}


def draft_text(t):
    t = re.sub(r'^---\n(?:[A-Za-z_]+:.*\n)+---\n', '', t or '')        # olmOCR front matter (LightOnOCR opens with a bare ---)
    t = re.sub(r'^\s*```[a-zA-Z]*\s*$', '', t, flags=re.M)
    if '<HistoricalDocument' in t or '<Metadata>' in t:
        t = re.sub(r'<Metadata>.*?</Metadata>', '', t, flags=re.S)
        t = re.sub(r'</(Line|Paragraph|Heading|PageNumber|Header|Footer)>', '\n', t)
        t = re.sub(r'<[^>\n]+>', '', t).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        t = '\n'.join(l.strip() for l in t.split('\n'))
        t = re.sub(r'\n\s*\n\s*\n+', '\n\n', t)
    return t.strip()


P = json.load(open(f'{D}/panel.json')); SET = P['set']
L = {json.loads(l)['page_id']: json.loads(l)['text'] for l in open(f'{D}/L.jsonl') if l.strip()}
C = {json.loads(l)['page_id']: json.loads(l) for l in open(CAND) if l.strip()}
GD = {json.loads(l)['page_id']: json.loads(l) for l in open(GUARD) if l.strip()}
out = f'{D}/judge-run/judge/packets'; os.makedirs(out, exist_ok=True)
key = {}
for p in P['pages']:
    s = p['slug']; texts, nd = {}, []
    cands = [('L', L.get(s) or '')] if SET == 'a' else []
    c = '' if GD.get(s, {}).get('refuse') else draft_text((C.get(s) or {}).get('text') or '')
    cands.append((NAME, c))
    for a, t in cands:
        if len(re.sub(r'\W', '', t)) < 30: nd.append(a); continue
        texts.setdefault(t.strip(), []).append(a)
    if not texts: key[s] = {'slug': s, 'lang': p['lang'], 'labels': {}, 'not_delivered': nd, 'guard': GD.get(s, {}).get('reason')}; continue
    rng = random.Random(int(hashlib.sha256(f'6871p1800{s}'.encode()).hexdigest()[:8], 16))
    labels = list('ABCD')[:len(texts)]; rng.shuffle(labels)
    versions, kmap = [], {}
    for (t, who), lab in zip(texts.items(), labels):
        versions.append({'label': lab, 'text': t}); kmap[lab] = who
    versions.sort(key=lambda v: v['label'])
    nb = lambda side: (lambda f: f if os.path.exists(f) else None)(f'{D}/nb/{s}.{side}.jpg')
    json.dump({'image': f'{D}/img/{s}.jpg', 'prev_image': nb('prev'), 'next_image': nb('next'), 'versions': versions,
               'book_title': p.get('title') or 'unknown', 'published': p.get('year'), 'language': LANG[p['lang']],
               'page_number': p.get('page_number') or 'unknown'}, open(f'{out}/{s}.json', 'w'), ensure_ascii=False)
    key[s] = {'slug': s, 'lang': p['lang'], 'labels': kmap, 'not_delivered': nd, 'guard': GD.get(s, {}).get('reason')}
json.dump(key, open(f'{D}/judge-key.json', 'w'), indent=1)
print(sum(1 for k in key.values() if k['labels']), 'packets;', len(key), 'pages')
