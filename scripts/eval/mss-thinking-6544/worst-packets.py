#!/usr/bin/env python3
# PRIOR ART: none for packets: score.py ranks the worst pages; this writes them with image, reference and read for the by-eye read (#6544).
"""python3 worst-packets.py --set setA --arms lite,f38l,opus [--key reference]  ->  $JOB_SCRATCH/byeye/<set>-<arm>.json"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from score import reads, counts  # noqa: E402
from disagree import load  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--set', required=True); ap.add_argument('--arms', required=True); ap.add_argument('--key', default='reference')
ap.add_argument('--root', default=os.environ.get('JOB_SCRATCH')); a = ap.parse_args()
if a.set == 'setA':
    P = {json.loads(l)['uid']: json.loads(l) for l in open(os.path.join(a.root, 'setA', 'pages.jsonl'), encoding='utf-8')}
    ref = {u: r['gt'] for u, r in P.items()}; img = {u: r['image'] for u, r in P.items()}; meta = {u: f"{r['dataset']} ({r['language']}, {r['script']})" for u, r in P.items()}
else:
    picks = json.load(open(os.path.join(a.root, 'setB', 'draw.json')))['picks']
    ref = json.load(open(os.path.join(a.root, 'setB', 'keys', f'{a.key}.json'))); img = {p['uid']: p['image'] for p in picks}
    meta = {p['uid']: f"{p['stratum']}: {p.get('title', '')[:60]} ({p.get('language')})" for p in picks}
for arm in a.arms.split(','):
    rows = load(os.path.join(a.root, a.set, 'out', f'{arm}.jsonl'))
    T, _, _ = reads(arm, rows, list(ref))
    sc = sorted(((min(1, counts(t, ref[u])['cd'] / max(1, counts(t, ref[u])['cl'])), u) for u, t in T.items()), reverse=True)[:10]
    out = [{'uid': u, 'page': meta[u], 'image': img[u], 'cer_letters_folded': round(c, 3), 'reference': ref[u], 'read': T[u]} for c, u in sc]
    json.dump(out, open(os.path.join(a.root, 'byeye', f'{a.set}-{a.key}-{arm}.json'), 'w'), ensure_ascii=False, indent=1)
    print(arm, [x['cer_letters_folded'] for x in out])
