---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 40
n_pages: 114
verdict: "The English-to-OCR length ratio is a weak screen for translation failures on alphabetic pages (AUC 0.68) and none for OCR errors (0.48) or CJK pages (0.41); it cannot see the errors that matter most, which begin in the OCR."
status: informational
decision: null
superseded_by: null
issue: 6056
---
## 2026-10-23 · Does the English/OCR character ratio predict a serious error? (#6056)

PRIOR ART: taxonomy T1 (truncation) and T9 (quiet omission) already use length against the source; this asks whether the
ratio, with no threshold tuned, ranks the pages the sprint reviewers flagged.

**Question.** Derek asked whether the ratio of translation to OCR characters predicts problems. If it did, it would be
a free corpus-wide screen.

**Design.** Every reviewed page of sprint rounds 1–4 (`scripts/eval/results/spot-check/sprint-*`), 114 pages with ≥ 50
OCR characters after stripping metadata tags (`<meta>`, `<note>`, `<summary>` … removed from both sides). Score:
|log(ratio / group median)|, alphabetic and CJK separately. Label: the Opus reviewer's serious error, read against the
image. AUC of the score for each label. Script: session scratch `ratio.cjs` (logic stated here in full).

**Result.**

| group | pages | median ratio | AUC: serious translation error | AUC: serious OCR error | AUC: any |
|---|---:|---:|---:|---:|---:|
| alphabetic | 93 | 1.19 | 0.68 (24+/69−) | 0.48 (21+/72−) | 0.59 |
| CJK | 21 | 6.96 | 0.41 (7+/14−) | 0.57 (4+/17−) | 0.41 |

- It ranks high the gross translation failures: *De natura daemonum* p54 (0.55, an English that translates none of the
  page, contained 2026-10-23) and a truncated Latin page (0.37).
- It is blind to the OCR lane, which carries most serious errors (an OCR misread renders at normal length), and to CJK.
- The most extreme alphabetic page (Italian, 0.24) had no error: a short English for a page that is mostly a table.

**What it means.** Use the ratio only as a per-book-relative screen for whole-page translation failure (a page far
from its own book's median), never as a quality measure. The detectors that see the OCR lane are script-specific marks
(`scripts/audit/headword-mark-drop.mjs`), second-read disagreement, and the reviewer reading the image.

**Not established.** n is small and clustered (3 pages per book); a per-book-relative version was not tested.
