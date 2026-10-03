# PRIOR ART: translation-vs-reference/from-ab-sample.mjs reads #5606 batch-arm outputs into candidates; this adds the
# xlref-t5 run-arms.mjs outputs (same file shape) to the same records, replacing an arm of the same name.
"""merge-arms.py <records.jsonl> <arms dir> <out.jsonl> arm1,arm2,..."""
import json, os, sys
inp, armdir, out, arms = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(',')
rows = [json.loads(l) for l in open(inp)]
n = 0
for r in rows:
    id_ = f"{r['book_id']}_{r['page_number']:05d}"
    for a in arms:
        f = os.path.join(armdir, a, id_ + '.json')
        if not os.path.exists(f): continue
        d = json.load(open(f))
        r['candidates'] = [c for c in r['candidates'] if c['arm'] != a] + [{'arm': a, 'text': d['text'], 'model': d['model'], 'finishReason': d.get('finishReason'),
            'generation_config': d.get('generation_config'), 'thinkingTokens': d.get('thinkingTokens'), 'issues': d.get('issues'), 'origin': 'xlref-t5 run-arms'}]
        n += 1
with open(out, 'w') as fo:
    for r in rows: fo.write(json.dumps(r, ensure_ascii=False) + '\n')
from collections import Counter
print(n, 'arm outputs merged;', Counter(c['arm'] for r in rows for c in r['candidates']))
