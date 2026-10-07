#!/usr/bin/env python3
# PRIOR ART: scripts/eval/xlref-t4/report.py and xlref-t5/assemble.py write each track's pages.jsonl / references.jsonl from their own private work dirs and field names; this writes the same two files for the #5873 top-up from the shared harness's results.json, withholding in-copyright reference texts (#5488).
"""python3 export.py <private dir> <results dir>  →  pages.jsonl (page × arm, our texts and scores) and references.jsonl (reference text only where open)."""
import json, sys
P, RES = sys.argv[1], sys.argv[2]
recs = {f"{r['book_id']}_{int(r['page_number']):05d}": r for r in map(json.loads, open(f'{P}/records-arms.jsonl'))}
res = json.load(open(f'{RES}/results.json'))
OUR = 'CC BY-SA 4.0'
with open(f'{RES}/pages.jsonl', 'w') as fp, open(f'{RES}/references.jsonl', 'w') as fr:
    for p in res['per_page']:
        r = recs[p['id']]; m = r['reference_meta']
        for c in r['candidates']:
            a = p['arms'].get(c['arm'], {})
            fp.write(json.dumps({'track': r['track'], 'run_id': 'ref-topup-5873-2026-10', 'id': p['id'], 'book_id': r['book_id'], 'page_number': r['page_number'], 'url': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}",
                'lang': r['lang'], 'draw': r['draw'], 'draw_order': r['draw_order'], 'hidden_book': r['hidden_book'], 'arm': c['arm'], 'fidelity': a.get('fidelity'),
                'fidelity_by_judge': {j: v.get('fidelity') for j, v in (a.get('by_judge') or {}).items()}, 'reference_fit': p.get('reference_fit'), 'control_page': p.get('control'),
                'model': c.get('model'), 'prompt_version': c.get('prompt_version') or (c.get('prompt_ref') or {}).get('version'), 'input_tokens': c.get('inputTokens'), 'output_tokens': c.get('outputTokens'),
                'cost_usd_batch': c.get('cost_usd'), 'resent_after_refusal': c.get('resent_after_refusal'), 'text': c['text'],
                'licences': {'our_text': OUR, 'reference': m['licence'], 'reference_publishable': not m['private']}}, ensure_ascii=False) + '\n')
        fr.write(json.dumps({'id': p['id'], 'book_id': r['book_id'], 'page_number': r['page_number'], 'lang': r['lang'], 'book_title': r['book_title'], 'period': r.get('period'), 'genre': r.get('genre'),
            'page_content': r.get('page_content'), 'reference_meta': m, 'align': r.get('align'), 'source_text': r['source_text'], 'source_licence': OUR,
            'reference_text': None if m['private'] else r['reference_text'], 'reference_withheld': bool(m['private'])}, ensure_ascii=False) + '\n')
print('ok')
