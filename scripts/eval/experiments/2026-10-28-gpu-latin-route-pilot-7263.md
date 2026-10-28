---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 20
n_pages: 195
verdict: "PENDING: pilot written, judging not yet run."
status: undecided
decision: "PENDING"
superseded_by: null
issue: [7263, 7611]
router_evidence: [latin-gpu-7263]
---
## 2026-10-28 · Route C in production: PERO draft -> agy Flash-low with the image, pilot of 20 books (#7263)

PRIOR ART: `2026-10-28-gpu-flash-vs-opus-7263.md` (the TEST this pilot checks: Latin print, 108 pages one a book, arm C
105/108 usable, Wilson 92-99%, 3 misleading), `scripts/batch/cli-ocr-lane.mjs` correct mode (#7558, the lane shape),
`scripts/eval/lane-judge-sampler.mjs` (#7611, the judge of what lanes write), reused.

**Decision being checked (Derek, 2026-10-28, "defaults"):** route C for Latin print pages with no OCR yet, with a check
flag where Flash changed >= 27% of the draft's words.

### Rule, fixed before any judge call (this file's first commit)
- **Frame judged:** the pages the pilot run WROTE (`ocr.pipeline = pero-agy-flash-low-7263`), in the 20 pilot books.
- **Draw:** `lane-judge-sampler.mjs run --book=<the 20> --per-book=3`, seed 7263: 3 written pages a book, uniform, plus
  every check-flagged page not drawn (the flagged stratum, judged always, reported apart, never evidence).
- **Judge:** Opus via `claude -p`, the route-judge prompt unchanged, page image attached, blind; two wrong-page controls.
- **PASS** (cron line + routing-table row) if the random stratum's acceptance rate is inside or above the TEST interval
  for arm C on Latin print, i.e. >= 0.92. **FAIL** (stop and report, no cron) if it is below 0.92, or if the wrong-page
  controls do not both fail. Wrong text (misleading) is reported with its interval, against the TEST's 3/108.
