#!/usr/bin/env python3
"""agy coverage map (#7263 route-free analyses, question 5). No model calls; reads committed files only.

PRIOR ART: scripts/eval/estimator/router-table/build.py — it pools each route's evidence into k/n but does not say,
per source, which judge scale it was read on or whether its pages were drawn at random; this script reads the LIVE
table (current.json, with its per-cell pointers) and rules.json's evidence lists and adds those two columns.

Per row of the live table: the agy route with the highest posterior mean, its pooled k/n and wrong-text pages, and per
evidence source the books, the judge scale (route judge / Step T / Step C / usability / cells / translation / A-B) and
the draw (random / clustered random / convenience / diagnostic / hand). No floor is applied (Derek 2026-11-04:
"unacceptable" is set from calibrated rates). Rows where wrong == n - k are named: there every page not accepted was
counted as wrong text, which is a mapping (Step T / usability scales), not a measured rate.

  python3 scripts/eval/route-free-7263/agy_map.py --out $JOB_SCRATCH/agy-map.json
"""
import json, os, sys, argparse

D = 'scripts/eval/estimator/router-table/'

# judge scale by score file (basename, or a path fragment); every file an agy route cites is listed
SCALE = {
    'correct-vs-reread-7568': 'Step T', 'latin-250-5924': 'Step C', 'arabic-mss-7341': 'usability (judge.py)',
    'arabic-kraus-7341': 'usability (judge.py)', 'cells-6553': 'cells (JUDGE-CELLS)', 'tengyur-6361': 'blind A/B',
    'siku-tr-6567': 'translation MQM', 'eu-agy-translate-7263': 'route judge (translation form)',
    'translation-router': 'route judge (translation form)', 'score-e2-7567': 'usability (7522 judge.mjs)',
    'score-test-7263': 'usability (7522 judge.mjs)',
}
# how the pages were drawn, from each source's frame / provenance / record
DRAW = {
    'router-tests-2026-10-26': 'random', 'router-tests-2026-10-28': 'random', 'pilot-2026-10-26': 'random',
    'confirm-frame': 'random', 'router-frame': 'random', 'router-v4-latin-lite-7263': 'random',
    'router-next-7263': 'random (PPS)', 'correction-pass-7818': 'random', 'lane-accept-7263': 'random',
    'fraktur-paired-7835': 'random (face-stratified)', 'queue-routes-7853': 'random (PPS)',
    'lane-judge-sampler': 'random (lane-written)', 'fresh-7517': 'random', 'first-read-7701': 'random',
    'read-surface-6740': 'random', 'read-surface-6740-de': 'random', 'read-surface-6740-de2': 'random',
    'cheap-routes-7701': 'random', 'german-cheaper-7701': 'random (face-stratified by eye)',
    'tibetan-30-2026-10-27': 'random', 'siku-tr-6567': 'random (pilot output)', 'eu-agy-translate-7263': 'random (visible books)',
    'cells-6553': 'random (live books)',
    'correct-vs-reread-7568': 'clustered (random books, 25 pages a book)', 'latin-250-5924': 'clustered (10 books, 25 pages a book)',
    'score-e2-7567': 'convenience (pages with a stored Opus correction)', 'score-test-7263': 'convenience (pages with a stored Opus correction)',
    'translation-router': 'diagnostic (pages earlier audits judged worse)', 'tengyur-6361': 'hand (5 seeded + 2 chosen volumes)',
    'arabic-mss-7341': 'hand (screened by eye)', 'arabic-kraus-7341': 'hand (one book)',
}


def key(path, table):
    for k in table:
        if k in path: return table[k]
    return None


def is_random(d): return bool(d) and d.startswith('random')


def _unique(T):
    seen = {}
    for r in T:
        for x in r['sources']:
            if x['accept']: seen[(r['id'].split('/')[0], r['best'], x['file'], x['accept'])] = (int(x['accept'].split('/')[1]), is_random(x['draw']), x['scale'])
    by_scale = {}
    for n, rnd, sc in seen.values(): by_scale.setdefault(sc, [0, 0]); by_scale[sc][0] += n * rnd; by_scale[sc][1] += n
    return dict(random_pages=sum(n for n, rnd, _ in seen.values() if rnd), all_pages=sum(n for n, _, _ in seen.values()),
                pages_by_scale_random_of_all=by_scale)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out'); a = ap.parse_args()
    cur = json.load(open(D + 'current.json')); rules = json.load(open(D + 'rules.json'))
    cells = {c['id']: c for c in rules['cells']}
    tables = {}
    def row_of(rid):
        t = cur['cells'].get(rid, {}).get('table', cur['table'])
        if t not in tables: tables[t] = {r['id']: r for r in json.load(open(D + t + '.json'))['rows']}
        return tables[t].get(rid), t
    base_tab = json.load(open(D + cur['table'] + '.json'))['rows']
    out, cache = [], {}
    for r0 in base_tab:
        row, t = row_of(r0['id'])
        row = row or r0
        cell = cells.get(row['base'], {})
        agy = [x for x in row['routes'] if 'agy' in x['id']]
        tested = [x for x in agy if x.get('n')]
        rec = dict(id=row['id'], table=t, pages_waiting=row.get('pages_waiting'), current=row.get('current'),
                   agy_routes=len(agy), tested=len(tested))
        if tested:
            b = max(tested, key=lambda x: x['mean'])
            rid = b['id']
            spec = next((x for x in cell.get('routes', []) if x['id'] == rid), {})
            srcs = []
            ev = list(spec.get('evidence', []))
            if spec.get('pilot'): ev = [dict(score=rules['inputs']['pilot'], cell=f"{cell['pilot']}", route=spec['pilot'])] + ev
            for e in ev:
                f = e['score']
                if f not in cache:
                    try: cache[f] = json.load(open(f))
                    except Exception: cache[f] = None
                s, books, kn = cache[f], None, None
                if s:
                    cs = s.get('cells', {})
                    c = cs.get(e['cell']) or next((v for k, v in cs.items() if k.startswith(e['cell'] + '|')), None)
                    rr = (c or {}).get('routes', {}).get(e['route']) if c else None
                    if rr: books, kn = rr.get('books'), rr.get('accept')
                srcs.append(dict(file=f.split('/')[-1] if 'evidence/' in f else '/'.join(f.split('/')[-3:]),
                                 scale=key(f, SCALE) or 'route judge', draw=key(f, DRAW) or 'unknown',
                                 books=books, accept=kn, weight=e.get('weight', 1)))
            scales = sorted({x['scale'] for x in srcs})
            rec.update(best=rid, k=b['k'], n=b['n'], wrong=b.get('wrong'), mean=round(b['mean'], 3),
                       ci90=[round(v, 3) for v in b['ci90']], wrong_eq_n_minus_k=(b.get('wrong') == b['n'] - b['k'] and b['n'] > b['k']),
                       sources=srcs, scales=scales, pooled_scales=len(scales) > 1,
                       random_pages=sum(int(x['accept'].split('/')[1]) for x in srcs if x['accept'] and is_random(x['draw'])),
                       all_pages=sum(int(x['accept'].split('/')[1]) for x in srcs if x['accept']),
                       books=sum(x['books'] or 0 for x in srcs))
        out.append(rec)
    T = [r for r in out if r.get('best')]
    summ = dict(rows=len(out), with_agy_evidence=len(T), without=len(out) - len(T),
                pages_waiting_without=sum(r['pages_waiting'] or 0 for r in out if not r.get('best')),
                pages_waiting_with=sum(r['pages_waiting'] or 0 for r in T),
                # script-split rows of one cell cite the same sources: count each (source, route) once
                **_unique(T),
                rows_all_random=sum(1 for r in T if r['all_pages'] and r['random_pages'] == r['all_pages']),
                rows_no_random=sum(1 for r in T if r['random_pages'] == 0),
                rows_pooled_scales=[r['id'] for r in T if r['pooled_scales']],
                rows_wrong_eq_n_minus_k=[r['id'] for r in T if r['wrong_eq_n_minus_k']])
    res = dict(summary=summ, rows=out)
    if a.out: json.dump(res, open(a.out, 'w'), indent=1)
    print(json.dumps(summ, indent=1))
    print('| row | pages waiting | best agy route | k/n | wrong | mean [90%] | books | scale | draw (random pages / all) |')
    for r in sorted(T, key=lambda r: -(r['pages_waiting'] or 0)):
        print(f"| {r['id']} | {r['pages_waiting'] or 0:,} | {r['best']} | {r['k']}/{r['n']} | {r['wrong']}{' (=n-k)' if r['wrong_eq_n_minus_k'] else ''} | {r['mean']} [{r['ci90'][0]}-{r['ci90'][1]}] | {r['books']} | {'; '.join(r['scales'])} | {r['random_pages']}/{r['all_pages']} |")
    print('\nno agy evidence:')
    for r in sorted([r for r in out if not r.get('best')], key=lambda r: -(r['pages_waiting'] or 0)):
        print(f"| {r['id']} | {r['pages_waiting'] or 0:,} | {r['current']} | agy routes listed {r['agy_routes']} |")


if __name__ == '__main__':
    main()
