#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/fetch-served.mjs adds only the served arm; nothing joins raw arm
# outputs (raw/<arm>.jsonl) onto the records. This is that join for #5695 T3.
"""Join raw/<arm>.jsonl outputs onto the T3 records as candidates[] for build-packet.mjs."""
import json, sys
R, out, arms = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
iid = lambda r: f"{r['book_id']}_{int(r['page_number']):05d}"
recs = [json.loads(l) for l in open(R + '/records.jsonl')]
A = {a: {json.loads(l)['id']: json.loads(l) for l in open(f'{R}/raw/{a}.jsonl')} for a in arms}
only = set(sys.argv[4].split(',')) if len(sys.argv) > 4 else None
rows = []
for r in recs:
    if only and iid(r) not in only: continue
    c = [x for x in r['candidates'] if x['arm'] == 'served']
    for a in arms:
        x = A[a].get(iid(r))
        if x: c.append({'arm': a, 'text': x['text'], 'model': x.get('model')})
    r['candidates'] = c; rows.append(r)
open(out, 'w').write(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows))
print(len(rows), 'records')
