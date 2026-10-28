#!/usr/bin/env python3
"""split.py — #7263 dev / test split of the #7567 E0 panel (326 pages, one per book, typed references).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/judge-packets.py (its seeded per-language draw of 12 no-image pages,
random.Random(7567) over sorted slugs) — the same draw shape, seed 7263, 10 pages per language for DEV. Every other
page is TEST. Prompt rounds for arm D/D2 see DEV only; the verdict is computed on TEST only.

  split.py  -> split.json {dev:[slug], test:[slug], seed, by_lang}
"""
import json, os, random
HERE = os.path.dirname(os.path.abspath(__file__))
pages = json.load(open(os.path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json')))['pages']
r = random.Random(7263); dev = []
for lang in ['la', 'en', 'de', 'fr', 'it']:
    dev += r.sample(sorted(p['slug'] for p in pages if p['lang'] == lang), 10)
dev = sorted(dev); test = sorted(p['slug'] for p in pages if p['slug'] not in set(dev))
by = {l: {'dev': sum(1 for p in pages if p['lang'] == l and p['slug'] in dev), 'test': sum(1 for p in pages if p['lang'] == l and p['slug'] in test)} for l in ['la', 'en', 'de', 'fr', 'it']}
json.dump({'seed': 7263, 'dev': dev, 'test': test, 'by_lang': by}, open(os.path.join(HERE, 'split.json'), 'w'), indent=1)
print(by, len(dev), len(test))
