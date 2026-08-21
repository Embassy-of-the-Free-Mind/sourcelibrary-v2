# Repeat-instability pilot — result (2026-07-31)

Design and predictions: `scripts/eval/PREREGISTRATION-repeat-instability.md`.
Draw: `scripts/eval/repeat-instability-draw.mjs --pairs=12 --seed=7`.

## Outcome

**6 of 8 decided pairs — 75%.** Two-sided sign test **p = 0.29**.

The preregistration called ≥70% support and ≤55% refutation. The point estimate
lands in the support band; the p-value says an n=8 pilot cannot distinguish 75%
from a coin flip. Per the prereg's own instruction, the answer is a larger draw,
not a softer reading of this one. **Do not quote 75% as a finding.**

| pair | judged harder | that arm was | correct | book |
|---|---|---|---|---|
| 01 | B — complex layout | unstable | yes | reusner-pandora |
| 02 | A — bleed-through | stable | **no** | explanation-of-the-table-of-the-three-principles |
| 03 | B — clipped + abbreviation | unstable | yes | encheiridion-dogmatico-hermeticum |
| 04 | B — complex layout | unstable | yes | lineae-primae-eruditionis |
| 05 | B — complex layout | unstable | yes | principia-philosophiae-more-geometrico |
| 06 | A — clipped + bleed-through | unstable | yes | curiositez-inouyes |
| 09 | A — complex layout | stable | **no** | vaticinia-seu-praedictiones |
| 11 | A — bleed-through | unstable | yes | prince-starbeam |

Unstable-arm agreement: 0.52, 0.83, 0.80, 0.85, 0.84, 0.81, 0.43, 0.84.
Stable-arm agreement: 0.98, 0.98, 1.00, 0.99, 1.00, 1.00, 0.99, 1.00.

## Why n=8 and not 12

Two pairs short of the prereg because pair 07 had no image on either side, and
two more (10, 12) were not judged: the judge ran out of context. That is a
harness limit, not a data limit — the images are drawn and the manifest is
intact, so the remaining pairs can be judged by continuing from `manifest.json`.
Recording it because a pilot that silently reports its achieved n as its planned
n is the thing this repo keeps catching.

## What the misses look like

No pattern separates them at this n. Pair 02 was a marginal unstable page (0.83)
and pair 09 the single most unstable page in the draw (0.43) — so "the threshold
was too loose" is NOT supported: the extreme case was missed too.

Both misses were pages the judge called harder on **bleed-through** and **layout
density** in a book where the other arm had the same properties to a similar
degree. Where the judge was right, the difference was usually categorical rather
than a matter of degree — text physically clipped at the page edge, a title page
against running prose, six levels of nested braces against three.

That suggests the useful next iteration: ask "is there a categorical difficulty
feature present" rather than "which is harder," which turns a forced binary into
something with a defensible answer.

## Standing caveats (from the prereg, unchanged by the result)

1. The judge is an LLM reading the image and may find hard what Gemini found
   hard, for shared reasons. The manifest is ready for a human pass.
2. Blind to fabrication: two passes reciting the same memorized text agree
   perfectly and never enter the unstable arm.
3. "Stable" is not "correct" — consistency is the thing under test, so the
   control arm cannot be assumed accurate.
