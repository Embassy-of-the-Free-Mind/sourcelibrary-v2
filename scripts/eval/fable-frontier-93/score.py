#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs score (accept / wrong_text k/n per arm and judge, controls,
# noise floor; run as well, its paired-score.json is committed) and defect-rate.py (the #8283 weighting: misleads +
# 3 x wrong_text per 1,000 words). Neither gives the paired DIFFERENCE between two fresh arms with a by-page interval
# under each of two judges, the judges' agreement, or the correction-check precision, which the #93 rule decides on.
"""score.py --out DIR  -> DIR/score.json and a printed summary (stdlib only, no model call).

Per judge (opus, fable): per arm fidelity, accept, severity-weighted defects per 1,000 words (SW = (misleads +
3 x wrong_text) / words x 1000), wrong-text pages; paired differences on shared pages with a bootstrap over pages
(each page is its own book); controls (wrong-page rejected, planted error caught); the noise floor from repeats;
Krippendorff's alpha (interval) between the judges on fidelity; and the correction check (DIR/corr/reads-*.jsonl).
A page where a fresh arm gave no text is scored as that arm's failure: fidelity 1, not accepted, SW at the arm-pooled
95th percentile (reported apart as `failed`).
"""
import json, os, random, re, statistics as st, sys, collections, math

OUT = sys.argv[sys.argv.index('--out') + 1]
ARMS = ['LIVE', 'OPUS2', 'OPUSX', 'FABLE']
PAIRS = [('FABLE', 'OPUSX'), ('FABLE', 'OPUS2'), ('OPUSX', 'OPUS2'), ('OPUS2', 'LIVE'), ('OPUSX', 'LIVE'), ('FABLE', 'LIVE')]
J = lambda f: json.load(open(os.path.join(OUT, f)))
jl = lambda f: [json.loads(l) for l in open(f) if l.strip()] if os.path.exists(f) else []
key = J('key.json'); items = {it['id']: it for it in J('packet.json')['items']}
sample = {p['uid']: p for p in J('sample.json')['pages']}
canon = J('canonical.json') if os.path.exists(os.path.join(OUT, 'canonical.json')) else {}
STRIP = re.compile(r'<(summary|keywords)>[\s\S]*?</\1>')
words = lambda t: len(STRIP.sub(' ', t or '').split())
R = random.Random(93)
BOOT = 4000


def boot(diffs):
    n = len(diffs)
    if n < 2: return None
    ms = sorted(st.mean(R.choice(diffs) for _ in range(n)) for _ in range(BOOT))
    return [round(ms[int(0.025 * BOOT)], 3), round(ms[int(0.975 * BOOT) - 1], 3)]


def alpha_interval(pairs):
    """Krippendorff's alpha, interval metric, two coders, no missing values."""
    vals = [v for p in pairs for v in p]
    n = len(vals)
    if n < 4: return None
    do = sum((a - b) ** 2 for a, b in pairs) * 2 / (2 * len(pairs))
    de = sum((a - b) ** 2 for a in vals for b in vals) / (n * (n - 1))
    return round(1 - do / de, 3) if de else None


verd = {}
for j in ('opus', 'fable'):
    m = {}
    for r in jl(os.path.join(OUT, f'verdicts-{j}.jsonl')):
        if r.get('verdict') and r['id'] not in m: m[r['id']] = r
    if m: verd[j] = m
fresh_text = {a: {} for a in ARMS}
for a in ARMS[1:]:
    for r in jl(os.path.join(OUT, 'arms', f'{a}.jsonl')):
        if r.get('text', '').strip(): fresh_text[a][r['uid']] = r
fresh_rows = {a: {r['uid']: r for r in jl(os.path.join(OUT, 'arms', f'{a}.jsonl'))} for a in ARMS[1:]}


def metrics(v, text):
    d = v.get('defects') or []
    w = max(1, words(text))
    mis = sum(1 for x in d if x.get('severity') == 'misleads'); wt = sum(1 for x in d if x.get('severity') == 'wrong_text')
    return dict(fid=float(v['fidelity']), acc=1.0 if v['accept'] else 0.0, sw=(mis + 3 * wt) * 1000 / w, wt=1.0 if wt else 0.0, mis=mis, wtn=wt, words=w,
                classes=[x.get('class') for x in d if x.get('severity') in ('misleads', 'wrong_text')])


report = {'n_pages': len(sample), 'judges': {}}
pages_all = sorted(sample)
for j, V in verd.items():
    per = {a: {} for a in ARMS}
    for k in key:
        if k['kind'] != 'item' or k['judged_as'] not in V: continue
        per[k['route']][k['uid']] = metrics(V[k['judged_as']]['verdict'], items[k['judged_as']]['text'])
    # failures: a fresh arm with no text on a page every other arm has
    sws = [m['sw'] for a in ARMS for m in per[a].values()]
    p95 = sorted(sws)[int(0.95 * len(sws))] if sws else 0
    failed = {}
    for a in ARMS[1:]:
        # a page the arm was never run on (no row: the runner was paused for budget) is not a failure; a row without text is
        f = [u for u in pages_all if u in fresh_rows[a] and u not in fresh_text[a]]
        failed[a] = f
        for u in f: per[a][u] = dict(fid=1.0, acc=0.0, sw=p95, wt=1.0, mis=0, wtn=0, words=0, classes=['FAILED'], failed=True)
    arms = {}
    for a in ARMS:
        ms = list(per[a].values())
        if not ms: continue
        arms[a] = dict(n=len(ms), failed=len(failed.get(a, [])), fidelity=round(st.mean(m['fid'] for m in ms), 3), accept=f"{int(sum(m['acc'] for m in ms))}/{len(ms)}",
                       sw_per_1000=round(st.mean(m['sw'] for m in ms), 2), sw_pooled=round(sum(m['mis'] + 3 * m['wtn'] for m in ms) * 1000 / max(1, sum(m['words'] for m in ms)), 2),
                       wrong_text_pages=int(sum(m['wt'] for m in ms)), misleads=sum(m['mis'] for m in ms), wrong_text=sum(m['wtn'] for m in ms),
                       classes=dict(collections.Counter(c for m in ms for c in m['classes']).most_common(8)))
        # the experiments-lint defect_rates shape (experiment-header.mjs defectRatesShapeOk): pooled per 1,000 words
        words_all = max(1, sum(m['words'] for m in ms))
        report.setdefault('study_cells', {})[f'frontier/{a}/judge-{j}'] = dict(route=a, judge=j, pages=len(ms), words=words_all, fidelity_mean=arms[a]['fidelity'],
                       misleads_per_1k=round(arms[a]['misleads'] * 1000 / words_all, 3), wrong_text_per_1k=round(arms[a]['wrong_text'] * 1000 / words_all, 3))
    pairs = {}
    for a, b in PAIRS:
        shared = [u for u in pages_all if u in per[a] and u in per[b]]
        if len(shared) < 5: continue
        out = {'n': len(shared)}
        for mname in ('fid', 'sw', 'acc'):
            d = [per[a][u][mname] - per[b][u][mname] for u in shared]
            out[mname] = dict(mean=round(st.mean(d), 3), ci95=boot(d), sd=round(st.pstdev(d), 3), better=sum(1 for x in d if (x > 0) == (mname != 'sw') and x != 0), worse=sum(1 for x in d if (x < 0) == (mname != 'sw') and x != 0))
        # by language, and without the pages marked canonical (an edition of a work a published English translation exists for)
        out['by_lang'] = {}
        for L in sorted({sample[u]['lang'] for u in shared}):
            s = [u for u in shared if sample[u]['lang'] == L]
            out['by_lang'][L] = dict(n=len(s), fid=round(st.mean(per[a][u]['fid'] - per[b][u]['fid'] for u in s), 2), sw=round(st.mean(per[a][u]['sw'] - per[b][u]['sw'] for u in s), 2))
        if canon:
            s = [u for u in shared if not canon.get(u)]
            out['not_canonical'] = dict(n=len(s), fid=dict(mean=round(st.mean(per[a][u]['fid'] - per[b][u]['fid'] for u in s), 3), ci95=boot([per[a][u]['fid'] - per[b][u]['fid'] for u in s])),
                                        sw=dict(mean=round(st.mean(per[a][u]['sw'] - per[b][u]['sw'] for u in s), 3), ci95=boot([per[a][u]['sw'] - per[b][u]['sw'] for u in s])))
        pairs[f'{a}-{b}'] = out
    # controls
    wp = {a: [] for a in ARMS}; pl = {a: [] for a in ARMS}; rep = []
    for k in key:
        if k['judged_as'] not in V: continue
        v = V[k['judged_as']]['verdict']
        if k['kind'] == 'wrong_page': wp[k['route']].append(not v['accept'] and float(v['fidelity']) <= 2)
        elif k['kind'] == 'planted':
            base = per[k['route']].get(k['uid'])
            new = (k['plant'].get('new') or '') + ' ' + (k['plant'].get('old') or '')
            toks = lambda s: set(re.findall(r'\w{4,}', s.lower()))
            hit = any(x.get('severity') in ('misleads', 'wrong_text') and (toks(x.get('quote', '')) & toks(new)) for x in (v.get('defects') or []))
            pl[k['route']].append(dict(uid=k['uid'], kind=k['plant'].get('kind'), how=k['plant'].get('how'), caught=hit, fid=float(v['fidelity']), base_fid=base['fid'] if base else None, lower=base is not None and float(v['fidelity']) < base['fid']))
        elif k['kind'] == 'repeat':
            orig = next((kk for kk in key if kk['kind'] == 'item' and kk['route'] == k['route'] and kk['uid'] == k['uid']), None)
            if orig and orig['judged_as'] in V:
                m1 = metrics(V[orig['judged_as']]['verdict'], items[orig['judged_as']]['text']); m2 = metrics(v, items[k['judged_as']]['text'])
                rep.append(dict(fid=m2['fid'] - m1['fid'], sw=m2['sw'] - m1['sw'], acc_flip=m1['acc'] != m2['acc']))
    plants = [x for a in ARMS for x in pl[a]]
    noise = None
    if rep:
        nf_f = boot([r['fid'] for r in rep]) or [0, 0]; nf_s = boot([r['sw'] for r in rep]) or [0, 0]
        noise = dict(n=len(rep), fid_mean=round(st.mean(r['fid'] for r in rep), 3), fid_ci95=nf_f, fid_floor=round(max(0.10, max(abs(x) for x in nf_f)), 3),
                     sw_mean=round(st.mean(r['sw'] for r in rep), 3), sw_ci95=nf_s, sw_floor=round(max(abs(x) for x in nf_s), 3), fid_identical=sum(1 for r in rep if r['fid'] == 0), accept_flips=sum(r['acc_flip'] for r in rep),
                     sd_fid=round(st.pstdev([r['fid'] for r in rep]), 3), sd_sw=round(st.pstdev([r['sw'] for r in rep]), 3))
    report['judges'][j] = dict(model_check=dict(collections.Counter(','.join(r.get('models') or []) for r in V.values())), arms=arms, pairs=pairs,
                               controls=dict(wrong_page={a: f'{sum(x)}/{len(x)}' for a, x in wp.items()}, planted=dict(caught=sum(x['caught'] or x['lower'] for x in plants), quoted=sum(x['caught'] for x in plants), n=len(plants), detail=plants)),
                               noise=noise, per_page={a: {u: dict(fid=m['fid'], sw=round(m['sw'], 2), acc=m['acc']) for u, m in per[a].items()} for a in ARMS})

# agreement and family lean
if len(verd) == 2:
    O, F = report['judges']['opus']['per_page'], report['judges']['fable']['per_page']
    pairs = [(O[a][u]['fid'], F[a][u]['fid']) for a in ARMS for u in O[a] if u in F[a] and not report['judges']['opus']['per_page'][a][u].get('failed')]
    lean = {}
    for a, b in (('FABLE', 'OPUSX'), ('FABLE', 'OPUS2')):
        shared = [u for u in O[a] if u in O[b] and u in F[a] and u in F[b]]
        d = [(F[a][u]['fid'] - F[b][u]['fid']) - (O[a][u]['fid'] - O[b][u]['fid']) for u in shared]
        lean[f'{a}-{b}'] = dict(n=len(shared), fable_judge_minus_opus_judge=round(st.mean(d), 3) if d else None, ci95=boot(d) if d else None)
    report['agreement'] = dict(alpha_fidelity=alpha_interval(pairs), n=len(pairs), exact=sum(1 for a, b in pairs if a == b), within1=sum(1 for a, b in pairs if abs(a - b) <= 1),
                               accept_agree=sum(1 for a in ARMS for u in O[a] if u in F[a] and O[a][u]['acc'] == F[a][u]['acc']),
                               family_lean=lean)

# correction check
ci = os.path.join(OUT, 'corr', 'read-items.json')
if os.path.exists(ci):
    its = {x['cid']: x for x in json.load(open(ci))}
    corr = {}
    for rd in ('opus', 'fable'):
        rows = {r['cid']: r['v'] for r in jl(os.path.join(OUT, 'corr', f'reads-{rd}.jsonl')) if r.get('v')}
        if not rows: continue
        res = collections.defaultdict(lambda: collections.Counter())
        for cid, v in rows.items():
            it = its.get(cid)
            if not it: continue
            a = v['answer']; who = 'neither' if a == 'neither' else 'unreadable' if a == 'unreadable' else ('ocr' if a == it['ocr_is'] else 'arm')
            res[(it['kind'], it['set'], it['arm'])][who] += 1
        tab = {}
        for (kind, s, arm), c in sorted(res.items()):
            n = sum(c.values()); dec = c['ocr'] + c['arm']
            tab[f'{kind}/{s}/{arm}'] = dict(n=n, image_supports_arm=c['arm'], transcription_right=c['ocr'], neither=c['neither'], unreadable=c['unreadable'],
                                           precision=round(c['arm'] / n, 3) if n else None, precision_of_decided=round(c['arm'] / dec, 3) if dec else None)
        corr[rd] = tab
    # both readers agree
    both = {}
    ro = {r['cid']: r['v'] for r in jl(os.path.join(OUT, 'corr', 'reads-opus.jsonl')) if r.get('v')}
    rf = {r['cid']: r['v'] for r in jl(os.path.join(OUT, 'corr', 'reads-fable.jsonl')) if r.get('v')}
    sh = [c for c in ro if c in rf]
    corr['reader_agreement'] = dict(n=len(sh), same_answer=sum(1 for c in sh if ro[c]['answer'] == rf[c]['answer']))
    report['corrections'] = corr

json.dump(report, open(os.path.join(OUT, 'score.json'), 'w'), indent=1, ensure_ascii=False)
for j, R_ in report['judges'].items():
    print(f'== judge {j}: models {R_["model_check"]}')
    for a, x in R_['arms'].items(): print(f'  {a:6s} n={x["n"]} failed={x["failed"]} fid={x["fidelity"]} accept={x["accept"]} SW/1000={x["sw_per_1000"]} (pooled {x["sw_pooled"]}) wt_pages={x["wrong_text_pages"]}')
    for p, x in R_['pairs'].items(): print(f'  {p:12s} n={x["n"]} fid {x["fid"]["mean"]:+.3f} {x["fid"]["ci95"]} ({x["fid"]["better"]}/{x["fid"]["worse"]})  SW {x["sw"]["mean"]:+.2f} {x["sw"]["ci95"]} (sd {x["sw"]["sd"]})')
    print(f'  controls {R_["controls"]["wrong_page"]} planted {R_["controls"]["planted"]["caught"]}/{R_["controls"]["planted"]["n"]} (quoted {R_["controls"]["planted"]["quoted"]}); noise {R_["noise"] and {k: v for k, v in R_["noise"].items()}}')
if 'agreement' in report: print('agreement', report['agreement'])
if 'corrections' in report: print(json.dumps(report['corrections'], indent=1))
