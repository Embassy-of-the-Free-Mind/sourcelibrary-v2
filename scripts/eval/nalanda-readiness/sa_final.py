# PRIOR ART: none — the roll-up for indic_align.py output (new instrument); looked in scripts/eval/lib and scripts/eval/*summary*.
# Final Sanskrit/Pali roll-up. DIFFERENT_WORK = full-coverage rows whose matched GRETIL file is a
# different (often related) work than the book — judged from book title vs file name by Claude, not by
# eye on the image. Those rows measure reference mismatch, not OCR, and are excluded from accuracy.
import json, statistics as st, collections
DIFFERENT_WORK = set('''6991d8a38c1030b12444c221_6 69906a47d69de0e69807024f_292 6991d8ac8c1030b12444c781_54
6a947ebb63f40afa090acf60_12 6a91e233bb7a47bd0f19eb84_13 69de98eb1b234a773e439877_44 69dfee8ace6bb8619e07fc64_129
6a91e1d6516e6f550430613f_13 69dea5a74d19ec2e9ba76d61_65 6a308944eb59f1191697d02c_14 69907df7b91bcb2db3f6d826_8
69dfee7ece6bb8619e07ecfa_564 6a91e15a051d1f3e8eaa40a0_18 6a308884eb59f1191697ba6d_9'''.split())
def q(v):
    v=sorted(v); n=len(v)
    return {'n': n, 'median': round(st.median(v),3), 'p25': round(v[n//4],3), 'p75': round(v[3*n//4],3),
            'ge_0.95': sum(x>=0.95 for x in v), 'ge_0.90': sum(x>=0.9 for x in v), 'lt_0.70': sum(x<0.7 for x in v)} if n else {'n': 0}
res = {}
for lang, fn, sf in (('Sanskrit','sa-scores.jsonl','sa-sample.jsonl'), ('Pali','pali-scores.jsonl','pali-sample.jsonl')):
    R=[json.loads(l) for l in open(fn)]
    M={json.loads(l)['id']:json.loads(l) for l in open(sf)}
    ctrl=[r for r in R if r['id'].startswith('control')]
    P=[r for r in R if not r['id'].startswith('control')]
    sc=[r for r in P if r['status']=='scored']
    thr=sorted(r['chance_acc'] for r in sc)[int(len(sc)*0.99)]
    d={'controls': {s: q([r['acc'] for r in ctrl if r['stratum']==s and 'acc' in r]) for s in sorted({r['stratum'] for r in ctrl})},
       'chance': q([r['chance_acc'] for r in sc]), 'chance_p99': thr, 'scripts': dict(collections.Counter(r['script'] for r in P))}
    for vis in ('visible','hidden'):
        V=[r for r in P if r['stratum'].startswith(vis)]
        s=[r for r in V if r['status']=='scored' and r['acc']>thr]
        full=[r for r in s if r['coverage']>=0.6 and r['id'] not in DIFFERENT_WORK]
        d[vis]={'books_sampled': len(V), 'status': dict(collections.Counter(r['status'] for r in V)),
                'above_chance': len(s), 'full_page_same_work': q([r['acc'] for r in full]),
                'full_page_different_work_excluded': sum(1 for r in s if r['id'] in DIFFERENT_WORK),
                'partial_coverage': q([r['acc'] for r in s if r['coverage']<0.6]),
                'by_engine': {a: q([r['acc'] for r in full if r['arm']==a]) for a in sorted({r['arm'] for r in full})},
                'precision_full': q([r['precision'] for r in full])}
    res[lang]=d
json.dump(res, open('indic-summary.json','w'), indent=1)
for lang, d in res.items():
    print(lang, 'controls', {k: v.get('median') for k, v in d['controls'].items()}, 'chance', d['chance']['median'], 'p99', d['chance_p99'])
    for vis in ('visible','hidden'):
        x=d[vis]; print(' ', vis, x['books_sampled'], x['status'], 'FULL-SAME', x['full_page_same_work'], 'excl', x['full_page_different_work_excluded'])
        for a,v in x['by_engine'].items(): print('     ', a, v)
