---
stage: translation
measure: [judged]
languages: [la, grc, de, zh, fr, it, nl, bo]
scripts: [Latn, Grek, Hani, Tibt]
canons: []
n_books: 1218
n_pages: 13534
status: informational
feeds: [detector]
superseded_by: null
router_evidence: "none — deterministic checks on stored text, no route compared"
defect_rates: "none — measures detectors against stored audit labels"
verdict: "Five free checks on a page's OCR and English together, scored on the error zoo's fresh specimens and on 921 clean random audit pages, thresholds fixed before the run, held-out half of books reported. None is precise enough to be a write-time guard: the best, hedging words in notes, finds 45% of T10 pages with 6.5% false flags (precision 0.24 at the random rate), and only 14% of the quoted T10 errors contain the hedge. Numbers in the English the source does not carry: 37% of O7 pages, 10% false flags, precision 0.10. A negation-count check is at chance (AUC 0.50), and even with perfect sentence alignment it could see at most 31% of T8 specimens, because 54% have no negation on either side. English over an <unclear> span: 7% of T7 pages. Sentence-count shortfall: chance for T9 and O5."
decision: "No guard ships. As predictor features, the eight pair scores do not lift the general audit targets (English-critical AUC 0.750 → 0.755, book bootstrap CI [−0.004, +0.014]), but they do lift a T10-specific score (0.733 → 0.787, CI [+0.023, +0.088]); kept for aiming a T10 check, not added to the weekly risk pool. Negation count and sentence shortfall are dropped. T8 and most of T10 need prevention (prompt rules) or a source-grounded reader, so they come back as DECISIONs on v2#8632."
---

PRIOR ART: `2026-11-12-is-serious-predictable-6420.md` (English-critical is not predictable from the English alone; this
tests the OCR↔English pair); `scripts/lib/correction-diff-guard.mjs` (the negation lexicons, reused);
`scripts/lib/illegible-source-gate.mjs` (contract (c), English over `<unclear>`, measured here for the first time).

## 2026-11-12 · Do the free checks generalise? (#8632, vision note Part 4, suite 1)

Code: `scripts/lib/ocr-english-checks.mjs` (the checks), `scripts/eval/error-zoo/detector-suite.mjs` (the suite),
`scripts/eval/error-zoo/detector-suite-peek.mjs` (what a check fires on, one half of the books at a time). Result:
`scripts/eval/error-zoo/detector-suite-2026-11-12.json`. Inputs: `/root/jobs/error-zoo-v2/union/{labels,pages}.jsonl`
on gex45-1 (labels.mjs + fetch-pages.mjs, 2026-11-12). No Mongo, no model, no spend.

**Frame.**
- **Positives.** Pages with a serious finding of the class, from any store. The label must be fresh, i.e. the text is
  unchanged since it was judged.
- **Negatives.** The weekly audit's random served stratum, with no serious finding of any class and a fresh label:
  921 pages.
- **Precision.** Taken at the class's rate in that random stratum.
- **Thresholds.** Fixed in the script before the first run.
- **One fix round, on half A only.** After run 1 I read the number check's false flags on half A, the books with even
  id parity, and fixed three things:
  - dotted Roman dates (M.D.LXXXIII);
  - Hebrew letter numerals;
  - chapter:verse references inside notes ("Genesis 9:27" on a Targum page).

  Half B is the held-out read. The other checks were not changed.

**Results.** All rows below are half B, the held-out half, with 95% Wilson intervals. Half A agrees within those
intervals on every row.

| check | class | pages | recall | false flags on clean | precision at random rate | AUC |
|---|---|---|---|---|---|---|
| hedging word in a note | T10 | 341 | 0.45 [0.39, 0.50] | 0.065 [0.045, 0.092] | 0.24 | 0.69 |
| hedge, or a number in a note the source lacks | T10 | 341 | 0.54 | 0.16 | 0.14 | 0.69 |
| number in the English the source lacks | O7 | 283 | 0.37 [0.31, 0.43] | 0.10 [0.08, 0.14] | 0.10 | 0.64 |
| same, notes included | O7 | 283 | 0.48 | 0.21 | 0.07 | 0.65 |
| English over an `<unclear>` span | T7 | 488 | 0.07 [0.05, 0.09] | 0.014 | 0.28 (A: 0.51) | 0.53 |
| sentence-count shortfall vs language median | T9 | 110 | 0.29 | 0.18 | 0.03 | 0.55 |
| same | O5 | 137 | 0.24 | 0.18 | 0.05 | 0.50 |
| source negations minus English negations ≥ 2 | T8 | 244 | 0.12 | 0.10 | 0.06 | 0.50 |

**Span level: does the quoted error itself carry the signal?** Only the weekly audit's findings quote spans; the book
check findings do not.

| class | specimens with a quoted bad span | what the span carries |
|---|---|---|
| T10 | 118 | in a note: 106; contains a hedge: 16 (14%) |
| O7 | 135 | contains a digit: 82 (61%) |
| T8 | 170 scored | English has fewer negations: 28; more: 25 (31% in all); same nonzero count: 25; no negation on either side: 92 (54%) |

**What this says about generalising.**
1. **These checks mark risky pages, not errors.** A translator that hedges in its notes, or adds numbers, tends to
   make T10 and O7 errors elsewhere on the page. The errors themselves mostly do not carry the tell. So dropping
   hedged notes at write time, the fix the taxonomy proposes for T10, would remove at most 14% of the quoted T10
   errors. T10 errors are confident notes.
2. **A negation check cannot be T8's fix.** At page level it is at chance. Even a perfectly aligned sentence-level
   check could see at most 31% of specimens, and most T8 findings are role swaps and wrong nouns ("given him over to
   hunger" for "to the executioner"). T8 needs a source-grounded reader or prevention.
3. **English over `<unclear>` is rare.** The translator mostly honours contract (c). T7 sits on text the OCR did *not*
   mark: only 7% of T7 pages have an unmarked `<unclear>` span. So an uncertainty floor driven by OCR tags will not
   reach T7. The garble-score floor is still untested here: it needs the corpus lexicon, which is not on this box.
4. **Sentence counts per page are too coarse** for 5–20% losses. A paragraph-aligned version is possible, but this
   result gives no reason to expect it to work.

**Caveats.**
- The negatives are "no serious finding" from one Opus reader. Some will carry errors the reader missed, which pushes
  the false-flag rate up.
- The positives mix stores whose readers' thresholds differ (Part 2 of the vision note).
- CJK, Greek and Tibetan dominate the T8 and O7 specimens. The numeral parsers cover Greek keraia, CJK, Hebrew and
  Roman numerals. Tibetan numerals are not parsed, so a Tibetan page with digits flags.

## Same day · Do they lift the predictor?

Script: `scripts/eval/error-zoo/pair-features.mjs` (the eight scores per page), then `pair-feature-lift.py` (the
audit-only model of `instrument-leakage.py`, GroupKFold(5) by book, with and without them). Result:
`scripts/eval/error-zoo/pair-feature-lift-2026-11-12.md`. The table is scored on the weekly audit's 1,340 random
served rows, with a 400-draw book bootstrap of the AUC difference.

| target | base | existing | + pair scores | difference [95%] |
|---|---|---|---|---|
| any serious | 31.4% | 0.751 | 0.754 | +0.003 [−0.005, +0.012] |
| serious OCR-stage or wrong leaf | 18.3% | 0.830 | 0.827 | −0.003 [−0.010, +0.004] |
| serious translation-stage | 28.6% | 0.750 | 0.755 | +0.005 [−0.004, +0.014] |
| T10 page | 4.4% | 0.733 | 0.787 | **+0.054 [+0.023, +0.088]** |
| O7 page | 3.2% | 0.752 | 0.764 | +0.012 [−0.012, +0.040] |
| T8 page | 5.5% | 0.620 | 0.629 | +0.009 [−0.010, +0.029] |

- **Only T10 gains.** The general audit targets do not move, so the weekly risk pool stays as it is. The scores help
  only a score aimed at T10.
- **Correction to the vision note's Part 2 shorthand.** A serious translation-stage finding is already predicted at
  0.750 from the existing features. That is mostly because English errors sit on pages with OCR damage: T7 amplifies
  O6. What stays unpredictable is the English error on clean OCR. T8, the class that defines it, scores 0.62.
