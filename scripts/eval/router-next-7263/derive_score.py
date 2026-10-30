#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill_all.py (fresh-7517: judged items plus the reads
# that never arrived, as not accepted) — the same rule; its rows come from evidence_pages.py router_next_7263() here.
"""The router evidence file for the 2026-10-28 waiting-page tests (#7263 router-next). Stdlib only, repo root:
  python3 scripts/eval/router-next-7263/derive_score.py
Writes scripts/eval/estimator/router-table/evidence/router-next-7263.score.json (cells latin-lite, latin-flash3)."""
import collections, json, sys
sys.argv = sys.argv[:1]
sys.path.insert(0, 'scripts/eval/router-next-7263')
import evidence_pages as E

out = dict(generated_by='scripts/eval/router-next-7263/derive_score.py', source='scripts/eval/route-judge-6740/results/router-next-2026-10-28/ (judge.mjs, Opus, blind, image)',
           frame='waiting pages of the cell (census bucket), one page per book, books drawn with probability ~ read_count + 1, print only (scripts/eval/router-next-7263/draw.mjs)', cells={})
for (cell, route), rs in E.router_next_7263().items():
    n = len(rs); cl = collections.Counter(c for r in rs for c in set(r['classes']))
    out['cells'].setdefault(cell, dict(routes={}))['routes'][route] = dict(
        n=n, books=len({r['book_id'] for r in rs}), accept=f"{sum(r['accept'] for r in rs)}/{n}", wrong_text_pages=f"{sum(r['wrong_text'] for r in rs)}/{n}",
        classes_k_of_n={c: f'{v}/{n}' for c, v in cl.most_common()}, not_delivered=sum(bool(r.get('not_delivered')) for r in rs))
json.dump(out, open(E.EV + 'router-next-7263.score.json', 'w'), indent=1)
for c, x in out['cells'].items():
    for r, y in x['routes'].items(): print(c, r, y['accept'], y['wrong_text_pages'], y['books'], 'not delivered', y['not_delivered'])
