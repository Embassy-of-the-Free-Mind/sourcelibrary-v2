# insample.py — the guard on the 100 bake-off pages (design set, NOT evidence). python3 insample.py <ink-bakeoff.jsonl>, run from scripts/eval.
# PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/score.py (overrun count; reused functions).
import gzip, json, sys
sys.path.insert(0, 'zh-residue-bakeoff-6871'); sys.path.insert(0, 'zh-confirm-6871')
import score, guard
refs = [json.loads(l) for l in open('zh-residue-refs-6871/refs.jsonl')]
ink = {json.loads(l)['page_id']: json.loads(l) for l in open(sys.argv[1])}
P0 = {json.loads(l)['page_id']: json.loads(l)['text'] for l in gzip.open('zh-residue-bakeoff-6871/reads/P0.jsonl.gz','rt')}
for r in refs:
    g = guard.guard(P0.get(r['page_id'], ''), ink[r['page_id']])
    ref = len(score.ref_strings(r)[0]); box = (r['text'] or '').count('▣') + (r['text'] or '').count('□')
    hyp = len(score.hyp_string(P0.get(r['page_id'], ''), r.get('margin')))
    fail = ('collapse' if ref >= 20 and hyp < 0.5 * ref else 'loop' if hyp > 1.5 * (ref + box) + 20 else '')
    if g['flags'] or fail: print(r['cls'], r['title'][:16], 'ref', ref, 'hyp', hyp, g['route'], g['flags'], 'FAIL=' + fail, score.scored(r))
