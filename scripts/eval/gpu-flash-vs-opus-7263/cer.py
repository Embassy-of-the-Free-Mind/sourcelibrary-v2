#!/usr/bin/env python3
"""cer.py — #7263 folded CER of each arm against the panel's typed references, per language, on a slug set.

PRIOR ART: scripts/eval/euro-gpu-correct-7567/score.py (the scorer, run unchanged as a subprocess) and its e2-table.py
(paired bootstrap δ vs a reference arm). This only lays each arm's per-page JSON out as the jsonl score.py reads, runs it
with --shared, and reports δ = mean folded CER(arm − O) with a 95% paired bootstrap CI per language.

  cer.py <J> <slug file> <out.json> ARM=SOURCE ...     (SOURCE as packets.py: e2/<dir>, O, draft:<k>)
"""
import gzip, json, os, random, subprocess, sys

J, SLUGS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ARMS = [a.split('=', 1) for a in sys.argv[4:]]
HERE = os.path.dirname(os.path.abspath(__file__)); E = os.path.join(HERE, '..', 'euro-gpu-correct-7567')
slugs = set(l.strip() for l in open(SLUGS) if l.strip())
tmp = os.path.join(J, 'cer-tmp'); os.makedirs(tmp, exist_ok=True)
args = []
for a, spec in ARMS:
    p = os.path.join(tmp, f'{a}.jsonl')
    with open(p, 'w') as f:
        if spec.startswith('draft:'):
            for l in open(os.path.join(J, 'drafts', spec[6:] + '.jsonl')):
                r = json.loads(l)
                if r['page_id'] in slugs: f.write(json.dumps({'page_id': r['page_id'], 'text': r.get('text') or ''}, ensure_ascii=False) + '\n')
        else:
            for s in slugs:
                q = os.path.join(J, spec, s + '.json')
                if os.path.exists(q): f.write(json.dumps({'page_id': s, 'text': json.load(open(q)).get('final') or ''}, ensure_ascii=False) + '\n')
    args.append(f'{a}={p}')
excl = os.path.join(tmp, 'not-in-set.txt')
open(excl, 'w').write('\n'.join(p['slug'] for p in json.load(open(os.path.join(E, 'panel.json')))['pages'] if p['slug'] not in slugs))
raw = os.path.join(tmp, 'score.json')
subprocess.run([sys.executable, os.path.join(E, 'score.py'), os.path.join(E, 'panel.json'), os.path.join(E, 'refs.jsonl.gz'), raw, *args, '--shared', f'--exclude={excl}'], check=True, stdout=subprocess.DEVNULL)
sc = json.load(open(raw))
panel_excl = {e['slug'] for e in json.load(open(os.path.join(E, 'panel.json'))).get('excluded_from_scoring', [])}
names = [a for a, _ in ARMS]; REF = 'O' if 'O' in names else names[0]
res = {'summary': sc['summary'], 'delta_vs_ref': {}, 'ref': REF}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    sl = [s for s, v in sc['pages'].items() if s in slugs and s not in panel_excl and lang in ('all', v['lang'])
          and all(not v['arms'][a].get('missing') for a in names)]
    if not sl: continue
    for a in names:
        if a == REF: continue
        d = [sc['pages'][s]['arms'][a]['folded'] - sc['pages'][s]['arms'][REF]['folded'] for s in sl]
        rng = random.Random(7263); n = len(d)
        bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(4000))
        res['delta_vs_ref'].setdefault(lang, {})[a] = {'n': n, 'delta_pt': round(100 * sum(d) / n, 2), 'ci_pt': [round(100 * bs[100], 2), round(100 * bs[3899], 2)]}
json.dump(res, open(OUT, 'w'), indent=1)
for lang, d in sc['summary'].items():
    print(f'== {lang}: ' + '  '.join(f"{a} med {v['median_folded']*100:.2f} mean {v['mean_folded']*100:.2f}" for a, v in d.items()))
    for a, x in res['delta_vs_ref'].get(lang, {}).items(): print(f"     δ {a}−{REF} {x['delta_pt']:+.2f} pt [{x['ci_pt'][0]:+.2f}, {x['ci_pt'][1]:+.2f}] n {x['n']}")
