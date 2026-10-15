---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 1
n_pages: 435
verdict: "Preregistered; not yet run."
status: undecided
decision: null
superseded_by: null
issue: [6560]
---
## 2026-10-15 · Gemini 4 Argon low correction pass, the same gate volume (#6560)

PRIOR ART: `2026-10-15-tibetan-flash-pass-gate-6560.md` is the gate this repeats: 3.8 Flash low on the same volume,
NO-GO (judge B: 10 of 40 pages worse, the leaf shows the correction at 74% [69, 80] of decided spans).
`2026-10-15-tibetan-gemini4-argon-correct-6560.md` is the 30-folio arm where G4L topped identity against Derge
(0.972), with one plausible-word substitution seen by eye. Identity against Derge rewards normalising toward the
print; only the leaf audit decides. Derek, 2026-10-15: run G4L through the gate.

### Preregistration (committed before any G4L call)

- **Volume:** `69e7aaba80b52390feb199b8` (Thadrak Kanjur rGyud 'bum Kha, 435 pages), the same page list
  (`pass/volume-ids.mjs`).
- **Read:** `pass/run-volume.sh 69e7aaba80b52390feb199b8 --no-apply` with `MODEL=gemini-4-argon-low`
  `JOB=tib-g4-gate-6560`. The only change to the script is that the model and job name are parameters; the CORR
  request (`corr-prompt.txt`), lane, guard and dry apply are the Flash gate's. At most 2 agy calls in flight. A
  quota stop (exit 3) is resumed after the reset, at most 3 times. Transient agy errors are re-read, as Flash's 13
  were. **Nothing is written to `pages`.** $0 (agy and `claude -p` only).
- **Guard:** the ya-btags leaf check as in the pass (Opus via `claude -p`, sealed, Read only).
- **Audit:** `leafcheck.mjs audit-req --n=40 --seed=6560`: 40 pages drawn from the changed pages the dry apply
  would write (guard reverts applied, over-25% pages excluded), every changed span, 2 known-answer controls per
  page. Same READOFF request, A/B blind, context from the draft. The 40 pages are drawn from G4L's changed set, so
  they are not the same 40 pages as Flash's.
  - **Judge B (primary):** `tiles-req`, full frame + 4 full-resolution tiles, fresh `claude -p` Opus.
  - **Judge A (secondary):** the full frame only.
  - `audit-score` per judge, and `judges` for the pooled verdict and α.
- **Decision rule, fixed now, against Flash's judge-B numbers.** GO only if all three hold on judge B:
  1. the leaf shows the correction at **≥ 90%** of decided spans, **and** the Wilson 95% lower bound is **above
     80%** (Flash's upper bound, [69, 80]);
  2. pages worse **≤ 2 of 40** (Flash: 10);
  3. controls right **≥ Flash's rate**, 67 of 80 (84%), as a rate over the controls asked.
  
  Otherwise NO-GO. Judge A and the pooled verdict are reported beside it and do not decide.
- **Also reported:** seconds per page (median of the read's started→finished, beside Flash's on the same volume),
  the guard's hit rate, the kinds of change the leaf contradicts, and 3 pages read by eye where judge B says the
  leaf shows the draft (labelled read-from-image).
