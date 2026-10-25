#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/build-ocr-table.py (the long-table row: chart, panel, page, work, engine,
# engine_family, kind, period, year, cer, scored, failure, n_ref, n_ref_source) and route_ocr_v1.py (cost per cell from
# route-costs.json quota shares). Those build and price the v0/v1 charts; this writes the #7341 gate's rows in that row
# shape (new charts arabic-manuscript / arabic-print) and prices the three routes on the gate's own usability rates.
"""
  python3 scripts/eval/arabic-mss-gate-7341/summarize.py --out scripts/eval/results/arabic-mss-gate-7341

Writes gate-rows.jsonl (one row per page x engine, estimator long-table shape + usability columns), summary.json
(usability rates with 95% by-book intervals, failed-read rates, cost per usable page) and copies the scored, text-free
artefacts (draw, CER scores, judge verdicts, keys report, anchor) into --out.

Usable = the stricter of the two judges graded the read USABLE or NOTICEABLE ("usable with errors a reader would
notice"); strict = USABLE only. Failed reads are FAILED. Costs: Flash-Lite in USD (Batch list price, route-costs.json;
the realtime price this gate paid is in summary.json); agy in shares of the month's agy allowance (route-costs.json
agy_share_per_call x calls the page took); Claude in weekly points of one account, from the Opus calls' list-price
equivalent x a points-per-list-dollar range (0.04 shelf-overview #6174 .. 0.2 this run's climits bound).
"""
import argparse, collections, json, os, random, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..', '..')
G = os.path.join(os.environ['JOB_SCRATCH'], 'g')
ENGINE = {'lite': ('gemini-3.1-flash-lite', 'gemini-lite'), 'f38l': ('gemini-3.8-flash+antigravity-cli', 'gemini-cli'),
          'opus': ('claude-opus-5-5', 'claude')}
STEM = {'lite': 'lite', 'f38l': 'pro', 'opus': 'opus'}
YEAR = {'6ade30b13326a0839b2d1c42': 1935, '6ade3ec29b50b5cefadcb4a4': 1337, '6ade3ec99b50b5cefadcb53d': 1550,
        '6ade3ecf9b50b5cefadcb5f2': 1650, '6ade4ab2fb322b4ac41da372': 1550, '6ade4ab9fb322b4ac41da485': 1819,
        '6ade4d049fdb4f8d74799000': None, '6ade4d099fdb4f8d747990d9': None, '6ade4d0d9fdb4f8d747991bb': 1925,
        '6ade4d119fdb4f8d74799227': 1925, '6ade4d149fdb4f8d7479923b': 1928, '6ade4d189fdb4f8d747992cd': 1924,
        '6ade4d1c9fdb4f8d7479936f': 1925, '6ade4d209fdb4f8d74799441': 1929}
ORDER = ('USABLE', 'NOTICEABLE', 'MISLEADING', 'FAILED')
PTS_PER_LIST_USD = (0.04, 0.2)


def period(y):
    if y is None:
        return 'unknown'
    return ('before 1500' if y < 1500 else '1500-1599' if y < 1600 else '1600-1699' if y < 1700 else
            '1700-1799' if y < 1800 else '1800-1899' if y < 1900 else '1900 on')


def rate_ci(flags, book, B=4000):
    """Share of pages flagged, 95% interval resampled by book."""
    by = collections.defaultdict(list)
    for u, f in flags.items():
        by[book[u]].append(f)
    W = list(by.values())
    f = lambda s: sum(sum(x) for x in s) / sum(len(x) for x in s)
    rng = random.Random(7341); bs = sorted(f([W[rng.randrange(len(W))] for _ in W]) for _ in range(B))
    return [round(f(W), 3), round(bs[int(0.025 * B)], 3), round(bs[int(0.975 * B) - 1], 3), sum(len(x) for x in W)]


def rows_of(path):
    return {r['uid']: r for r in map(json.loads, open(path))}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    picks = json.load(open(os.path.join(G, 'setB', 'draw.json')))['picks']
    book = {p['uid']: p['book_id'] for p in picks}; cell = {p['uid']: p['cell'] for p in picks}
    score = json.load(open(os.path.join(os.environ['JOB_SCRATCH'], 'score.json')))
    judge = json.load(open(os.path.join(G, 'judge', 'judge-scores.json')))
    keyo = json.load(open(os.path.join(G, 'setB', 'keys', 'key-o.json')))
    costs = json.load(open(os.path.join(ROOT, 'scripts', 'eval', 'estimator', 'ocr', 'route-costs.json')))
    agy_share = costs['quota_shares']['agy_share_per_call']
    lite_batch = next(r['usd_per_page'] for r in costs['routes'] if r['engine'] == 'gemini-3.1-flash-lite')
    raw = {arm: rows_of(os.path.join(G, 'setB', 'out', f'{s}.jsonl')) for arm, s in STEM.items()}
    import importlib.util, sys
    sys.path.insert(0, HERE)
    from score import letters

    # gate rows, estimator long-table shape
    out_rows = []
    for p in picks:
        u = p['uid']
        for arm, (eng, fam) in ENGINE.items():
            pp = score['per_page'].get(u, {})
            c = pp.get(f'{arm}|o|skel')
            g = judge['per_item'][f'{arm}|{u}']
            worse = max([v for v in g.values() if v] or ['FAILED'], key=ORDER.index)
            out_rows.append(dict(chart='arabic-manuscript' if p['cell'] == 'ar-ms' else 'arabic-print', panel='jabir-7341',
                                 page=f'jabir-7341|{u}', work=f'book:{p["book_id"]}', engine=eng, engine_family=fam,
                                 kind='manuscript' if p['cell'] == 'ar-ms' else 'print', period=period(YEAR[p['book_id']]),
                                 year=YEAR[p['book_id']], cer=c, scored=c is not None, failure=None if c is not None else 'did_not_read',
                                 n_ref=len(letters(keyo[u], 'skel')), n_ref_source='model-key-o (Opus referee; DIRECTIONAL)',
                                 cer_marks=pp.get(f'{arm}|o|marks'), cer_key_g=pp.get(f'{arm}|g|skel'),
                                 usability_claude=g.get('claude'), usability_gemini=g.get('gemini'), usability_worse=worse,
                                 leaf=p['leaf'], source='gate-7341', script='Arab', language='ar'))
    with open(os.path.join(a.out, 'gate-rows.jsonl'), 'w') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in out_rows)

    # usability + failed rates, by book
    summ = {'usable_definition': 'stricter judge: USABLE or NOTICEABLE', 'cells': {}}
    for c in ('ar-ms', 'ar-print'):
        uids = [u for u in book if cell[u] == c]
        S = {}
        for arm in ENGINE:
            for fam in ('claude', 'gemini', 'worse'):
                v = {}
                for u in uids:
                    g = judge['per_item'][f'{arm}|{u}']
                    v[u] = max([x for x in g.values() if x] or ['FAILED'], key=ORDER.index) if fam == 'worse' else (g.get(fam) or 'unparsed')
                S[f'{arm}|{fam}'] = {
                    'usable': rate_ci({u: int(v[u] in ('USABLE', 'NOTICEABLE')) for u in uids}, book),
                    'strict_usable': rate_ci({u: int(v[u] == 'USABLE') for u in uids}, book),
                    'misleading': rate_ci({u: int(v[u] == 'MISLEADING') for u in uids}, book),
                    'failed': rate_ci({u: int(v[u] == 'FAILED') for u in uids}, book)}
        summ['cells'][c] = S

    # cost per page and per usable page, per route
    n_pages = {'ar-ms': 2834 - 582, 'ar-print': 582}
    opus_list = [r.get('cost_usd_equiv') or 0 for r in raw['opus'].values()]
    opus_pts = [sum(opus_list) / len(opus_list) * k for k in PTS_PER_LIST_USD]
    agy_calls = sum(r.get('attempts') or 1 for r in raw['f38l'].values()) / len(raw['f38l'])
    lite_rt = sum(r.get('costUsd') or 0 for r in raw['lite'].values()) / len(raw['lite'])
    cost = {'lite_usd_per_page_batch': lite_batch, 'lite_usd_per_page_realtime_paid': round(lite_rt, 5),
            'lite_usd_paid_total': round(sum(r.get('costUsd') or 0 for r in raw['lite'].values()), 4),
            'agy_calls_per_page': round(agy_calls, 2), 'agy_month_share_per_page': agy_share * agy_calls,
            'opus_list_usd_equiv_per_page': round(sum(opus_list) / len(opus_list), 4),
            'opus_weekly_points_per_page': [round(x, 4) for x in opus_pts], 'points_per_list_usd_range': PTS_PER_LIST_USD}
    routes = {}
    for c in ('ar-ms', 'ar-print'):
        P = {arm: summ['cells'][c][f'{arm}|worse']['usable'][0] for arm in ENGINE}
        N = n_pages[c]
        routes[c] = {
            'opus_alone': {'P_usable': P['opus'], 'weekly_points_per_page': cost['opus_weekly_points_per_page'],
                           'weekly_points_per_usable_page': [round(x / max(P['opus'], 1e-9), 4) for x in opus_pts],
                           'weekly_points_all_pages': [round(x * N, 1) for x in opus_pts]},
            'lite_alone': {'P_usable': P['lite'], 'usd_per_page': lite_batch, 'usd_per_usable_page': round(lite_batch / max(P['lite'], 1e-9), 5),
                           'usd_all_pages': round(lite_batch * N, 2)},
            'agy_alone': {'P_usable': P['f38l'], 'agy_month_share_per_usable_page': agy_share * agy_calls / max(P['f38l'], 1e-9),
                          'agy_month_share_all_pages': round(agy_share * agy_calls * N, 4)},
            # cost = call / P(usable) + P(not) x next route (Opus), the brief's formula
            'lite_then_opus': {'usd': round(lite_batch / max(P['lite'], 1e-9), 5), 'weekly_points': [round((1 - P['lite']) * x, 4) for x in opus_pts]},
            'agy_then_opus': {'agy_month_share': agy_share * agy_calls / max(P['f38l'], 1e-9), 'weekly_points': [round((1 - P['f38l']) * x, 4) for x in opus_pts]},
            'pages': N}
    summ['cost'] = cost; summ['routes'] = routes
    summ['judges'] = {'agreement': judge['agreement'], 'plants': {f: {k: v for k, v in d.items() if k != 'pages'} for f, d in judge['plants'].items()},
                      'unparsed': judge['unparsed']}
    json.dump(summ, open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)

    # text-free artefacts
    d = json.load(open(os.path.join(os.environ['JOB_SCRATCH'], 'draw.json')))
    for p in d['pages']:
        p['image'] = os.path.relpath(p['image'], os.environ['JOB_SCRATCH'])
    json.dump(d, open(os.path.join(a.out, 'draw.json'), 'w'), indent=1)
    sc = {k: v for k, v in score.items()}
    json.dump(sc, open(os.path.join(a.out, 'cer-scores.json'), 'w'), indent=1)
    json.dump({k: v for k, v in judge.items() if k != 'plants'} | {'plants': {f: {k: v for k, v in x.items()} for f, x in judge['plants'].items()}},
              open(os.path.join(a.out, 'judge-scores.json'), 'w'), indent=1)
    shutil.copyfile(os.path.join(os.environ['JOB_SCRATCH'], 'gk', 'setB', 'keys', 'keys-report.json'), os.path.join(a.out, 'keys-report.json'))
    shutil.copyfile(os.path.join(os.environ['JOB_SCRATCH'], 'anchor', 'anchor-score.json'), os.path.join(a.out, 'anchor-score.json'))
    shutil.copyfile(os.path.join(os.environ['JOB_SCRATCH'], 'gk', 'second-reader.json') if os.path.exists(os.path.join(os.environ['JOB_SCRATCH'], 'gk', 'second-reader.json')) else os.path.join(os.environ['JOB_SCRATCH'], 'gk', 'setB', 'second-reader.json'), os.path.join(a.out, 'key-second-reader.json'))
    print(json.dumps({k: v for k, v in summ.items() if k != 'cells'}, indent=1))
    for c, S in summ['cells'].items():
        print('\n##', c)
        for k, v in S.items():
            print(k, {m: v[m] for m in ('usable', 'strict_usable', 'misleading', 'failed')})


if __name__ == '__main__':
    main()
