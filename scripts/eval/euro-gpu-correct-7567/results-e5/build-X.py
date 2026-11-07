import json, sys, os
J = sys.argv[1]; PICK = {'la': 'PERO', 'en': 'LO', 'it': 'LO', 'de': 'CH8', 'fr': 'S'}
rows = []
for lang, eng in PICK.items():
    f = f'{J}/out/{eng}.jsonl'
    if not os.path.exists(f): continue
    for l in open(f):
        r = json.loads(l)
        if r['page_id'][:2] == lang and r.get('text') and 'error' not in r: rows.append({'page_id': r['page_id'], 'engine': eng, 'text': r['text'], 'finish': r.get('finish')})
with open(f'{J}/e5/drafts/X.jsonl', 'w') as o:
    for r in rows: o.write(json.dumps(r, ensure_ascii=False) + '\n')
from collections import Counter; print(Counter(r['page_id'][:2] for r in rows))
