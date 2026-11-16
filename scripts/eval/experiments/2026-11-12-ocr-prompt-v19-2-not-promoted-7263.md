---
stage: ocr
measure: none
languages: [la, de, fr, en, lzh, it, fa, ru]
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Decision record, no new measurement. OCR prompt v19.2 (the page types `table` and `musical-score`) is not promoted; the live default stays v19.1. Its own test failed the posted rule on one map page and left long-s handling on Latin print unresolved, and the decision triage of 2026-11-11 (#8551) took the default: keep v19.1, do not re-run a one-read test."
status: rejected
decision: "Live OCR prompt stays v19.1. The next candidate is a v19.3 that may carry both this file's page types and the margin/footnote lines of 2026-11-11-ocr-margin-type-8567.md (a different candidate, called v19.2-margin, also rejected); it needs its own paired test before it goes live. Optional, subscription only: the 20-page x 5-read x 2-prompt letter-form measure for long s."
feeds: prompt
supersedes: [2026-11-07-ocr-prompt-v19-2-7263.md]
superseded_by: null
issue: [7263, 8283, 90]
router_evidence: "none — a decision record on a prompt version, not a route comparison"
defect_rates: "none — nothing was judged in this entry; the test's rates are in 2026-11-07-ocr-prompt-v19-2-7263.md"
---
## 2026-11-12 · OCR prompt v19.2 (scores and tables) is not promoted (decision record, #7263)

PRIOR ART: `2026-11-07-ocr-prompt-v19-2-7263.md` (the test, left `undecided`) and `2026-11-11-ocr-margin-type-8567.md` (a different candidate that its own file calls v19.2-margin, rejected). Job siku-fullres-8283 asked whether to make v19.2 the live default, with "measure first" as its default.

**The measurement exists, and it is the 11-07 test.** v19.2 typed 27/30 Siku score and table pages correctly (v19.1 0/30) and moved no tag on 30 ordinary pages, but one map page was judged worse, and the posted rule counts that page. Long-s handling on 5 Latin print pages was not settled. Job margin-prompt-8567 did **not** measure this candidate: it tested the margin/footnote lines, and that candidate failed too (margin type 77% against a bar of 85%; body-defect pages 18 against 15 of 32).

**Decision.** On 2026-11-11 the decision triage (#8551, comment on #7263) took the default for this file's own DECISION line: keep v19.1 and do not re-run a one-read test. This entry records that, so the 11-07 file stops reading as owed. The reader-side values `table` and `musical-score` (PR #8346) do not depend on the prompt and are not affected.
