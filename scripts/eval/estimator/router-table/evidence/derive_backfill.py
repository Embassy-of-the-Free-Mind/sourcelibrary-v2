#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `score` (writes the route-judge score.json this mirrors; it scores
# its own verdict files, not #7568's three-arm Step T rows) and scripts/eval/flash-reread-5924/w-score.mjs (unblinds
# Step T and applies #7568's bars, but writes no per-route accept / wrong-text counts). Neither turns an existing
# result into router-table evidence; this does, from the stored verdict files only. No model calls.
"""Router-table evidence from judged tests that were never ingested (#7263, job router-backfill-7263, 2026-10-28).

  python3 scripts/eval/estimator/router-table/evidence/derive_backfill.py   (repo root)

Writes, beside this file, route-judge-format score.json files (cells -> routes -> accept, wrong_text_pages, books,
classes_k_of_n), the schema build.py's `evidence` entries read:

- correct-vs-reread-7568.score.json, from scripts/eval/flash-reread-5924/results-7568/<lang>/step-t.json (#7568 waves
  1 and 2: one blind Opus reader per book, each of the three texts judged against the page image as misleading /
  flawed / sound). Mapping onto route-judge: wrong text = misleading (a meaning change, an omitted passage, or another
  leaf's text: route-judge's `wrong_text` severity); accept = not misleading. In these files every misleading verdict
  carries a material defect and every not_this_leaf is misleading, so the two cuts are the same pages. 25 pages a book:
  build.py scales each source's pages by its books / pages.
- fresh-7517.score.json, from scripts/eval/route-judge-6740/results/fresh-7517-2026-10-27/{score,fresh-gate}.json
  (#7517, the route-judge itself). Its score.json counts only delivered reads (16/18 German); the experiment's rule,
  kept here, counts a read Gemini's filter cut as not accepted, because it is never written: 16/30.
"""
import collections, json, os

D = 'scripts/eval/estimator/router-table/evidence/'
SRC = 'scripts/eval/flash-reread-5924/results-7568/'
LANGS = {'zh': ('Chinese', 'wave 1'), 'de': ('German', 'wave 1'), 'el': ('Greek', 'wave 1'), 'sa': ('Sanskrit', 'wave 2'), 'ar': ('Arabic', 'wave 2')}
ROUTES = {'L': ('lite', 'served (the stored Flash-Lite text)'),
          'C': ('lite>opus-correct', 'correct.mjs --model=opus --per-call=10 over the lite text; the lite text where unchanged / contain / no-answer'),
          'R': ('agy-flash-low-read', 'cli-ocr.mjs read, agy gemini-3.8-flash-low, one page a call, no draft (a filter-cut reply judged as returned)')}
frac = lambda k, n: f'{k}/{n}'


def route_7568(rows, arm):
    n = len(rows)
    mis = [r for r in rows if r['V'][arm] == 'misleading' or r['ntl'][arm]]
    cls, wcls = collections.Counter(), collections.Counter()
    for r in rows:
        for c in {d['class'] for d in r['defects'][arm] if d.get('class')}: cls[c] += 1
    for r in mis:
        for c in {d['class'] for d in r['defects'][arm] if d.get('class') and d.get('material')}: wcls[c] += 1
    books = len({r['slug'].rsplit('-p', 1)[0] for r in rows})
    v = collections.Counter(r['V'][arm] for r in rows)
    return dict(served=ROUTES[arm][1], n=n, books=books, accept=frac(n - len(mis), n), wrong_text_pages=frac(len(mis), n),
                verdicts={k: v.get(k, 0) for k in ('sound', 'flawed', 'misleading')},
                wrong_text_classes={c: frac(k, n) for c, k in wcls.most_common()}, classes_k_of_n={c: frac(k, n) for c, k in cls.most_common()},
                not_this_leaf=frac(sum(r['ntl'][arm] for r in rows), n),
                **({'filter_cut': frac(sum(bool(r.get('R_filter_cut')) for r in rows), n)} if arm == 'R' else {}),
                **({'C_outcomes': dict(collections.Counter(r['C_outcome'] for r in rows))} if arm == 'C' else {}))


def main():
    cells = {}
    for lang, (name, wave) in LANGS.items():
        rows = json.load(open(f'{SRC}{lang}/step-t.json'))
        cells[f'{lang}-lite'] = dict(task='ocr', lang=name, wave=wave, pages=len(rows), source=f'{SRC}{lang}/step-t.json',
                                     routes={ROUTES[a][0]: route_7568(rows, a) for a in 'LCR'})
    json.dump(dict(generated_by=D + 'derive_backfill.py (2026-10-28, #7263; no model calls)',
                   provenance=('#7568 waves 1-2 (PR #7571), scripts/eval/flash-reread-5924/results-7568/<lang>/step-t.json, unblinded by w-score.mjs; '
                               'judge: claude-opus-5-5 (claude -p), one blind reader per book, three texts per page against the page image (T-TASK.md)'),
                   judge='claude-opus-5-5, Step T reader (T-TASK.md): misleading / flawed / sound against the image; not the route-judge prompt',
                   mapping='wrong_text = misleading (meaning change, omitted passage, another leaf); accept = not misleading',
                   cells=cells), open(D + 'correct-vs-reread-7568.score.json', 'w'), indent=1, ensure_ascii=False)

    F = 'scripts/eval/route-judge-6740/results/fresh-7517-2026-10-27/'
    sc, gate = json.load(open(F + 'score.json')), json.load(open(F + 'fresh-gate.json'))
    out = {}
    for cell in ('de-lite', 'fr-lite'):
        g, r = gate['cells'][cell]['routes']['fresh'], sc['cells'][cell]['routes']['agy-flash-low']
        n, cut = g['n'], g['not_delivered']
        relabel = lambda m: {c: frac(int(v.split('/')[0]), n) for c, v in m.items()}
        out[cell] = dict(task='ocr', lang=sc['cells'][cell]['lang'], routes={'agy-flash-low-read': dict(
            served=r['served'], n=n, books=n, accept=frac(g['k'], n), wrong_text_pages=frac(g['w'], n),
            delivered=frac(g['delivered'], n), filter_cut=frac(cut, n),
            wrong_text_classes=relabel(r['wrong_text_classes']), classes_k_of_n=dict(relabel(r['classes_k_of_n']), filter_cut=frac(cut, n)))})
    json.dump(dict(generated_by=D + 'derive_backfill.py (2026-10-28, #7263; no model calls)',
                   provenance=(f'#7517 (PR #7520), {F}score.json (verdicts, delivered reads) + fresh-gate.json (k / n with filter-cut reads counted '
                               'not accepted, the experiment\'s rule); the lite and lite>agy-flash-low rows on the same pages are the router tests\' '
                               '(already in rules.json) and are not repeated here'),
                   judge=sc['judge'] + ' (the route-judge prompt)', cells=out), open(D + 'fresh-7517.score.json', 'w'), indent=1, ensure_ascii=False)
    for f in ('correct-vs-reread-7568.score.json', 'fresh-7517.score.json'):
        for c, v in json.load(open(D + f))['cells'].items():
            print(f, c, {k: (x['accept'], x['wrong_text_pages'], x['books']) for k, x in v['routes'].items()})


if __name__ == '__main__':
    main()
