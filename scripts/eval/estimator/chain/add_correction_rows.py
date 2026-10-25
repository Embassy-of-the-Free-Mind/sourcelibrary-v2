#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/failure-observations.jsonl (the curated k-of-n table failures_v0.py reads; its
# correction rows carry made_worse only, keyed by a route string and a script) and failures_v0.py itself. Estimator v2
# (#6740) keys a correction by draft engine x corrector x language x page kind and needs pages made BETTER and pages
# judged misleading beside pages made worse. This adds those rows to the same file, in the same row format, and tags
# the existing correction rows with the cell keys. No new format: extra keys only.
"""Add the correction evidence of #6694, #6561, #6667, #6560, #5924, #7263 and #6865 to failure-observations.jsonl.

  python3 scripts/eval/estimator/chain/add_correction_rows.py [--obs scripts/eval/estimator/ocr/failure-observations.jsonl]

Idempotent: a row whose (source, rate, route, judge, k, n) is already present is not added twice; tags are re-applied.

Keys added (failures_v0.py ignores keys it does not read):
  draft, corrector, language, kind, image    the cell (chain_v2.py); `corrector` "redo:<engine>" is a re-read that
                                            replaces the draft, "none" the draft as served
  instrument   mechanical | blind-judge | leaf-audit-tiles | leaf-audit-frame | by-eye
  experiment   the write-up the count is from (held out together in chain_v2.py's check)
  subset_of    a per-language split of a row already in the file: failures_v0.py skips it (no page counted twice);
               chain_v2.py uses it INSTEAD of the pooled row, which carries no `corrector`
  chain_only   a judge failures_v0.py has no catch-rate model for: failures_v0.py skips the row
  mix          a count over several cells (one pooled count, e.g. pages better over six languages): {language: share}
Rates added: made_better (judged or scored better than the draft), misleading (the served text misleads a reader on
the page, the #5924 reader rule). made_worse and not_of_leaf keep failures_v0.py's meaning.
"""
import argparse, json, os

EX = 'scripts/eval/experiments/'
F6694 = EX + '2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md'
F6561 = EX + '2026-10-12-paddle-zh-correct-vs-redo-6561.md'
F6667 = EX + '2026-10-13-sonnet-haiku-correct-vs-opus-6667.md'
FSIKU = EX + '2026-10-15-stale-siku-opus-correct-pilot-6561.md'
F6560 = EX + '2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md'
FFL38 = EX + '2026-10-13-tibetan-flash38-correct-6560.md'
FARG = EX + '2026-10-15-tibetan-gemini4-argon-correct-6560.md'
FG4L = EX + '2026-10-15-tibetan-g4l-pass-gate-6560.md'
FFLG = EX + '2026-10-15-tibetan-flash-pass-gate-6560.md'
FLO = EX + '2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md'
FLF = EX + '2026-10-24-latin-lite-flash-correct-four-arms-5924.md'
FLITE = EX + '2026-10-24-lite-corrects-gpu-drafts-7263.md'
FFLOR = 'issue #6865 comment 2026-10-24T00:38:02Z (job florentine-correct-6865)'

# existing route strings -> corrector
ROUTE_CORR = {
    'Opus corrects a specialist draft': 'opus-5.5',
    'Gemini 3.1 Pro corrects a specialist draft': 'agy-3.1-pro',
    'Gemini 3.8 Flash high corrects a specialist draft': 'agy-3.8-flash-high',
    'Gemini 3.8 Flash low corrects a specialist draft': 'agy-3.8-flash-low',
    'Opus re-reads from the image (replacing a specialist read)': 'redo:opus-5.5',
    'Gemini 3.1 Pro re-reads from the image (replacing a specialist read)': 'redo:agy-3.1-pro',
    'Sonnet corrects a specialist draft': 'sonnet-5.5',
    'Haiku corrects a specialist draft': 'haiku-4.5',
}
ZH_KIND = {'6561/6667 paddle zh set A (40 withheld table pages)': 'table',
           '6561/6667 paddle zh set B random (30 ordinary pages)': 'ordinary',
           '6561/6667 paddle zh set B disagree (30 pages, 29 scored)': 'disagree'}


def row(rate, route, corrector, draft, language, kind, judge, instrument, k, n, books, experiment, source, quote,
        file=None, image=True, **extra):
    script = {'latin': 'latin', 'tibetan': 'tibetan', 'chinese': 'chinese'}.get(language, language)
    r = dict(rate=rate, route=route, script=script, judge=judge, note=extra.pop('note', ''), source=source, k=k, n=n,
             unit='pages', books=books, one_page_per_book=(books == n), file=file or experiment, quote=quote,
             draft=draft, corrector=corrector, language=language, kind=kind, image=image, instrument=instrument,
             experiment=experiment)
    r.update(extra)
    return r


def new_rows():
    R = []
    # ---- #6694 q300 arm B, per language (subsets of the pooled 'q300 blind judge (all)' rows) ----
    by_lang = {'latin': (1, 3, 98), 'german': (0, 5, 32), 'greek': (0, 0, 20), 'chinese': (0, 1, 34),
               'arabic': (0, 0, 10), 'hebrew': (0, 0, 2)}
    # the judged pages are pages B CHANGED (196 of the 976; B changed 809 of 976). An unchanged page is neither better
    # nor worse, so n is scaled to all pages, n / CHANGED, as the #5924 and #6561 counts are (over every page drawn)
    CHANGED = 809 / 976
    for lang, (ko, kg, n0) in by_lang.items():
        n = round(n0 / CHANGED)
        for judge, k in (('opus', ko), ('gemini-3.8-flash-high', kg)):
            R.append(row('made_worse', 'Opus corrects stored text in place', 'opus-5.5', 'stored-mixed', lang,
                         'most-read', judge, 'blind-judge', k, n, max(1, n // 2), F6694,
                         '6694 q300 blind judge, by language', f'| {lang.title()} | ... | {judge}: B worse {k} / {n0} changed |', note=f'n = {n0} changed pages / (809 of 976 changed)',
                         subset_of='6694 q300 blind judge (all)'))
    mix = {l: v[2] / 196 for l, v in by_lang.items()}
    for judge, k in (('opus', 173), ('gemini-3.8-flash-high', 167)):
        R.append(row('made_better', 'Opus corrects stored text in place', 'opus-5.5', 'stored-mixed', 'mixed',
                     'most-read', judge, 'blind-judge', k, round(196 / CHANGED), 98, F6694, '6694 q300 blind judge (all)',
                     f'B "better than stored" on its changed pages: Opus 173 of 196, Gemini 167 of 196', mix=mix,
                     note='n = 196 changed pages / (809 of 976 changed)'))
    # ---- #6561 / #6667: pages made better, Paddle Chinese (mechanical CER vs the Kanripo leaf, > 0.5 pt) ----
    better = {'opus-5.5': (31, 12, 7, F6561), 'agy-3.1-pro': (14, 13, 6, F6561), 'agy-3.8-flash-high': (24, 10, 8, F6561),
              'redo:opus-5.5': (22, 12, 5, F6561), 'sonnet-5.5': (21, 9, 4, F6667), 'haiku-4.5': (1, 2, 3, F6667)}
    for corr, (a, b, c, f) in better.items():
        for kind, k, n in (('table', a, 40), ('ordinary', b, 30), ('disagree', c, 29)):
            R.append(row('made_better', f'{corr} on a Paddle draft', corr, 'paddleocr-vl', 'chinese', kind, 'mechanical',
                         'mechanical', k, n, n, f, f'6561/6667 paddle zh set {kind}', f'better / worse vs Paddle: {k} / ...'))
    # flash-lite as corrector (#7263): P2 is the production-shaped prompt; P1 and no-image are other correctors
    for corr, rows_ in (('flash-lite', [('table', 2, 32, 38), ('ordinary', 5, 14, 30)]),
                        ('flash-lite-p2', [('table', 1, 28, 40), ('ordinary', 5, 9, 30)]),
                        ('flash-lite-noimage', [('table', 2, 30, 40), ('ordinary', 4, 8, 30)])):
        for kind, kb, kw, n in rows_:
            for rate, k in (('made_better', kb), ('made_worse', kw)):
                R.append(row(rate, f'{corr} on a Paddle draft', corr, 'paddleocr-vl', 'chinese', kind, 'mechanical',
                             'mechanical', k, n, n, FLITE, '7263 lite corrects Paddle', f'better / worse (> 0.5 pt): {kb} / {kw} of {n}',
                             image=(corr != 'flash-lite-noimage')))
    # Siku stale pages (#6561 item 1): v1 prompt, v2 (+ keep the page's own forms), v2 held out
    for corr, kw, kb, n, src in (('opus-5.5', 9, 25, 60, 'siku v1 pilot+supplement'),
                                 ('opus-5.5+siku-v2', 4, 28, 60, 'siku v2 same 60 pages (rule written from them)'),
                                 ('opus-5.5+siku-v2', 5, 18, 40, 'siku v2 held-out draw')):
        for rate, k in (('made_worse', kw), ('made_better', kb)):
            R.append(row(rate, f'{corr} on a stale Siku Paddle page', corr, 'paddleocr-vl', 'chinese', 'siku-stale',
                         'mechanical', 'mechanical', k, n, n, FSIKU, src, f'| {src} | {n} | {kw} | ... | {kb} |',
                         in_sample_rule=(src.startswith('siku v2 same'))))
    # ---- Tibetan, Yigdzin drafts: folios better (mechanical identity vs Derge), and the new correctors ----
    for corr, k, f in (('opus-5.5', 23, F6560), ('agy-3.1-pro', 25, F6560), ('redo:opus-5.5', 3, F6560),
                       ('redo:agy-3.1-pro', 1, F6560), ('agy-3.8-flash-low', 30, FFL38), ('agy-3.8-flash-high', 23, FFL38),
                       ('sonnet-5.5', 1, F6667), ('haiku-4.5', 22, F6667)):
        R.append(row('made_better', f'{corr} on a Yigdzin draft', corr, 'yigdzin', 'tibetan', 'kangyur', 'mechanical',
                     'mechanical', k, 30, 30, f, '6560 tibetan folios better', f'folios better / worse: {k} / ...'))
    for rate, k in (('made_worse', 3), ('made_better', 26)):
        R.append(row(rate, 'agy-gemini-4-argon-low on a Yigdzin draft', 'agy-gemini-4-argon-low', 'yigdzin', 'tibetan',
                     'kangyur', 'mechanical', 'mechanical', k, 30, 30, FARG, '6560 G4 Argon low 30 folios',
                     '| **G4 Argon low correct** | ... | **26 / 3** |'))
    for corr, kb, kw, n in (('flash-lite', 26, 2, 30), ('flash-lite-p2', 26, 0, 29), ('flash-lite-noimage', 27, 0, 30)):
        for rate, k in (('made_better', kb), ('made_worse', kw)):
            R.append(row(rate, f'{corr} on a Yigdzin draft', corr, 'yigdzin', 'tibetan', 'kangyur', 'mechanical',
                         'mechanical', k, n, n, FLITE, '7263 lite corrects Yigdzin', f'folios better / worse {kb} / {kw}',
                         image=(corr != 'flash-lite-noimage')))
    for corr, n in (('flash-lite', 30), ('flash-lite-p2', 29)):
        R.append(row('not_of_leaf', f'{corr} on a Yigdzin draft', corr, 'yigdzin', 'tibetan', 'kangyur', 'by-eye',
                     'by-eye', 1, n, n, FLITE, '7263 lite Tibetan invented/duplicated lines',
                     'with each prompt one folio in 30 gets whole lines invented or duplicated (by eye)', chain_only=True))
    # the 435-page gate volume (one volume: books = 1), 40 audited changed pages, Opus span audit against the leaf
    for corr, f, wb, bb, wa, ba in (('agy-3.8-flash-low', FFLG, 10, 24, 2, 22), ('agy-gemini-4-argon-low', FG4L, 5, 29, 0, 25)):
        for inst, kw, kb in (('leaf-audit-tiles', wb, bb), ('leaf-audit-frame', wa, ba)):
            for rate, k in (('made_worse', kw), ('made_better', kb)):
                R.append(row(rate, f'{corr} correction pass, gate volume', corr, 'yigdzin', 'tibetan', 'kangyur', 'opus',
                             inst, k, 40, 1, f, f'6560 pass gate {inst}', f'worse / same / better (of 40): {kw} / ... / {kb}',
                             chain_only=True))
    # ---- Latin print, flash-lite drafts (#5924, 250 pages = 10 books x 25) ----
    lat = dict(draft='flash-lite', language='latin', kind='print')
    R.append(row('misleading', 'lite text as served', 'none', judge='opus', instrument='blind-judge', k=111, n=250,
                 books=10, experiment=FLO, source='5924 Step C2 lite', quote='| lite (L), Step C2 | **111** |', **lat))
    for rate, k in (('misleading', 31), ('made_worse', 1), ('made_better', 201)):
        R.append(row(rate, 'Opus corrects the lite text (correct.mjs, 10 pages a call)', 'opus-5.5', judge='opus',
                     instrument='blind-judge', k=k, n=250, books=10, experiment=FLO, source='5924 Opus correction C2',
                     quote='| **Opus correction (O), Step C2** | **31** | **1** | **O 201 · L 2 · tie 47** |', **lat))
    for rate, k in (('made_worse', 3), ('made_better', 56)):
        R.append(row(rate, 'Opus corrects the lite text (correct.mjs, 10 pages a call)', 'opus-5.5',
                     judge='gemini-3.8-flash-low', instrument='blind-judge', k=k, n=59, books=10, experiment=FLF,
                     source='5924 second-family judge on O vs L', quote='| Gemini 3.8 Flash-low | 56 | 3 | 0 | 0 | 27 |',
                     chain_only=True, **lat))
    for rate, k in (('misleading', 30), ('made_worse', 11), ('made_better', 210)):
        R.append(row(rate, 'agy Flash low corrects the lite text', 'agy-3.8-flash-low', judge='opus',
                     instrument='blind-judge', k=k, n=250, books=10, experiment=FLF, source='5924 Flash correction C4',
                     quote='| **Flash correction (FC)** | **30** (8.5–16.6%) | **11** | FC 210 · L 11 · tie 29 |', **lat))
    for rate, k in (('misleading', 20), ('made_worse', 7), ('made_better', 201)):
        R.append(row(rate, 'agy Flash low re-reads the page (replaces the lite text)', 'redo:agy-3.8-flash-low',
                     judge='opus', instrument='blind-judge', k=k, n=250, books=10, experiment=FLO,
                     source='5924 Flash re-read Step C', quote='| Flash re-read (F), original Step C | 20 (5–12%) | **7** | F 201 · L 23 · tie 26 |',
                     **lat))
    # ---- Florentine Codex (#6865): lite drafts of a two-column Spanish/Nahuatl manuscript, Opus correction ----
    fl = dict(draft='flash-lite', language='nahuatl-spanish', kind='manuscript-two-column')
    for rate, k in (('made_better', 30), ('made_worse', 0)):
        R.append(row(rate, 'Opus corrects the lite text (correct.mjs, 10 pages a call)', 'opus-5.5', judge='opus',
                     instrument='blind-judge', k=k, n=30, books=1, experiment=FFLOR, source='6865 fl-correct-v3 gate',
                     quote='| sample | **30 better / 0 same / 0 worse** | 0 worse |', file=FFLOR, **fl))
    R.append(row('made_better', 'Opus corrects the lite text (correct.mjs, 10 pages a call)', 'opus-5.5', judge='mechanical',
                 instrument='mechanical', k=2, n=2, books=1, experiment=FFLOR, source='6865 Getty CER pages',
                 quote='Getty CER, Nahuatl (p.645, p.971) lite 0.571 → corrected 0.069', file=FFLOR, **fl))
    return R


def tag(r):
    """Cell keys for a correction row that is already in the file."""
    corr = ROUTE_CORR.get(r['route'])
    if corr is None or r['rate'] != 'made_worse':
        return r
    if r['script'] == 'tibetan':
        exp = F6667 if corr in ('sonnet-5.5', 'haiku-4.5') else r['file'] if r['file'].startswith(EX) else F6560
        r.update(draft='yigdzin', corrector=corr, language='tibetan', kind='kangyur', image=True,
                 instrument='mechanical', experiment=exp)
    elif r['script'] == 'chinese' and r['source'] in ZH_KIND:
        r.update(draft='paddleocr-vl', corrector=corr, language='chinese', kind=ZH_KIND[r['source']], image=True,
                 instrument='mechanical', experiment=r['file'])
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--obs', default='scripts/eval/estimator/ocr/failure-observations.jsonl')
    a = ap.parse_args()
    lines = open(a.obs).read().splitlines()
    head, raw = lines[0], [l for l in lines[1:] if l.strip()]
    rows = [tag(json.loads(l)) for l in raw]
    # a row tagging left unchanged is written back byte for byte
    text = [l if json.loads(l) == r else json.dumps(r) for l, r in zip(raw, rows)]
    key = lambda r: (r['source'], r['rate'], r['route'], r['judge'], r['k'], r['n'], r.get('instrument'))
    have = {key(r) for r in rows}
    added = [r for r in new_rows() if key(r) not in have]
    with open(a.obs + '.tmp', 'w') as f:
        f.write(head + '\n' + ''.join(t + '\n' for t in text + [json.dumps(r) for r in added]))
    os.replace(a.obs + '.tmp', a.obs)
    rows += added
    print(f'{a.obs}: {len(rows)} rows ({len(added)} added, {sum("corrector" in r for r in rows)} with a cell)')


if __name__ == '__main__':
    main()
