#!/usr/bin/env python3
# PRIOR ART: scripts/eval/confidence-7866/analyze.mjs (the >= 2-of-5 book rule, MIN_JUDGED 4, the stratum x frame-size
# corpus share: restated here, in Python, to run the corrected version by simulation); scripts/eval/judge-calibration-7263
# (#7880: sensitivity / specificity / kappa with Wilson intervals; its plug-in correction of a k/n, which a page-level
# Rogan-Gladen generalises). Stdlib only.
"""Judge calibration at #7866's bar (#7263): the analysis. Reads results/ only; writes results/score.json.

  python3 scripts/eval/judge-cal-7866bar-7263/analyze.py

1. Calibration: the judge's page call (#7866 badPage: not accepted, or a wrong_text defect) against the truth from the
   typed reference (lib.mjs, TAU = 1%; 0.5 / 2 / 5% beside it) and against the meaning test (any misleading difference
   between the two translations). Sensitivity = P(judge bad | truly bad), specificity = P(judge good | truly good).
2. Correction of #7866: per script stratum, the page-level Rogan-Gladen prevalence p = (q + spec - 1) / (sens + spec - 1)
   from #7866's judge-bad share q; each page's true state drawn from its posterior given the judge's call; the >= 2-of-5
   rule applied to the drawn states; the corpus share weighted by stratum frame size as #7866 did. Each simulation
   draw also redraws sens / spec from their Beta posteriors and resamples #7866's books within its strata, so the
   interval carries both the calibration and the sampling uncertainty. Unknown-script pages take the print calibration.
3. Severe defects per 1,000 words (Derek, 2026-11-01): the meaning test, its translation noise floor, the judge-only
   proxy (MQM misleads + wrong_text), their agreement, and the human-typed arm.
"""
import json, math, os, random, statistics as S
from collections import Counter, defaultdict

H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, 'results')
L = lambda f: [json.loads(l) for l in open(os.path.join(R, f)) if l.strip()]
SIMS, SEED = 4000, 72636
BAD_BOOK_MIN, MIN_JUDGED = 2, 4


def wilson(k, n, z=1.96):
    if not n: return [None, None]
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - h) / d, 3), round((c + h) / d, 3)]


def kappa(pairs):
    n = len(pairs)
    if not n: return None
    po = sum(a == b for a, b in pairs) / n
    pa, pb = sum(a for a, _ in pairs) / n, sum(b for _, b in pairs) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return None if pe == 1 else round((po - pe) / (1 - pe), 3)


def confusion(rows, truth_key):
    tp = sum(1 for r in rows if r[truth_key] and r['judge_bad']); fn = sum(1 for r in rows if r[truth_key] and not r['judge_bad'])
    tn = sum(1 for r in rows if not r[truth_key] and not r['judge_bad']); fp = sum(1 for r in rows if not r[truth_key] and r['judge_bad'])
    return dict(n=len(rows), truly_bad=tp + fn, tp=tp, fn=fn, tn=tn, fp=fp,
                sensitivity=round(tp / (tp + fn), 3) if tp + fn else None, sensitivity_ci=wilson(tp, tp + fn),
                specificity=round(tn / (tn + fp), 3) if tn + fp else None, specificity_ci=wilson(tn, tn + fp),
                kappa=kappa([(bool(r[truth_key]), bool(r['judge_bad'])) for r in rows]),
                judge_bad_share=round((tp + fp) / len(rows), 3) if rows else None, true_bad_share=round((tp + fn) / len(rows), 3) if rows else None)


def rg(q, se, sp):
    d = se + sp - 1
    return min(1.0, max(0.0, (q + sp - 1) / d)) if d > 0.05 else None


def main():
    truth = {r['uid']: r for r in L('truth.jsonl')}
    V = L('verdicts.jsonl')
    items = {r['uid']: r for r in V if r['set'] == 'item'}
    controls = dict(wrong_page=[r for r in V if r['set'] == 'wrong_page'], repeat=[r for r in V if r['set'] == 'repeat'])
    cmp = L('compare.jsonl') if os.path.exists(os.path.join(R, 'compare.jsonl')) else []
    sev = lambda p: sum(1 for x in (p['differences'] or []) if x.get('misleads'))
    meaning = {p['uid']: p for p in cmp if p['kind'] == 'read'}
    noise = {p['uid']: p for p in cmp if p['kind'] == 'noise'}
    draw = {d['uid']: d for d in json.load(open(os.path.join(R, 'draw.json')))['drawn']}
    rows = []
    for uid, t in truth.items():
        v = items.get(uid)
        if not v: continue
        row = dict(uid=uid, stratum=t['stratum'], lang=t['lang'], judge_bad=v['judge_bad'], accept=v['accept'],
                   judge_severe=sum(1 for d in v['defects'] if d['severity'] in ('misleads', 'wrong_text')),
                   **{f'bad@{k}': t[f'bad@{k}'] for k in (0.005, 0.01, 0.02, 0.05)})
        row['bad'] = row['bad@0.01']
        if uid in meaning and meaning[uid]['differences'] is not None:
            row['meaning_severe'] = sev(meaning[uid]); row['meaning_bad'] = row['meaning_severe'] > 0
        rows.append(row)
    out = dict(generated_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='seconds'), n_items=len(rows),
               controls=dict(wrong_page=f"{sum(1 for r in controls['wrong_page'] if not r['accept'] and r['fidelity'] <= 2)}/{len(controls['wrong_page'])} rejected at fidelity <= 2",
                             repeat=f"{sum(1 for r in controls['repeat'] if items.get(r['uid']) and items[r['uid']]['judge_bad'] == r['judge_bad'])}/{len(controls['repeat'])} same call"))

    # 1. calibration
    cal = {}
    for name, sel in (('print', lambda r: r['stratum'] == 'print'), ('manuscript', lambda r: r['stratum'] == 'manuscript'), ('all', lambda r: True),
                      ('German', lambda r: r['lang'] == 'German'), ('English', lambda r: r['lang'] == 'English'), ('Latin', lambda r: r['lang'] == 'Latin')):
        rs = [r for r in rows if sel(r)]
        cal[name] = {f'cer_tau_{k}': confusion(rs, f'bad@{k}') for k in (0.005, 0.01, 0.02, 0.05)}
        mr = [r for r in rs if 'meaning_bad' in r]
        if mr: cal[name]['meaning'] = confusion(mr, 'meaning_bad')
    out['calibration'] = cal
    # the typed reference is not error-free (the human arm): print calibration without the pages whose reference the
    # human arm found wrong (a flag both adjudicators, or one of them, upheld)
    if os.path.exists(os.path.join(R, 'adjudications.jsonl')):
        bad_ref = set()
        for a in L('adjudications.jsonl'):
            if any(p['verdict'] == 'typed_wrong' for p in a['points']): bad_ref.add(a['uid'])
        rs = [r for r in rows if r['stratum'] == 'print' and r['uid'] not in bad_ref]
        out['calibration_print_clean_references'] = dict(excluded=len(bad_ref), **confusion(rs, 'bad@0.01'))

    # 2. the corrected #7866 corpus share
    F = json.load(open(os.path.join(R, 'frame-7866.json')))
    N = F['frame_books']; fr = [r for r in F['rows'] if r['judged']]
    books = defaultdict(list)
    for r in fr: books[r['book_id']].append(r)
    meta = {b: dict(stratum=ps[0]['stratum'], weight=ps[0]['weight'], reads=ps[0]['human_read_count'] or 0) for b, ps in books.items()}
    by_h = defaultdict(list)
    for b, m in meta.items(): by_h[m['stratum']].append(b)
    cls = lambda s: 'manuscript' if s == 'manuscript' else 'print'

    def corpus(bad_of, ids_by_h, weight=None):
        num = den = 0.0
        for h, ids in ids_by_h.items():
            c = [b for b in ids if len(books[b]) >= MIN_JUDGED]
            if not c: continue
            if weight is None:
                num += N[h] * sum(bad_of[b] for b in c) / len(c); den += N[h]
            else:
                w = [meta[b]['weight'] * weight(b) for b in c]; num += sum(wi * bad_of[b] for wi, b in zip(w, c)); den += sum(w)
        return num / den if den else None
    raw_bad = {b: sum(p['judge_bad'] for p in ps) >= BAD_BOOK_MIN for b, ps in books.items()}
    reads = lambda b: meta[b]['reads']
    out['corpus_7866_uncorrected'] = dict(bad_share=round(corpus(raw_bad, by_h), 3), read_weighted=round(corpus(raw_bad, by_h, reads) or 0, 3),
                                          books_with_reads=sum(1 for m in meta.values() if m['reads']), reads_total=sum(m['reads'] for m in meta.values()))

    rng = random.Random(SEED)
    def simulate(calib, label):
        shares, rshares, prevs = [], [], defaultdict(list)
        for it in range(SIMS):
            se = {s: rng.betavariate(1 + calib[s]['tp'], 1 + calib[s]['fn']) for s in calib}
            sp = {s: rng.betavariate(1 + calib[s]['tn'], 1 + calib[s]['fp']) for s in calib}
            ids_by_h = {h: [rng.choice(ids) for _ in ids] for h, ids in by_h.items()}   # books resampled within strata
            pages = [p for ids in ids_by_h.values() for b in ids for p in books[b]]
            p_s = {}
            for s in calib:
                ps = [p for p in pages if cls(p['script']) == s]
                q = sum(p['judge_bad'] for p in ps) / len(ps)
                v = rg(q, se[s], sp[s]); p_s[s] = q if v is None else v
                prevs[s].append(p_s[s])
            post = {}
            for s in calib:
                p, a, b = p_s[s], se[s], sp[s]
                pb = a * p / (a * p + (1 - b) * (1 - p)) if a * p + (1 - b) * (1 - p) > 0 else 0.0     # P(true bad | judge bad)
                pg = (1 - a) * p / ((1 - a) * p + b * (1 - p)) if (1 - a) * p + b * (1 - p) > 0 else 0.0  # P(true bad | judge good)
                post[s] = (pb, pg)
            bad = {}
            for ids in ids_by_h.values():
                for b in set(ids):
                    k = sum(1 for p in books[b] if rng.random() < post[cls(p['script'])][0 if p['judge_bad'] else 1])
                    bad[b] = k >= BAD_BOOK_MIN
            shares.append(corpus(bad, ids_by_h)); rshares.append(corpus(bad, ids_by_h, reads))
        qs = lambda xs: [round(sorted(xs)[int(p * (len(xs) - 1))], 3) for p in (0.025, 0.5, 0.975)]
        rs_ = [x for x in rshares if x is not None]
        return dict(label=label, bad_share=qs(shares), read_weighted=qs(rs_) if rs_ else None,
                    page_prevalence={s: qs(v) for s, v in prevs.items()}, sens_spec_used={s: [calib[s]['sensitivity'], calib[s]['specificity']] for s in calib})
    out['corpus_7866_corrected'] = {f'cer_tau_{t}': simulate({s: cal[s][f'cer_tau_{t}'] for s in ('print', 'manuscript')}, f'truth = typed-reference CER > {t:.1%} or a wrong-text span (lib.mjs)')
                                    for t in (0.01, 0.02, 0.05)}
    if all('meaning' in cal[s] for s in ('print', 'manuscript')):
        out['corpus_7866_corrected']['meaning'] = simulate({s: cal[s]['meaning'] for s in ('print', 'manuscript')}, 'truth = a misleading difference between the translations of the read and of the reference')
    # sampling only (no calibration): resample #7866's books, the judge's calls as they are
    raw = []
    for _ in range(SIMS):
        ids_by_h = {h: [rng.choice(ids) for _ in ids] for h, ids in by_h.items()}
        raw.append(corpus(raw_bad, ids_by_h))
    out['corpus_7866_uncorrected']['bad_share_ci95_resampled'] = [round(sorted(raw)[int(p * (SIMS - 1))], 3) for p in (0.025, 0.975)]

    # 3. severe defects per 1,000 words
    W = json.load(open(os.path.join(R, 'words.json'))) if os.path.exists(os.path.join(R, 'words.json')) else {}
    def rate(pairs, count):
        ps = [p for p in pairs if W.get(p['uid'])]
        if not ps: return None
        k, w = sum(count(p) for p in ps), sum(W[p['uid']] for p in ps)
        boots = []
        for _ in range(2000):
            s = [rng.choice(ps) for _ in ps]; ww = sum(W[p['uid']] for p in s)
            boots.append(1000 * sum(count(p) for p in s) / ww if ww else 0)
        boots.sort()
        return dict(pages=len(ps), severe=k, words=w, per_1k=round(1000 * k / w, 3), ci95=[round(boots[50], 3), round(boots[1949], 3)])
    sev_out = {}
    for s in ('print', 'manuscript', 'all'):
        sel = lambda uid: s == 'all' or draw[uid]['stratum'] == s
        m = [dict(uid=u, n=sev(p)) for u, p in meaning.items() if sel(u) and p['differences'] is not None]
        nz = [dict(uid=u, n=sev(p)) for u, p in noise.items() if sel(u) and p['differences'] is not None]
        pr = [dict(uid=u, n=sum(1 for d in items[u]['defects'] if d['severity'] in ('misleads', 'wrong_text'))) for u in truth if sel(u) and u in items]
        sev_out[s] = dict(meaning=rate(m, lambda p: p['n']), noise_floor=rate(nz, lambda p: p['n']), judge_proxy=rate(pr, lambda p: p['n']))
        both = [(dict(m=sev(meaning[u]), j=sum(1 for d in items[u]['defects'] if d['severity'] in ('misleads', 'wrong_text')), w=W.get(u))) for u in truth if sel(u) and u in meaning and u in items and meaning[u]['differences'] is not None and W.get(u)]
        if len(both) >= 5:
            rank = lambda xs: [sorted(xs).index(x) + (sorted(xs).count(x) - 1) / 2 for x in xs]
            a, b = rank([x['m'] / x['w'] for x in both]), rank([x['j'] / x['w'] for x in both])
            ma, mb = S.mean(a), S.mean(b)
            num = sum((x - ma) * (y - mb) for x, y in zip(a, b)); den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
            sev_out[s]['agreement'] = dict(pages=len(both), spearman=round(num / den, 3) if den else None, kappa_any=kappa([(x['m'] > 0, x['j'] > 0) for x in both]),
                                           both_any=sum(1 for x in both if x['m'] and x['j']), meaning_only=sum(1 for x in both if x['m'] and not x['j']), judge_only=sum(1 for x in both if x['j'] and not x['m']), neither=sum(1 for x in both if not x['m'] and not x['j']))
    out['severe_per_1k'] = sev_out
    # #7866's corpus on the judge-only proxy: MQM misleads + wrong_text per 1,000 words of the page's stored text,
    # design-weighted (book weight), books resampled within strata for the interval
    def proxy(ids_by_h, sel):
        num = den = 0.0
        for ids in ids_by_h.values():
            for b in ids:
                for p in books[b]:
                    if sel(p) and p['words_now']:
                        num += meta[b]['weight'] * (p['misleads'] + p['wrong_text']); den += meta[b]['weight'] * p['words_now']
        return 1000 * num / den if den else None
    px = {}
    for name, sel in (('all', lambda p: True), ('print', lambda p: cls(p['script']) == 'print'), ('manuscript', lambda p: cls(p['script']) == 'manuscript')):
        bs = sorted(x for x in (proxy({h: [rng.choice(ids) for _ in ids] for h, ids in by_h.items()}, sel) for _ in range(1000)) if x is not None)
        px[name] = dict(per_1k=round(proxy(by_h, sel), 2), ci95=[round(bs[25], 2), round(bs[974], 2)])
    out['corpus_7866_judge_proxy_per_1k'] = px

    # the human-typed arm
    if os.path.exists(os.path.join(R, 'verdicts-human.jsonl')):
        hv = L('verdicts-human.jsonl'); adj = L('adjudications.jsonl') if os.path.exists(os.path.join(R, 'adjudications.jsonl')) else []
        A = defaultdict(dict)
        for a in adj: A[a['uid']][a['judge']] = a['points']
        kinds = Counter(); real = defaultdict(int)
        flags = []
        for v in hv:
            fl = [d for d in v['defects'] if d['severity'] in ('misleads', 'wrong_text')]
            o, g = A[v['uid']].get('opus') or [], A[v['uid']].get('agy') or []
            for i, d in enumerate(fl):
                vo = o[i]['verdict'] if i < len(o) else None; vg = g[i]['verdict'] if i < len(g) else None
                res = 'real' if vo == 'typed_wrong' and vg == 'typed_wrong' else 'false_alarm' if vo == 'typed_right' and vg == 'typed_right' else 'split' if vo and vg else 'unadjudicated'
                flags.append(dict(uid=v['uid'], cls=d['class'], severity=d['severity'], result=res, opus=vo, gemini=vg))
        by = defaultdict(Counter)
        for f in flags: by[f['cls']][f['result']] += 1
        hp = [dict(uid=v['uid'], n=sum(1 for d in v['defects'] if d['severity'] in ('misleads', 'wrong_text')), r=sum(1 for f in flags if f['uid'] == v['uid'] and f['result'] == 'real'),
                   rs=sum(1 for f in flags if f['uid'] == v['uid'] and f['result'] in ('real', 'split'))) for v in hv]
        out['human_arm'] = dict(pages=len(hv), accepted=f"{sum(1 for v in hv if v['accept'])}/{len(hv)}", judge_bad=f"{sum(1 for v in hv if not v['accept'] or any(d['severity'] == 'wrong_text' for d in v['defects']))}/{len(hv)}",
                                flags=len(flags), results=dict(Counter(f['result'] for f in flags)), by_class={k: dict(c) for k, c in sorted(by.items())},
                                flagged_per_1k=rate(hp, lambda p: p['n']), real_per_1k=rate(hp, lambda p: p['r']), real_or_split_per_1k=rate(hp, lambda p: p['rs']),
                                machine_same_pages=dict(meaning=rate([dict(uid=u, n=sev(meaning[u])) for u in [v['uid'] for v in hv] if u in meaning and meaning[u]['differences'] is not None], lambda p: p['n']),
                                                        judge_proxy=rate([dict(uid=u, n=sum(1 for d in items[u]['defects'] if d['severity'] in ('misleads', 'wrong_text'))) for u in [v['uid'] for v in hv] if u in items], lambda p: p['n'])),
                                flag_rows=flags)
    json.dump(out, open(os.path.join(R, 'score.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in out.items() if k not in ('human_arm',)}, indent=1)[:6000])
    if 'human_arm' in out: print(json.dumps({k: v for k, v in out['human_arm'].items() if k != 'flag_rows'}, indent=1))


if __name__ == '__main__':
    main()
