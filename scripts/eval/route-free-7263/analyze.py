#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs — scores one test dir's arms (k/n, McNemar), not the link
# between routes across every test on file; scripts/eval/estimator/router-table/v3_sim.py — independent draws only.
"""Route-free analyses for #7263 (job route-free-analyses-7263): no model calls, no DB writes.

  python3 scripts/eval/route-free-7263/analyze.py --out $JOB_SCRATCH/route-free.json

Reads every per-page verdict file the loaders in perpage.py know, and reports
  pairs   for every two routes judged on the same page: the 2x2 table, discordant pairs, phi, and the ratio of pages a
          same-page test needs to the pages per arm a different-pages test needs for the same precision on the gap;
  repeats the same route read twice, or the same text judged twice: per-page agreement and kappa;
  split   split-half by book: does the winner on a random half of books also win on the other half?
"""
import json, math, random, re, sys, os, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perpage as P

# Each source: loader, arm -> route name (a '>' means "the text before it, then corrected by"), task, judge scale, draw.
# judge: route = route-judge prompt (accept + severity); stepT = Step T reader (sound/flawed/misleading, accept = not
# misleading); usable = per-call judge (usable bool); arabic = USABLE/NOTICEABLE/MISLEADING; mqm = material-span counts.
ZH = dict(served='gemini', P='paddle', O='gemini>opus', Pu='paddle-noguard', PFL='paddle>agy-flash-low',
          PFM='paddle>agy-flash-medium', SFL='gemini>agy-flash-low', PSN='paddle>sonnet', SSN='gemini>sonnet')
PILOT = {'P0 stored Paddle': 'paddle', 'Opus correct': 'paddle>opus', 'Sonnet correct': 'paddle>sonnet',
         'Flash-low correct': 'paddle>agy-flash-low', 'Opus fresh read': 'opus-read'}
FRAK = {'t1': dict(a='agy@4', b='agy@4>agy@4', c='agy@4>agy@1'),
        't2': dict(a='lite', b='lite>agy@1', c='agy@4-reread'),
        't3': dict(lite='lite', a='agy@4', b='agy@4>agy@4', c='pero>agy')}
CP = {'P:draft': ['lite'], 'P:served': ['lite>agy@1'], 'P:same': ['lite', 'lite>agy@1'],
      'W:draft': ['lite'], 'W:served': ['lite>agy@1'], 'W:same': ['lite', 'lite>agy@1'],
      'WG:gpu': ['gpu'], 'WG:gpuserved': ['gpu>agy@1']}


def rj_dir(d, task='ocr', draw='random'):
    return dict(name=d, load=lambda: P.rows(d), task=task, judge='route', draw=draw, cell=lambda r: r['cell'])


SOURCES = [
    rj_dir('pilot-2026-10-26', draw='hand'), rj_dir('router-tests-2026-10-26'), rj_dir('router-tests-2026-10-28'),
    rj_dir('router-next-2026-10-28'), rj_dir('fresh-7517-2026-10-27'), rj_dir('tibetan-30-2026-10-27'),
    rj_dir('agy-opus-7545-2026-10-28'), rj_dir('first-read-7701-2026-10-29'), rj_dir('cheap-routes-7701-2026-10-29'),
    rj_dir('german-cheaper-7701-2026-10-30'), rj_dir('en-pre1800-gpu-6871-2026-10-30'),
    dict(name='read-surface-6740-confirm', load=lambda: P.read_surface('confirm') + P.read_surface('confirm-de') + P.read_surface('confirm-de2'), task='ocr', judge='route', draw='random', cell=lambda r: r['cell']),
    dict(name='correct-vs-reread-7568', load=lambda: [r for l in ('zh', 'de', 'el', 'sa', 'ar') for r in P.step_t(l)], task='ocr', judge='stepT', draw='hand', cell=lambda r: r['lang'], cluster=True),
    dict(name='latin-250-5924', load=P.latin_250, task='ocr', judge='stepT', draw='hand', cell=lambda r: 'la', cluster=True),
    dict(name='cells-6553', load=P.cells_6553, task='ocr', judge='other (cells-6553 status/serious)', draw='random', cell=lambda r: r['cell']),
    dict(name='arabic-mss-7341', load=lambda: [r for r in P.arabic('mss') if r['judge'] == 'claude'], task='ocr', judge='arabic usability (Opus)', draw='hand', cell=lambda r: 'ar-mss'),
    dict(name='arabic-kraus-7341', load=lambda: [r for r in P.arabic('kraus') if r['judge'] == 'claude'], task='ocr', judge='arabic usability (Opus)', draw='hand', cell=lambda r: 'ar-kraus', cluster=True),
    dict(name='korean-cell-7982', load=P.korean, task='ocr', judge='route', draw='random', cell=lambda r: 'ko'),
    dict(name='zh-reocr-cheap-arms-7263', load=P.zh_arms, task='ocr', judge='route', draw='random', cell=lambda r: r['stratum'], arms=ZH),
    dict(name='zh-ditto-5274', load=P.zh_ditto_restore, task='ocr', judge='stepT', draw='random', cell=lambda r: 'zh-ditto-' + r['set'],
         arms=dict(P0='paddle', **{'P2-ia': 'paddle>P2-ia', 'P3-ia': 'paddle>P3-ia', 'P2-r2': 'paddle>P2-r2'})),
    dict(name='zh-ditto-5274-pilot', load=P.ditto_pilot_md, task='ocr', judge='stepT', draw='random', cell=lambda r: 'zh-ditto@' + r['per_call'], arms=PILOT),
    dict(name='router-v4-latin-lite-7263', load=lambda: P.router_confirm('results/router-v4-latin-lite/latin-lite-print-2026-11-03.json'), task='ocr', judge='route', draw='random', cell=lambda r: 'latin-lite-v4',
         arms=dict(served='lite', B='lite>agy-flash-low', C='agy-flash-low@4')),
    dict(name='correction-pass-7818', load=lambda: [dict(r, book=r['page']) for r in P.correction_release() if r['set'] == 'abs' and r.get('rep') == 1 and r['accept'] is not None],
         task='ocr', judge='route', draw='random', cell=lambda r: r['route'].split(':')[0] + '-' + r['lang'], multi=CP),
    dict(name='fraktur-paired-7835', load=P.fraktur, task='ocr', judge='route', draw='random', cell=lambda r: r['test'] + '-' + (r['face'] or ''), arms_by=lambda r: FRAK[r['test']]),
    dict(name='agy-ocr-per-call-6740', load=lambda: [r for r in P.agy_ppc_6740() if r['judged']], task='ocr', judge='route', draw='random', cell=lambda r: r['route'].split(':')[0],
         arms={'T1:A1': 'agy@1', 'T1:A1b': 'agy@1#2', 'T1:B2': 'agy@2', 'T2:A1': 'lite>agy@1', 'T2:A1b': 'lite>agy@1#2', 'T2:B2': 'lite>agy@2'}),
    dict(name='ocr-per-call-7522', load=P.ppc_7522, task='ocr', judge='usable', draw='random', cell=lambda r: 'de+la',
         arms=dict(A1='agy@1', A1b='agy@1#2', B2='agy@2', C4='agy@4')),
    dict(name='agy-per-call-7503', load=P.ppc_7503, task='translation', judge='usable', draw='random', cell=lambda r: 'zh-siku-tr',
         arms=dict(A1='agy@1', A1b='agy@1#2', B2='agy@2', C4='agy@4')),
    dict(name='eu-agy-translate-7263', load=P.eu_agy, task='translation', judge='route', draw='random', cell=lambda r: r['lang']),
    dict(name='siku-tr-6567', load=P.siku_tr, task='translation', judge='mqm', draw='random', cell=lambda r: 'zh-siku-tr'),
    dict(name='tengyur-6361', load=P.tengyur, task='translation', judge='mqm', draw='hand', cell=lambda r: 'bo-tengyur', cluster=True),
]


def table(src):
    """(cell, book, page) -> {route: (accept, wrong_text)}; first verdict wins, later ones go to dup for the noise floor."""
    T, dup = collections.defaultdict(dict), []
    for r in src['load']():
        if r['accept'] is None: continue
        if 'multi' in src: routes = src['multi'][r['route']]
        elif 'arms_by' in src: routes = [src['arms_by'](r)[r['route']]]
        else: routes = [src.get('arms', {}).get(r['route'], r['route'])]
        k = (src['cell'](r), str(r['book']), str(r['page']))
        for rt in routes:
            if rt in T[k]: dup.append((k, rt, T[k][rt][0], bool(r['accept'])))
            else: T[k][rt] = (bool(r['accept']), r.get('wrong_text'))
    return T, dup


def kind(a, b):
    if a.split('#')[0] == b.split('#')[0]: return 'repeat'
    for x, y in ((a, b), (b, a)):
        if '>' in y and y.rsplit('>', 1)[0] == x: return 'correction vs its own draft'
    ca, cb = '>' in a, '>' in b
    eng = lambda r: re.sub(r'(@\d+|-read|-reread|-1600px|#2)', '', r)
    if not ca and not cb: return 'read vs read, same engine (other setting)' if eng(a) == eng(b) else 'read vs read, other engine'
    if ca != cb: return 'read vs correction'
    da, db = a.rsplit('>', 1)[0], b.rsplit('>', 1)[0]
    return 'correction vs correction, same draft' if da == db else 'correction vs correction, other draft'


def two(pages, a, b):
    t = [[0, 0], [0, 0]]
    for p in pages: t[1 - p[a][0]][1 - p[b][0]] += 1
    (n11, n10), (n01, n00) = t
    n = n11 + n10 + n01 + n00
    pa, pb = (n11 + n10) / n, (n11 + n01) / n
    den = math.sqrt(pa * (1 - pa) * pb * (1 - pb))
    phi = ((n11 * n00 - n10 * n01) / n / n) / den if den > 0 else None
    vi = pa * (1 - pa) + pb * (1 - pb)
    vp = (n10 + n01) / n - ((n10 - n01) / n) ** 2
    d = n10 + n01
    p = min(1, 2 * sum(math.comb(d, i) for i in range(0, min(n10, n01) + 1)) / 2 ** d) if d else 1.0
    return dict(n=n, both=n11, only_a=n10, only_b=n01, neither=n00, pa=round(pa, 3), pb=round(pb, 3),
                phi=None if phi is None else round(phi, 3), ratio=round(vp / vi, 3) if vi > 0 else None, mcnemar_p=round(p, 4))


def pairs_of(src, T):
    by = collections.defaultdict(list)
    for (cell, book, page), rts in T.items():
        for a in rts:
            for b in rts:
                if a < b: by[(cell, a, b)].append(dict(rts, _book=book))
    out = []
    for (cell, a, b), pages in by.items():
        if len(pages) < 10: continue
        r = two(pages, a, b)
        r.update(source=src['name'], cell=cell, a=a, b=b, kind=kind(a, b), task=src['task'], judge=src['judge'], draw=src['draw'],
                 books=len({p['_book'] for p in pages}), clustered=bool(src.get('cluster')))
        out.append(r)
    return out, by


def split_half(pages, a, b, reps=2000, seed=7263):
    """Books split at random into halves; the half-A winner (more accepted pages, ties skipped) wins on half B?"""
    books = collections.defaultdict(list)
    for p in pages: books[p['_book']].append((p[a][0], p[b][0]))
    ids = sorted(books)
    if len(ids) < 20: return None
    rng = random.Random(seed); same = flip = tieA = tieB = 0
    for _ in range(reps):
        rng.shuffle(ids); h = len(ids) // 2
        g = lambda bs: sum(x - y for i in bs for x, y in books[i])
        ga, gb = g(ids[:h]), g(ids[h:])
        if ga == 0: tieA += 1; continue
        if gb == 0: tieB += 1; continue
        if (ga > 0) == (gb > 0): same += 1
        else: flip += 1
    dec = same + flip
    return dict(books=len(ids), same=round(same / dec, 3) if dec else None, flip=round(flip / dec, 3) if dec else None,
                tie_in_first_half=round(tieA / reps, 3), tie_in_second_half=round(tieB / reps, 3))


def kappa(x, y):
    n = len(x); po = sum(a == b for a, b in zip(x, y)) / n
    p1, p2 = sum(x) / n, sum(y) / n; pe = p1 * p2 + (1 - p1) * (1 - p2)
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def agree_block(name, what, x, y, extra=None):
    n = len(x)
    return dict(source=name, what=what, n=n, agree=sum(a == b for a, b in zip(x, y)), kappa=kappa(x, y) if n else None,
                first_accept=sum(x), second_accept=sum(y), **(extra or {}))


def noise():
    """Every repeat on file that is not a route pair: the same text judged twice; the same live read made twice (CER)."""
    out = []
    # latin-250: the same stored or corrected text shown to another blind reader in another packet
    by = collections.defaultdict(list)
    for r in P.latin_250(): by[(r['book'], r['page'], r['route'])].append(not r['wrong_text'])
    for rt in sorted({k[2] for k in by}):
        x, y = zip(*[(v[0], v[1]) for k, v in by.items() if k[2] == rt and len(v) > 1]) or ((), ())
        if x: out.append(agree_block('latin-250-5924', f'{rt}: the same text judged by another blind reader in another packet (Step T, not misleading)', list(x), list(y), dict(books=10)))
    # judge-compare-7611: 30 items, each judge twice
    d = P.R + 'judge-compare-7611/results/2026-10-30/'
    items = {i['id']: i for i in P._load(d + 'items.json')}
    for j in ('opus', 'argon', 'flash'):
        rep = {v['id']: (v.get('verdict') or {}).get('accept') for v in P._load(d + f'verdicts-{j}-repeat.jsonl.gz')}
        first = ({i: items[i].get('opus_accept') for i in rep} if j == 'opus' else
                 {v['id']: (v.get('verdict') or {}).get('accept') for v in P._load(d + f'verdicts-{j}.jsonl.gz') if v['id'] in rep})
        ks = [i for i in rep if rep[i] is not None and first.get(i) is not None]
        out.append(agree_block('judge-compare-7611', f'{j} judge, same text judged twice (route judge)', [bool(first[i]) for i in ks], [bool(rep[i]) for i in ks],
                               dict(books=len({items[i]['book_id'] for i in ks}))))
    # correction-pass-7818: rep 1 vs rep 2 by item
    v = collections.defaultdict(dict)
    for r in P.correction_release():
        if r['set'] == 'abs' and r['accept'] is not None: v[r['id']][r['rep']] = r['accept']
    ks = [i for i in v if 1 in v[i] and 2 in v[i]]
    out.append(agree_block('correction-pass-7818', 'Opus route judge, same text judged twice', [v[i][1] for i in ks], [v[i][2] for i in ks]))
    # zh-ditto-restore: judge vs judge2 by (page, arm)
    a = {(r['book'], r['page'], r['route']): r['accept'] for r in P.zh_ditto_restore('judge-judge.json')}
    b = {(r['book'], r['page'], r['route']): r['accept'] for r in P.zh_ditto_restore('judge-judge2.json')}
    ks = sorted(set(a) & set(b))
    out.append(agree_block('zh-ditto-restore-5274', 'Opus Step T judge, same page and arm judged in two passes (second pass not preregistered)', [a[k] for k in ks], [b[k] for k in ks], dict(books=len({k[0] for k in ks}))))
    # judge-cal-7866bar: set repeat rows 'rep-<uid>'
    vs = P._load(P.R + 'judge-cal-7866bar-7263/results/verdicts.jsonl')
    acc = lambda x: (x.get('verdict') or x).get('accept')
    first = {x.get('uid') or x.get('id'): acc(x) for x in vs if x.get('set') != 'repeat'}
    pairs = [(first.get(x['id'][4:]), acc(x)) for x in vs if x.get('set') == 'repeat']
    pairs = [(bool(p), bool(q)) for p, q in pairs if p is not None and q is not None]
    if pairs: out.append(agree_block('judge-cal-7866bar-7263', 'Opus route judge on typed-reference pages, judged twice', [p for p, _ in pairs], [q for _, q in pairs]))
    # read-surface-6740: the live read@4 made twice (L1, L2), scored by CER against a typed reference
    d = P._load(P.R + 'read-surface-6740/results/score.json.gz')['langs']
    for lang, v in d.items():
        runs = {r['id']: {t['slug']: t for t in r['targets']} for r in v['runs']}
        L1, L2 = runs.get('L1'), runs.get('L2')
        if not (L1 and L2): continue
        both = [k for k in L1 if k in L2 and L1[k].get('cer') is not None and L2[k].get('cer') is not None]
        st = sum((L1[k]['status'] == 'read') == (L2[k]['status'] == 'read') for k in L1 if k in L2)
        c1 = [L1[k]['cer'] for k in both]; c2 = [L2[k]['cer'] for k in both]
        diff = sorted(abs(x - y) for x, y in zip(c1, c2))
        out.append(dict(source='read-surface-6740', what=f'{lang}: the live agy read@4 made twice (L1, L2), CER against a typed reference', n=len(both),
                        status_agree=f'{st}/{len([k for k in L1 if k in L2])}', median_abs_cer_diff=round(statistics.median(diff), 4) if diff else None,
                        p90_abs_cer_diff=round(diff[int(.9 * len(diff))], 4) if diff else None,
                        under_2pct_both=sum(x <= .02 and y <= .02 for x, y in zip(c1, c2)), under_2pct_one=sum((x <= .02) != (y <= .02) for x, y in zip(c1, c2)),
                        wrong_text_agree=sum(bool(L1[k].get('wrong_text')) == bool(L2[k].get('wrong_text')) for k in both)))
    return out


def strata(allpairs):
    """The same two routes in two or more cells of one test (language, face, print vs Siku): does the gap differ?"""
    g = collections.defaultdict(list)
    for p in allpairs: g[(p['source'], p['a'], p['b'])].append(p)
    out = []
    for (src, a, b), ps in g.items():
        if len(ps) < 2: continue
        rows = []
        for p in ps:
            n = p['n']; d = (p['only_a'] - p['only_b']) / n
            se = math.sqrt(max(((p['only_a'] + p['only_b']) / n - d * d) / n, 1e-9))
            rows.append(dict(cell=p['cell'], n=n, books=p['books'], gap=round(d, 3), ci95=[round(d - 1.96 * se, 3), round(d + 1.96 * se, 3)], _se=se))
        hi, lo = max(rows, key=lambda r: r['gap']), min(rows, key=lambda r: r['gap'])
        dd = hi['gap'] - lo['gap']; se = math.sqrt(hi['_se'] ** 2 + lo['_se'] ** 2)
        for r in rows: r.pop('_se')
        out.append(dict(source=src, a=a, b=b, cells=rows, widest=round(dd, 3), widest_ci95=[round(dd - 1.96 * se, 3), round(dd + 1.96 * se, 3)], separable=dd - 1.96 * se > 0))
    return out


def main():
    out = arg('--out')
    allpairs, repeats, splits, inv = [], [], [], []
    for s in SOURCES:
        try: T, dup = table(s)
        except Exception as e:
            inv.append(dict(source=s['name'], error=repr(e)[:200])); continue
        ps, by = pairs_of(s, T)
        inv.append(dict(source=s['name'], pages=len(T), books=len({k[1] for k in T}), routes=sorted({r for v in T.values() for r in v}), task=s['task'], judge=s['judge'], draw=s['draw'], pairs=len(ps)))
        for r in ps:
            if r['kind'] == 'repeat': repeats.append(dict(r, what='same route read twice, each judged once'))
            else: allpairs.append(r)
            sh = split_half(by[(r['cell'], r['a'], r['b'])], r['a'], r['b'])
            if sh: splits.append(dict(source=r['source'], cell=r['cell'], a=r['a'], b=r['b'], kind=r['kind'], n=r['n'], pa=r['pa'], pb=r['pb'], mcnemar_p=r['mcnemar_p'], **sh))
        if dup:  # the same route's text on the same page judged more than once
            x = [d[2] for d in dup]; y = [d[3] for d in dup]
            repeats.append(dict(source=s['name'], what='same text judged again (later verdict on a page already judged)', n=len(dup),
                                agree=sum(a == b for a, b in zip(x, y)), kappa=kappa(x, y), first_accept=sum(x), second_accept=sum(y)))
    summ = {}
    for k in sorted({p['kind'] for p in allpairs}):
        ps = [p for p in allpairs if p['kind'] == k and p['phi'] is not None and p['n'] >= 20]
        if not ps: continue
        phis = sorted(p['phi'] for p in ps); rs = sorted(p['ratio'] for p in ps if p['ratio'] is not None)
        q = lambda v, f: v[min(len(v) - 1, int(f * len(v)))]
        summ[k] = dict(pairs=len(ps), sources=len({p['source'] for p in ps}), pages=sum(p['n'] for p in ps),
                       phi_median=statistics.median(phis), phi_q25=q(phis, .25), phi_q75=q(phis, .75),
                       phi_weighted=round(sum(p['phi'] * p['n'] for p in ps) / sum(p['n'] for p in ps), 3),
                       ratio_median=statistics.median(rs), ratio_q25=q(rs, .25), ratio_q75=q(rs, .75),
                       ratio_pooled=round(sum(p['ratio'] * p['n'] for p in ps if p['ratio'] is not None) / sum(p['n'] for p in ps if p['ratio'] is not None), 3),
                       random_only_phi_median=statistics.median([p['phi'] for p in ps if p['draw'] == 'random'] or [float('nan')]))
    repeats += noise()
    by_kind = strata(allpairs)
    doc = dict(inventory=inv, link_summary=summ, pairs=allpairs, repeats=repeats, split_half=splits, by_kind_of_book=by_kind)
    s = json.dumps(doc, indent=1, ensure_ascii=False)
    if out: open(out, 'w').write(s + '\n')
    print(json.dumps(dict(inventory=inv, link_summary=summ), indent=1, ensure_ascii=False))


arg = lambda f, d=None: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d
if __name__ == '__main__':
    main()
