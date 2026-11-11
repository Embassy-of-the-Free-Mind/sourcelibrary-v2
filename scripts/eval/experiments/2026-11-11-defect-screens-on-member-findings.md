---
stage: translation
measure: [agreement]
languages: [la, grc, sa, zh, fr, de, en]
scripts: [Latn, Grek, Deva, Hani]
canons: []
n_books: 82
n_pages: 719
verdict: "On a member's human-found page defects (PR #8610) against unreported pages of the same books, no cheap screen ranks the defective pages above the others: Clef with one-line questions, Clef with error-zoo questions and taxonomy examples, and seven model-free rules (parallel-edition, long-s, negation count, seam, hedged notes, model reply, English source) all sit at AUC 0.4–0.6 per class, with intervals that include 0.5. An earlier reading of Clef 0.88 on T11 compared against controls from ALL books: it found bilingual BOOKS, not mishandled pages; against same-book controls it is 0.17–0.29."
status: null-result
decision: "Do not use Clef, Jev or these rules to choose QA pages; the random/fifths draws stay. The labelled set cannot yet judge a screen: controls are 'not reported', not 'verified clean' (O6 is in 43/78 books by the taxonomy's own count), and 82 of 184 reported pages were rewritten after the report. Next: a verified-clean control set read by Opus (image + OCR + English) on the subscription, then re-run run.mjs unchanged; new detectors go in detectors.mjs and are scored the same way."
feeds: "qa"
supersedes: []
superseded_by: null
issue: [8570, 5913]
router_evidence: "none — screen evaluation, not a route comparison"
defect_rates: "none — ranking test on reported vs unreported pages, not a rate"
---
PRIOR ART: `scripts/eval/experiments/2026-10-04-clef-vs-jev-instruction-page-screen.md` and the Jev omission/additions/reversal screens (#6061, #5982, #6062) were scored against planted errors or Opus-judge labels, never against defects a person found by reading. `scripts/eval/regression/almeida-2026-11-*.jsonl` (PR #8610) is the first such set.

## 2026-11-11 · Can a cheap screen find the pages a member found wrong?

**Who it is for.** QA chooses which pages an expensive reader (Opus, a volunteer) checks. A screen that ranks likely-defective pages first would raise defects found per read. Emanuel Almeida's 459-line report (7 Nov) gives, for the first time, defects a person found on the page.

**Labelled set.** `scripts/eval/defect-detectors/snapshot.mjs` (Mongo read-only): every page the findings name in an O/T/D class (184), plus pages −9, +7, −13 in the same book that no finding names (541 controls), with neighbours. Metric `run.mjs`: AUC per taxonomy class, reported vs same-book controls, 95% interval from a bootstrap over BOOKS.

**Arms.** (1) Clef 27B on Workers AI, eight one-line noul questions per page. (2) Clef, six questions written from `.claude/docs/page-error-taxonomy.md` with its own examples (no member examples). (3) A sentence-level Clef run whose questions carried the member's own examples — leaked, kept only as a record (`clef-zoo-leaky-sentence.jsonl`), not scored. (4) Seven model-free rules in `scripts/eval/defect-detectors/detectors.mjs`, reusing `sourceLanguageCount`, `boundarySignals`, `englishSource`, `translationReasoningLeak`.

**Result** (`results/defect-detectors-2026-11-11/unchanged/table.md`, pages not rewritten since 2026-10-10: 102 reported, 513 controls). Every detector on its own target class: T11 parallel 0.31, O6 long-s 0.44, O6 negation 0.56, T15 seam 0.46, T10 hedged notes 0.49, T12 English source 0.56; Clef-zoo on T11 0.17, O6 0.23, T10 0.49; Clef-plain 0.45–0.60. Classes with 3–4 pages show wide intervals and nothing beyond them.

**Correction.** In conversation on 2026-11-11 Clef-zoo was reported at 0.88 on T11. That figure used controls from all books. Bilingual books are a minority of the controls, so the screen was rewarded for recognising a parallel edition at all. With same-book controls it is below chance.

**Why nothing ranks.** (a) The defects are local: one misread letter or inverted clause on a full page. A page-level question and page-level counts dilute them. (b) Controls are not clean. The member read the passages his research needed, not every page; the taxonomy finds O6 in 43 of 78 books, so unreported neighbours carry the same defects at a similar rate, and AUC is pulled to 0.5 whatever the screen. (c) 82 of 184 reported pages were re-OCRed or re-translated after the report (`--unchanged-since` drops them).

**Cost.** Clef: 7.9M input tokens over all runs, ≈ $1.90 at list price (the account did not return 429, so it is likely billed, not on the free tier). Rules: $0.

**Next.** Verified negatives first: Opus (subscription) reads image + OCR + English for the controls and marks each clean or defective by class; then `run.mjs` is re-run with no change. Until then the set measures recall (does the QA reader catch the member's defects?) — the 80 regression rows — not screens.
