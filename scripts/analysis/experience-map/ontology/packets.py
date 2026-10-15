#!/usr/bin/env python3
"""
Cut judge packets for the aliveness ontology (#6720): K slices of nodes, each with the node's term candidates,
passage candidates, and the edges whose `from` end is in the slice. Read JUDGING.md for what the judges do.
PRIOR ART: none for this shape — .claude/docs/concept-aliases/ judged terms only, with packets cut by hand.
  python3 packets.py [OUT] [K]   → OUT/packets/slice-<k>.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'ontology')
K = int(sys.argv[2]) if len(sys.argv) > 2 else 8
jl = lambda p: [json.loads(l) for l in open(p) if l.strip()]
nodes = json.load(open(os.path.join(HERE, 'seed-nodes.json')))['nodes']
edges = json.load(open(os.path.join(HERE, 'seed-edges.json')))['edges']
terms = {r['node']: r for r in jl(os.path.join(OUT, 'term-candidates.jsonl'))}
pas = {r['node']: r for r in jl(os.path.join(OUT, 'cand-passages.jsonl'))}
eds = {r['key']: r for r in jl(os.path.join(OUT, 'cand-edges.jsonl'))}
pl = lambda q: q.replace('\u0001', '').replace('\u0002', '').replace('\u0003', '[').replace('\u0004', ']')
os.makedirs(os.path.join(OUT, 'packets'), exist_ok=True)
for k in range(K):
    sl = nodes[k::K]
    ids = {n['id'] for n in sl}
    pk = {'slice': k, 'nodes': []}
    for n in sl:
        t = terms.get(n['id'], {})
        p = pas.get(n['id'], {})
        pk['nodes'].append({
            'node': n['id'], 'label': n['label'], 'kind': n['kind'], 'tradition': n['tradition'], 'gloss': n['gloss'],
            'terms': {
                'seed_forms': [{'term_key': s['term_key'], 'surfaces': s['surfaces'][:3], 'tagged_pages': s['tagged_pages']} for s in t.get('seed_forms', [])],
                'seed_glosses': [g['gloss'] for g in t.get('seed_glosses', [])][:10],
                'candidates': [{'term_key': c['term_key'], 'term': c['term'], 'n': c['n'], 'via': c['via_glosses'][:3], 'renderings': c.get('renderings', [])[:3],
                                'evidence': [f"[{e['kind']}; gloss={e['gloss']}] …{e['context'][-130:]}" for e in c.get('evidence', [])[:2]]} for c in t.get('candidates', [])],
                'already_curated': t.get('curated'),
            },
            'passage_candidates': [{'idx': i, 'year': c['year'], 'basis': c['basis'], 'title': c['title'][:90], 'author': (c.get('author') or '')[:40],
                                    'quote': ('… ' if c['cut'][0] else '') + pl(c['quote']) + (' …' if c['cut'][1] else '')} for i, c in enumerate(p.get('candidates', []))],
        })
    pk['edges'] = []
    for e in edges:
        if e['from'] not in ids:
            continue
        key = f"{e['from']}|{e['type']}|{e['to']}"
        c = eds.get(key, {})
        pk['edges'].append({'key': key, 'type': e['type'], 'from_label': next(n['label'] for n in nodes if n['id'] == e['from']),
                            'to_label': next(n['label'] for n in nodes if n['id'] == e['to']), 'claim': e['claim'],
                            'candidates': [{'idx': i, 'title': x['title'][:90], 'year': x['year'], 'quote': ('… ' if x['cut'][0] else '') + pl(x['quote']) + (' …' if x['cut'][1] else '')}
                                           for i, x in enumerate(c.get('candidates', []))]})
    f = os.path.join(OUT, 'packets', f'slice-{k}.json')
    json.dump(pk, open(f, 'w'), ensure_ascii=False, indent=0)
    print(f, f'{os.path.getsize(f) // 1024}KB', len(sl), 'nodes', len(pk['edges']), 'edges')
