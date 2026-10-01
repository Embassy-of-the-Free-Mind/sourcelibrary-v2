## 2026-09-30 — Does disagreement between two reads of one page find garbled OCR? (#5313, #5376)

**Headline: a fresh second read finds most garbled pages but not precisely (precision 0.3–0.45 against the judge; the 0.8
gate is not met, no field written). The judge reproduces its own flag at only 0.51–0.58, so that gate cannot be met on
this reference. The same reads separate wrong-leaf pages cleanly: 7 of 7.**

- **Question.** One-read text signals failed (entry for PR #5369: P 0.60 / R 0.09). Does a second read do better, and
  what share of served pages already has one?
- **Design.** Reference: the 327 judged pages of #5274 + #5319, one per book, 32 garbled (15 major); `measure: judged`.
  Second reads: earlier model reads in `page_revisions` (segmented by `source`), the Archive's `_djvu.xml` leaf text, and a
  paid pilot of three fresh reads per page (lite, lite again, flash; live OCR prompt v16; Batch API). Score: script-aware
  token ratio (`scripts/lib/ia-ocr-agreement.mjs`), under 30 tokens on a side = unjudged. `measure: agreement`. Then a
  blind by-eye read of 30 pages (20 flagged, 6 outlier, 4 control) by Opus subagents, with one orchestrator arbitration.
- **Result.**
  - `page_revisions`: a prior model read on 14/327 pages, 0 of the 32 garbled → unjudged. Corpus: at most 7.4% of live
    OCR'd pages (upper bound; `bdrc` rows not counted).
  - Archive OCR: judged on 122/327; clean pages agree at a median 0.55; precision 0.06–0.14. Not a usable second read.
  - Fresh read vs served text: AUC 0.80 (lite), 0.85 (flash); major garble 0.87–0.91. At ratio < 0.7: P 0.29–0.30,
    R 0.70–0.74 of judged positives. Latin-script pages do not separate (P ≈ 0.1); 24 of 30 judged positives are non-Latin.
  - Three-read classes (served agrees ≥ 0.7; fresh reads agree ≥ 0.8; fixed in-sample): **hard page** 47 pages, 19 garbled
    (P 0.40, R 0.70; major 11/13); **served is the outlier** 12 pages, 0 garbled, 6 of them the #5311 wrong-leaf pages.
  - Judge vs itself (#5372 re-judgments scored against the audit flag): P 0.51–0.58, R 0.62–0.66.
  - By eye (blind; controls 0/4 wrong): served text unreliable on 8 of 18 judged hard pages (44%, CI 25–66); minor errors on
    the other 10; 3 of 9 judge-clean pages unreliable, 4 of 9 judge-garbled only minor. On hard pages flash is unreliable on
    6/17, lite on 15/18. The 5 mild outlier pages are convention differences, not defects.
  - Wrong-leaf signature (served < 0.3, fresh reads ≥ 0.9): the 6 known pages plus one new page, read by eye with display
    and source leaf opened (`eye/arbitration.md`); 0 of the 258 by-eye matches with three usable reads carry it (34 more unjudged).
  - Cost to cover (measured Batch rate per request: lite $0.0011 Latin-script / $0.0020 non-Latin; flash $0.0020 / $0.0024):
    one lite read of the 817,558 non-Latin translated pages ≈ $1,641; lite + flash ≈ $3,624; every live translated page
    $6,618–$16,609; wrong-leaf check of 3 pages in each of 23,662 Archive books ≈ $75. None run.
- **Replicated?** No. One sample, thresholds chosen on it; the by-eye set is 18 judged pages read by model subagents, under
  the 20 hand-read members §6 asks for. The lite repeat arm is the only repeat (clean pages: median agreement 1.00).
- **Decision.** Deferred to Derek: see `DECISIONS.md` ("Second read as a detector"). No routing, prompt, field or lane changed.
- **Cost.** $1.64 actual (estimate $1.71), 981 Batch requests, two rows in Supabase `gemini_usage`
  (endpoint `eval/two-read-garble-5313`); ledger line in the ops repo.
- **Artifact.** `scripts/eval/two-read-garble-5313.mjs`, `scripts/eval/results/two-read-garble-5313-2026-09-30/` (README, `report.json`, `eye/`).
  Not in the eval store or the dashboard: this scores a detector against a judged label, not an engine against a reference.
