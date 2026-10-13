---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 188
verdict: "Not established: v18 stops invented text on clean white leaves but not show-through; pre-registered S1 (5 better vs 2 worse, p 0.45) and S2 blank-recall clauses fail."
status: superseded
decision: "Not promoted on this evidence; re-run with by-eye labels (#4195)"
superseded_by: "2026-10-02-ocr-v19-showthrough-4195.md"
issue: [4195, 4149]
---
## 2026-10-02 · Does OCR prompt v18 (blank narrowing + `<insert>`) stop invented text on blank leaves without declaring real pages blank? Three arms, Batch, k=3 (#4195, #4149)
<!-- PRIOR ART: prompt-ab.mjs (#4610, realtime k-run A/B on 10 cases), blank-page-study.mjs (#3444, reference-free blank scoring, reused), ocr-preprocessing/gemini-score.mjs (#5250, windowed CER + A/A rule, reused). None ran three prompt arms through Batch over labelled strata. -->

**Verdict: not established. Do not promote on this evidence.** v18 removes the invented page on clean white leaves: on 5 such pages v16 writes a whole recipe or essay and v18 declares `blank` on every run. It does not fix show-through leaves. It shows no tendency to declare real pages blank. But the pre-registered primary test (S1, 5 better vs 2 worse, p 0.45) and the S2 blank-recall clause both fail.

- **Question.** Pre-registered in `PREREGISTRATION-ocr-v18-blank-insert.md` before any call. The amendments, dated and written before submission, pin down the operational details. v18 is v16 with four edits: the enum moves onto `<page-type>`; `blank` is defined as "no ink on this side"; a Blank pages section is added; the DISCURSUS and drop-cap specimens are neutralised and `<insert>` reworded. v17's `<lacuna>` is excluded.
- **Design.** `measure: reference-free outcome rates` on S1–S4 and `accuracy` (windowed CER) on S5. Model `gemini-3.1-flash-lite` via Batch, using the production cross-book request. Arms: A = v16 (hash `0203c264…`, verified), A2 = v16 again as an independent job (the noise floor), B = v18. k = 3, so 1,692 requests over 188 pages, seed 4195. Tibetan and Syriac were excluded (6 books). Strata:
  - S1: 40 #4149 FABRICATED leaves
  - S2: 37 v0.4 `blank_page`
  - S3: 43 sparse-ink real pages, including prompt-ab faint-mark, basmala and cataloguer
  - S4: 28 label/marginalia pages
  - S5: 40 of #5250's reference pages (la / grc / zh)
- **Result** (page means; A / A2 / B):
  - **S1** fabricated: 0.350 / 0.375 / 0.267. B better on 5 pages, worse on 2, p 0.45. Clause **FAIL**.
  - **S2** blank recall: 0.712 / 0.685 / 0.649. B better on 3, worse on 6. Clause **FAIL**.
  - **S3** false blank: 0.295 / 0.318 / 0.233. B better on 4, worse on 1. Clause PASS.
  - **S5** windowed CER: 0.110 / 0.120 / 0.130. Median B−A is +0.0002, within the floor of 0.0095, but B is worse on 19 pages and better on 10 (p 0.14). Clause PASS.
  - **Loop** rate: 2.3% / 2.2% / 1.8%. Clause PASS.
  - **S4** label capture (diagnostic): 0.37 / 0.29 / 0.52. B better on 5, worse on 0.
  - The A/A floor is 0 on every binary stratum, because 35–41 pages per stratum are identical between A and A2.
- **Read against the images (post hoc).**
  - v16 on today's Flash-Lite invents on only about 15 of the 40 #4149 pages, so S1 was underpowered.
  - v18 fixes the clean white leaves but not the show-through leaves (Philo p.5, *Hermeneia* p.5), nor one white leaf (Clement p.584).
  - 5 of the 6 S2 pages that lost `blank` under v18 carry real ink by eye: a shelfmark, pencil notes, an accession number, a manuscript note and a spine title. The S2 label was an earlier OCR's own `blank` claim.
- **Replicated?** No. This is a single k=3 run.
- **Cost.** $1.63 actual, against an estimate of $1.99.
- **Next.** A by-eye S2. An S1 screened on the current model and then re-run fresh, split into white and show-through leaves. A show-through-specific instruction.
- **Artifacts.**
  - `scripts/eval/ocr-v18-ab.mjs`
  - `scripts/eval/RESULTS-ocr-v18-blank-insert.md`
  - `scripts/eval/results/ocr-v18-ab-2026-10.json`
  - `scripts/eval/results/ocr-v18-ab-2026-10/` (reads, pages, Batch ids)
