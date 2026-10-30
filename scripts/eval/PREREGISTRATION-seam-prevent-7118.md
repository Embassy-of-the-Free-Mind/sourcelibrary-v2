# PREREGISTRATION — folio markers and a catchword label on 3.8 Flash (#7118, job seam-prevent-ab-7118)

PRIOR ART: `experiments/2026-10-04-seam-markers-confirm-5678.md` (markers on Lite 26 → 19, old Flash 16 → 11 per 100
breaks, p 0.105 and 0.18; Batch lane, paid), `experiments/2026-10-16-seam-prompt-candidate-6742.md` (one edge
instruction on 3.8 Flash via agy: null; A-vs-A swing 6.7 per 100). The harness is
`seam-prevent-7118/ab.mjs`, built on `seam-prompt-6742/ab.mjs` (the production CLI request, call for call) and the
`seams-6742/opus-reference.mjs` label set. Committed before any arm runs.

## The question

On the lane that writes translations today (Gemini 3.8 Flash low via `agy`, prompt v13, `PAGE_BREAK_SCOPED`), do
folio markers and a catchword label cut broken page joins, especially majors? If either does, it ships.

## Sample

- Frame: books `visible: true, pages_count > 0`, not held, not an English book, ≥ 2 translated pages; no book from the
  #6742 300-junction set. Books are taken in a seeded shuffle (seed 7118); each contributes at most ONE break.
- A break (N, N+1) qualifies when both pages are translatable (`isTranslatablePage`), neither is a non-prose type,
  the source of both is Latin script (`dominantScript`), and the source runs across the turn by BOTH tests:
  - page N's body (furniture and a catchword line removed) ends without closing punctuation, or on a hyphen-split word;
  - page N+1's body opens on a lowercase continuation clause (`continuationFragment`).
- Catchword stratum: `resolvePageBreak(N, N+1)` names a catchword (the device production's prompt already acts on).
  Books with a catchword break contribute it until 40 are drawn; the rest contribute a random qualifying break. Target
  120 breaks, at least 30 with a catchword after drops. If the frame cannot give 30, the count found is reported.
- Nothing is written to `pages` or any collection. Mongo reads only.

## Arms (all `gemini-3.8-flash-low` via `agy`, `gatedTextCall`, the CLI suffix, the v13 default as stored)

- **A**: production. `buildTranslationPrompt` with `PAGE_BREAK_SCOPED` and neighbour OCR. Page N is seeded with the
  STORED translation of N−1; page N+1 with the arm's own read of N (as `cli-translate.mjs` does in sequence).
- **A2**: A again, an independent draw. The noise floor.
- **M**: A + `TRANSLATE_FOLIO_MARKERS`: ONE call for the block (N, N+1), `buildBlockTranslationPrompt` with
  `folioMarkers: true`, `PAGE_BREAK_SCOPED`, the stored N−1 translation as continuity and the neighbour OCR at both
  ends. Split by `parseFolioMarkedText` as the lane does; a page the parse leaves undrafted is a defective join.
- **C**: A + one catchword rule (`seam-prevent-7118/catchword-rule.mjs`). Every page's prompt gains the rule: a printed
  catchword is rendered once, verbatim, as `<catchword>word</catchword>` at the foot of page N, and the word is
  translated where it belongs, on N+1. Where production's device notes say the catchword "must not be translated",
  they now say "do not translate it here; label it". Nothing else changes.
- **MC**: M + the same catchword rule (in a marked block the label goes just before the next page's marker).
- A `<catchword>` element is removed from N's English before it seeds N+1 (it is a label, not text).

## Judge

- Blind Opus (`claude -p`, subscription). One call per break shows SOURCE N (end), SOURCE N+1 (start) and six
  versions of the join, ENGLISH N (end) + ENGLISH N+1 (start), as V1…V6 in a seeded random order: A, A2, M, C, MC
  and a byte-identical copy of A (the A/A plant). The second call shows them in the reverse order. Per version the
  judge gives the `opus-reference.mjs` label (`ok | omission | duplication | drift | broken_syntax | catchword |
  other`), all labels, and a severity (`none | minor | major`).
- What the judge sees is what a reader reads across in the continuous view: `<catchword>` elements are removed from
  every version before judging (the label is checked separately, below), as are `<summary>`, `<keywords>`, `<meta>`.
- A version's join is **defective** when it is labelled non-ok in BOTH calls; **major** when defective and labelled
  major in both. A label (omission, duplication, catchword…) counts when it is in `labels` in both calls.
- Judge floor: the A copy must get the same defective/ok verdict as A in ≥ 90% of breaks.
- Catchword check (deterministic, catchword stratum, C and MC): **kept** = exactly one `<catchword>` in N's English,
  none in N+1's, and its folded text matches the printed catchword; **dropped** = none; **doubled** = more than one, or
  one on N+1 too. Spurious = a `<catchword>` on a break outside the stratum.

## Rule (fixed now)

- Defects per 100 breaks, per arm, over breaks where every arm has both pages drafted (a failed parse in M/MC counts as
  a defect and keeps the break in).
- **A/A swing** = |def(A2) − def(A)| per 100.
- **An arm (M, C, MC) ships** if: def(A) − def(arm) > swing, AND the paired exact sign test (discordant breaks,
  one-sided, arm fewer defects) gives p < 0.10, AND majors(arm) ≤ majors(A).
- **The catchword rule ships** (in C or MC) if, on the catchword stratum, breaks carrying a `catchword` or
  `duplication` label fall (C vs A, and MC vs M), `omission` labels do not rise (same pairs), and the label is kept in
  ≥ 80% of stratum breaks with spurious labels on ≤ 5% of other breaks.
- If both M and MC pass, MC ships when the catchword rule also passes, else M. If C passes the arm rule but not the
  catchword rule, it does not ship.
- Reported regardless: per-arm defects, majors, labels, by stratum; failed reads; the A/A judge floor; M/MC parse
  failures.

## What this cannot say

A seam judge reads a window around the turn, not the whole page's accuracy. Two-page blocks only (production blocks
would be longer). Latin script only. n = 120 resolves only large effects: the 6742 A/A swing was 6.7 per 100.

## Amendment 1 (2026-10-29 22:15 UTC, after the draw, before any arm ran)

The draw: 165 books scanned, 120 breaks, 40 in the catchword stratum (kinds: catchword 21, split 9, none-but-tagged 7,
merged 2, split+catchword 1; all 40 also carry a catchword in the OCR's `<meta>`). 27 of the 80 "plain" breaks carry a
catchword in the OCR's `<meta>` that the device did not match to the next page. A label on such a page is not
spurious, so **spurious** is counted over the 53 plain breaks whose OCR records no catchword at all. Everything else
stands.

## Amendment 2 (2026-10-29 22:40 UTC, during the translation run, before any judging or scoring)

The catchword check counted a label on N+1 as "doubled", but page N+1 has its own foot, and a correct C/MC labels
N+1's catchword (for N+2) there (seen on the first break: `tus` at N's foot, `Con` at N+1's foot). Corrected:
**doubled** = more than one label in N's English, or a label of THIS catchword in the first half of N+1's English;
**misplaced** = no label in N, this catchword labelled at N+1's head. **Spurious** counts labels in N's English only.
