#!/usr/bin/env python3
"""report-6871a.py — the issue comment for #6871 row A (job grounding-6871a): the table and the verdict against
PREREGISTRATION-AMENDMENT-6871a.md, written by the gpu-queue task itself (the job that preregistered it had ended).

PRIOR ART: score-6871a.py writes the numbers; scripts/eval/zh-residue-bakeoff-6871 renders its own tables the same
way. Nothing here decides anything the amendment did not fix in advance.

  report-6871a.py <job dir>    reads new.json, real6420.json (if any), hold.log, code/COMMIT; prints markdown
"""
import json, os, re, sys

A = sys.argv[1]
rd = lambda f: json.load(open(os.path.join(A, f))) if os.path.exists(os.path.join(A, f)) else {}
new, old = rd('new.json').get('cells', {}), rd('real6420.json').get('cells', {})
commit = open(os.path.join(A, 'code/COMMIT')).read().strip()[:9] if os.path.exists(os.path.join(A, 'code/COMMIT')) else '?'
f2 = lambda x: '—' if x is None else f'{x:.2f}'
ci = lambda c: '' if not c else f' ({c[0]:.2f}–{c[1]:.2f})'


def row(name, m):
    if not m or 'auroc_gain' not in m:
        return f"| {name} | {m.get('pages', 0) if m else 0} | too few positives | | | | | | |"
    rg, rb, ri = (m.get(f'rp50_{k}') or {} for k in ('gain', 'base', 'inll'))
    nz = m.get('noise') or {}
    noise = f"{f2(nz.get('separation'))} vs 2×{f2(nz.get('median_abs_dgain'))}, rerun {f2(nz.get('auroc_rerun'))}" if nz else '—'
    passed = m['bar_auroc'] and m['bar_rp50'] and nz.get('beats_noise', False)
    return (f"| {name} | {m['pages']} ({m['pos_pages']}) | {m['pos_units']} / {m['units']} | **{f2(m['auroc_gain'])}**{ci(m.get('ci_gain'))} | {f2(m['auroc_base'])} | "
            f"**{f2(rg.get('R@P50'))}**{ci(m.get('rp50_gain_ci'))} | {f2(rb.get('R@P50'))} / {f2(ri.get('R@P50'))} | {noise} | "
            f"{'B1 ' + ('y' if m['bar_auroc'] else 'n') + ' · B2 ' + ('y' if m['bar_rp50'] else 'n') + ' · B3 ' + ('y' if nz.get('beats_noise') else 'n')} → **{'pass' if passed else 'fail'}** |"), passed


hdr = ('| cell | pages (with a bad span) | bad units / units | AUROC gain (95% CI) | AUROC text-only perplexity | R@P50 gain (CI) | R@P50 perplexity / image surprisal | repeat noise: separation vs 2×median abs Δgain | bar |\n'
       '|---|---|---|---|---|---|---|---|---|')
lines, passed = [], []
for title, cells, keys in (('Real errors, #6420 lane B (Opus-marked spans), full set', old, [k for k in old if k.startswith('real6420/')]),
                           ('Real errors, Chinese SKQS (differences from the Kanripo WYG text)', new, [k for k in new if k.startswith('skqs-real/') and 'kind:' not in k]),
                           ('Planted phrases (descriptive)', new, [k for k in new if k.startswith('plant-phrase/')]),
                           ('2026-10-18 plants (descriptive)', old, [k for k in old if k.startswith('plant-')])):
    if not keys: continue
    lines += [f'**{title}**', '', hdr]
    for k in keys:
        r = row(k.split('/', 1)[1], cells[k])
        if isinstance(r, tuple):
            pos_pages = cells[k].get('pos_pages', 0)
            gets_verdict = k.startswith('plant') or pos_pages >= 30 or k.endswith('/all') or 'skqs' in k
            lines.append(r[0] if gets_verdict else re.sub(r'→ \*\*\w+\*\* \|$', '→ no verdict (< 30 pages with a bad span) |', r[0]))
            if r[1] and gets_verdict and not k.startswith('plant'): passed.append(k)
        else:
            lines.append(r)
    lines.append('')

rate = []
if os.path.exists(os.path.join(A, 'hold.log')):
    for m in re.finditer(r'scored for (\d+) s: (\d+) rows in (\S+)', open(os.path.join(A, 'hold.log')).read()):
        s, n, f = int(m[1]), int(m[2]), os.path.basename(m[3])
        if s > 60: rate.append(f'{f}: {n} items in {s} s = {n * 3600 / s:,.0f} pp/h for the pair')

verdict = ('**Verdict: no cell clears the preregistered bar (B1 AUROC ≥ 0.75, B2 span recall ≥ 0.6 at precision ≥ 0.5, B3 beats repeat noise). '
           'No image-gain pre-screen in front of agy/Opus review on #6420: it neither replaces nor pre-filters a round.**') if not passed else (
           f"**Verdict: {', '.join(passed)} clear{'s' if len(passed) == 1 else ''} all three bars.** Per the amendment, gain pre-screens only "
           'that cell, at the R@P50 threshold; a person should read the numbers before anything is wired.')
print(f"""**#6871 row A, grounding check (job grounding-6871a): scored by its own gpu-queue task `55-grounding-6871a`.**
Prereg: `scripts/eval/grounding-6871/PREREGISTRATION-AMENDMENT-6871a.md` (on top of the 2026-10-18 `PREREGISTRATION.md`); code at {commit}.
Scorer: Qwen2.5-VL-7B-Instruct-AWQ, per-token log p(read | image) − log p(read | no image), teacher-forced. R@P50 = the best span recall at unit precision ≥ 0.5.

{verdict}

""" + '\n'.join(lines) + f"""
**Throughput (this card):** {'; '.join(rate) if rate else 'not in hold.log'}.

$0: no paid model, no rented GPU, nothing written to any store. Files: gex45 `{A}/` (`new.json`, `real6420.json`, `main.jsonl`, `rerun.jsonl`). The experiment file in the repo should be updated from these numbers by the next job that touches row A.""")
