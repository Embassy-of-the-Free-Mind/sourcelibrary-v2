#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill_all.py — writes the router's evidence
# score.json files from per-page verdicts, but pooled over script type. This re-cuts evidence_pages.py's per-page rows
# (classified by classify-evidence.mjs) into one score.json per source with a cell per script type, the same fields
# build.py reads.
"""Evidence by script type (#7263, Derek inbox 2026-10-28 11:54Z). Stdlib only.

  python3 scripts/eval/router-next-7263/split_evidence.py <evidence-pages-script.jsonl> <rules.json>   (repo root)

Writes scripts/eval/estimator/router-table/evidence/by-script/<source>.score.json: for every (cell, route) of a source
score.json that the router uses, cells `<cell>|print`, `<cell>|manuscript`, `<cell>|unknown`, each route with accept,
wrong_text_pages, books, classes_k_of_n and (zh-dice) name_check, from the judged pages of that script type. books: the
source's own count when one script holds every row, else the distinct books among the split's rows scaled by the
source's books / its distinct books (Tengyur and Arabic count volumes and works, not book ids). Checks first that the
rows, unsplit, give back every source entry, and prints the split per router cell.
"""
import collections, json, os, sys

OUT = 'scripts/eval/estimator/router-table/evidence/by-script/'
SCRIPTS = ('print', 'manuscript', 'unknown')


def agg(rs, orig_books, all_books):
    n = len(rs); k = sum(r['accept'] for r in rs); w = sum(r['wrong_text'] for r in rs)
    cl = collections.Counter(c for r in rs for c in set(r['classes']))
    bk = len({r['book_id'] for r in rs})
    books = orig_books if bk == all_books else max(1, round(bk * orig_books / max(1, all_books))) if n else 0
    d = dict(n=n, books=books, accept=f'{k}/{n}', wrong_text_pages=f'{w}/{n}', classes_k_of_n={c: f'{v}/{n}' for c, v in cl.items()})
    d['name_check'] = dict(accept_after_name_check=f"{sum(r.get('name_check_accept') is True for r in rs)}/{n}",
                         with_name_error=sum(r['accept'] and r.get('name_check_accept') is False for r in rs))
    return d


def main():
    rows = [json.loads(l) for l in open(sys.argv[1])]
    P = json.load(open(sys.argv[2]))
    used = collections.defaultdict(set)  # (score, cell, route) -> router cell/route
    for c in P['cells']:
        for r in c['routes']:
            if r.get('pilot'): used[(P['inputs']['pilot'], c['pilot'], r['pilot'])].add(f"{c['id']}/{r['id']}")
            for e in r.get('evidence', []): used[(e['score'], e['cell'], e['route'])].add(f"{c['id']}/{r['id']}")
    by = collections.defaultdict(list)
    for r in rows: by[(r['score'], r['cell'], r['route'])].append(r)
    os.makedirs(OUT, exist_ok=True)
    files = collections.defaultdict(lambda: dict(cells={}))
    bad = 0
    for key in sorted(used):
        score, cell, route = key; rs = by[key]; src = json.load(open(score))['cells'][cell]['routes'][route]
        allb = len({r['book_id'] for r in rs}); whole = agg(rs, src['books'], allb)
        nc = src.get('name_check')
        if not nc: whole.pop('name_check')
        ok = whole['accept'] == src['accept'] and whole['wrong_text_pages'] == src['wrong_text_pages'] and whole['books'] == src['books'] and \
            (not nc or (whole.get('name_check', {}).get('accept_after_name_check') == nc['accept_after_name_check'] and whole['name_check']['with_name_error'] == nc['with_name_error']))
        if not ok: bad += 1; print('MISMATCH', key, whole, {k: src.get(k) for k in ('accept', 'wrong_text_pages', 'books')}, nc and {k: nc.get(k) for k in ('accept_after_name_check', 'with_name_error')})
        f = files[score]; f['source'] = score
        for s in SCRIPTS:
            sub = [r for r in rs if r['script'] == s]
            if not sub: continue
            d = agg(sub, src['books'], allb)
            if not nc: d.pop('name_check', None)
            d['script_basis'] = dict(collections.Counter(r['script_basis'] for r in sub))
            f['cells'].setdefault(f'{cell}|{s}', dict(routes={}))['routes'][route] = d
    if bad: sys.exit(f'{bad} source entries do not reconcile')
    for score, f in files.items():
        f['generated_by'] = 'scripts/eval/router-next-7263/split_evidence.py (#7263 router-next; per-page rows: evidence_pages.py, script type: classify-evidence.mjs)'
        json.dump(f, open(by_script_path(score), 'w'), indent=1, ensure_ascii=False)
    # the split per router cell/route
    t = collections.defaultdict(collections.Counter)
    for key, crs in used.items():
        for cr in crs:
            for r in by[key]: t[cr][r['script']] += 1
    for cr in sorted(t): print(cr, dict(t[cr]))


def by_script_path(score):
    b = os.path.basename(score)
    return OUT + (os.path.basename(os.path.dirname(score)) + '--' + b if b == 'score.json' else b)


if __name__ == '__main__':
    main()
