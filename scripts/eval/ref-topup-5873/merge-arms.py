#!/usr/bin/env python3
# PRIOR ART: scripts/eval/xlref-t5/merge-arms.py and xlref-t4/add-arms.mjs attach one arms directory to records; neither falls back to a retry directory for a refused request or records which requests were refused. This does (one resend of refused requests, same for every arm).
"""Attach the Batch arms to the #5873 top-up records.  python3 merge-arms.py <private dir> <results dir>"""
import json, os, sys
P, RES = sys.argv[1], sys.argv[2]
recs = [json.loads(l) for l in open(f'{P}/records-served.jsonl')]
refusals, cost = [], 0.0
for r in recs:
    pid = f"{r['book_id']}_{int(r['page_number']):05d}"
    r['candidates'] = [c for c in r['candidates'] if c['arm'] == 'served']
    for arm in ('lite', 'lite2', 'flash'):
        got = None
        for attempt, d in enumerate(('arms', 'arms-retry', 'arms-repl')):
            f = f'{P}/{d}/gemini/{arm}-batch/{pid}.json'
            if not os.path.exists(f): continue
            o = json.load(open(f)); cost += o.get('cost_usd') or 0
            if (o.get('text') or '').strip(): got = (o, d); break
            refusals.append({'id': pid, 'lang': r['lang'], 'arm': arm, 'request': d, 'finishReason': o.get('finishReason')})
        if not got: continue
        o, d = got
        r['candidates'].append({'arm': arm, 'text': o['text'], 'model': o['model'], 'finishReason': o.get('finishReason'), 'inputTokens': o.get('inputTokens'), 'outputTokens': o.get('outputTokens'),
                                'thinkingTokens': o.get('thinkingTokens'), 'cost_usd': o.get('cost_usd'), 'prompt_ref': o.get('prompt_ref'), 'job': o.get('job'), 'resent_after_refusal': d == 'arms-retry'})
with open(f'{P}/records-arms.jsonl', 'w') as f:
    for r in recs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
no_pair = [f"{r['book_id']}_{r['page_number']}" for r in recs if not {'lite', 'flash'} <= {c['arm'] for c in r['candidates']}]
json.dump({'refused_requests': refusals, 'pages_without_a_lite_flash_pair': no_pair, 'gemini_cost_usd_batch': round(cost, 4)}, open(f'{RES}/refusals.json', 'w'), indent=1)
print(len(recs), 'records; refused requests', len(refusals), '; no pair', no_pair, '; cost $', round(cost, 4))
