---
stage: ocr
measure: [agreement, judged]
languages: [sa, hi, mr, pra]
scripts: [Deva]
canons: []
n_books: 50
n_pages: 50
verdict: "Confirmed: on 50 new printed Devanagari books, Surya 2 on the GEX45 passes all four preregistered conditions against Flash. Median CER is Surya 2.1% and Flash 1.3% (paired Δ +0.46 points, CI +0.21 to +0.78; the margin is +2). Catastrophic pages: Surya 0, Flash 1. Inserted passages: Surya 1, Flash 0 (the rule allows Flash + 1). Misleading pages: Surya 0, Flash 1, a recited Vedic page. The blind Opus grader caught 50/50 planted errors and raised no false alarm."
status: undecided
decision: "Recommended: route printed Devanagari from the hidden Sanskrit backlog to Surya 2 on the GEX45 GPU filler (an ocr-filler-routes.tsv row and a writer). Surya is slightly worse on a typical page, never loses or invents a page, and is weak on two-column indexes. Manuscripts and Śāradā stay on Flash. Derek decides (#7243)."
superseded_by: null
issue: [7243, 6740, 6871]
---
<!-- PRIOR ART: 2026-10-24-sanskrit-gex45-vs-flash-7243.md (the exploratory test this confirms: same harness, references, scorer and gate; it asked for this run). Nothing else scored Surya on Devanagari. -->
## 2026-11-03 · Does Surya 2 hold against Flash on 50 new printed Devanagari books? (#7243 confirmation)

**Yes.** The 7243 test passed Surya 2 on 30 print books, which is exploratory grade. On 50 new books Surya passes every
preregistered condition again:
- **CER.** Surya's median CER is about half a point higher than Flash's, well inside the +2-point margin.
- **Failures.** Surya never lost a page and never wrote text that is not on the page. Flash lost one page and recited
  one.

**Who reads this.** Derek, deciding whether printed Devanagari in the hidden Sanskrit backlog is read by the GEX45 we
already rent or by Flash on the subscription quota.

### Design (`scripts/eval/sanskrit-gex45-7243/CONFIRM.md`, preregistered in 2dad6f88b; references frozen in 0333cac09)
- **Draw.** One page-weighted pool over the hidden Sanskrit books (`visible != true`), with the 105 books of 7243
  excluded (`draw.mjs --pooled --exclude`, seed 72432).
  - The population is now 10,560 books with 1.08M pages. Of these, ~2,000 books (825K pages) are stub records from a
    2026-10-27 import with no page records yet. No engine can read them, so the draw skipped them (602 skips).
- **Test set.** Candidates were looked at by eye in draw order until 50 printed Devanagari pages were found, one per book
  (`confirm-classify.py`). Of the 241 candidates looked at, 50 were print, 162 manuscript or lithograph, and 29 other
  (English-main, Urdu, Telugu or Malayalam script, blank, cards).
  - The 50 are Sanskrit, with some Hindi, Marathi and Prakrit. 20 are hard by eye: two columns, indexes, worn or small
    type, Vedic accents, algebra.
  - Printed Devanagari is therefore about 21% (±5 points) of the drawable backlog's page weight.
- **References.** Built as in 7243: two independent Opus reads from full-resolution tiles, then an Opus adjudicator
  (`confirm-refs.py`, `claude -p`). No reader saw an engine output.
  - Median R1–R2 CER is 0.17%.
  - Hashes are in `refs-manifest-confirm.json`. Texts are committed only for the 7 pages catalogued 1800–1930.
- **Arms**, all on the same fed image (≤ 2,400 px):
  - **S:** Surya 2 on the GEX45, in gpu-queue task `152-sanskrit-confirm-7243` (`drive.sh S`, util 0.6).
  - **F, as the brief defines it:** the stored Flash read where there is one (10 pages, `gemini-3-flash-preview`,
    scored on its reader-visible text). Otherwise agy `gemini-3.8-flash-low`, 1 pass, with the 7243 prompt (40 pages).
  - **FA (sensitivity):** agy Flash on all 50 pages.
- **Pass rule** (all four must hold):
  1. The upper end of the CI of the median paired Δ CER (S − F) is ≤ +2 points.
  2. S's catastrophic or unread pages ≤ F's (no rise; 7243 allowed one more).
  3. Inserted-passage pages ≤ F's + 1.
  4. Pages the judge grades 4 (misleading) ≤ F's.
- **Judge.** One blind Opus grader per page saw the image tiles, the frozen reference, and the outputs under shuffled
  letters. It used the #6740 0–4 scale (`SEVERITY-GRADER.md`) plus the REVIEWER.md severity and ocr_score.
  - **Planted controls on every page.** K0 is the reference unchanged. K1 is the reference with one planted error:
    25 pages had one word swapped, 25 had one line deleted (`confirm-sev.py`).
- **A correction, disclosed (CONFIRM.md Amendment 2a).** The first scoring read the 10 stored Flash reads as stored.
  That text includes the OCR apparatus (`<vocab>`, `<meta>`, …), which the reader strips, so the vocab lists counted as
  text: Flash 1.50% median and 4 "misleading" pages.
  - F is now the reader-visible text (`stripEditorialWrappers`), and those 10 pages were re-graded.
  - Both scorings are kept, and all four conditions pass under both.

### Results: CER (view N, `score.mjs`), 50 print pages

| arm | median CER % (95% CI) | mean % | Δ vs F, points (CI) | W/L vs F | catastrophic | inserted passage | rule |
|---|---|---|---|---|---|---|---|
| F (stored Flash else agy) | **1.28** (0.96–1.69) | 3.40 | — | — | 1 | 0 | — |
| FA (agy Flash, all 50) | 1.13 (0.94–1.53) | 5.15 | 0.00 | 7/3 | 2 | 0 | (sensitivity) |
| **S Surya 2** | **2.06** (1.45–2.53) | **2.57** | **+0.46 (+0.21, +0.78)** | 15/34 | **0** | 1 | **conditions 1–3 PASS** |
| S against FA | | | +0.45 (+0.20, +0.75) | 14/35 | 0 vs 2 | 1 vs 0 | inside the margin |

- **Surya is a little worse on a typical page and much better on the worst ones.**
  - Flash beats Surya on 34 of 50 pages, by about a point.
  - Flash's catastrophic page is a two-column verse index read at 58%; Surya read it at 4.6%. A fresh agy read of
    another page also failed, at 96% (`sa-3c8397bb-p157`; that page's stored read scores 4.8%).
  - The Vedic saṃhitā page and the framed Jaina pothi page: Flash 14% and 16%, Surya 4.8% and 2.2%.
  - Surya's mean CER is lower than Flash's (2.6% against 3.4%).
- **Surya's weak pages.**
  - A two-column word index with roman numerals: 5.2% against Flash's 0.2%. Surya read the columns row by row.
  - A Prakrit grammar page with English glosses: 9.8% against 4.9%. Surya's one "inserted passage" is here: a
    43-character misread of worn type, not recitation.
  - A dense page at 9.7% against 5.9%.
  - Two-column indexes were also Surya's weak class in 7243.
- **Hard pages (n = 20).** Median: Surya 2.7%, Flash 1.7% (Δ +0.29, CI −0.14 to +1.19). Mean: Surya 3.0%, Flash 6.0%.

### Results: blind severity of the worst error per page (one grader per page)

| arm | DNR / 0 / 1 / 2 / 3 / 4 | pages ≥ 2 or DNR | REVIEWER.md serious | mean ocr_score | errors ≥ 2 counted |
|---|---|---|---|---|---|
| F | 0 / 2 / 10 / 35 / 2 / **1** | 38 (76%) | 17 | 3.44 | 118 |
| **S** | 0 / 0 / 14 / 33 / 3 / **0** | **36 (72%)** | 18 | 3.38 | **98** |
| K0 control (reference as is) | 0 / 50 / 0 / 0 / 0 / 0 | 0 | 0 | 5.00 | 0 |
| K1 control (one planted error) | 0 / 0 / 0 / 25 / 25 / 0 | 50 | 41 | 3.34 | 50 |

- **The grader is reliable at this threshold.** It caught all 50 planted errors at the expected grade: 25/25 word swaps
  at ≥ 2 and 25/25 deleted lines at 3. It gave no grade above 0 to the 50 unchanged references.
- **Condition 4 holds: Surya 0 misleading pages, Flash 1.** Flash's is an agy read of a Vedic saṃhitā page that filled
  the printed gaps with the standard text (`इन्द्रे॑ … राष्ट्र॒मु` → `इन्द्र॑ इवे॒ह ध्रु॒वस्ति॑ष्ठे॒ह रा॒ष्ट्रमु॑`):
  recitation, #4523.
- **Structural errors.**
  - Surya's three: two two-column indexes read row by row, and one line lost on a curved two-column page.
  - Flash's two: the interleaved verse index, and the Jaina page with a lost line and its first lines repeated with
    junk ("गुरूgather").
- **Per page, the two engines are about even.** Surya's worst error is graded below Flash's on 10 pages and above it on 8.
  Surya makes fewer meaning-changing errors in total: 98 against 118.

### What else this run shows
- **Throughput.** Surya read 50 pages in 71 s of CLI wall time with the model loaded, which is 2,535 pages/h. Peak VRAM
  was 15.3 GB at util 0.6, with 40 s to serve the model.
  - 7243 measured 782 pages/h on 40 pages at util 0.85, with a layout fallback.
  - Neither is a sustained rate. At 782–2,535 pages/h, the drawable printed Devanagari (~21% of ~260K drawable pages
    ≈ 55K pages; more once the 2026-10-27 stubs get pages) is about 1–3 GPU-days.
- **Stored reads.** 21 of the 50 pages already hold OCR: 10 Flash, 11 Flash-Lite.
  - Scored on their reader-visible text, the stored Flash reads are at 1.9% median. A fresh agy read of the same pages
    scores 1.4%.
  - The Flash-Lite reads were not scored (CONFIRM.md).

### What this does not show
- **The references are Opus.** CER is agreement with two Opus reads plus an adjudicator. The print reader noise (0.17%)
  is well below the differences measured here.
- **The severity has one grader per page.** Its sensitivity and specificity are measured on the planted controls, but
  no second grader gives an α.
- **Manuscripts and Śāradā were not tested.** The 7243 verdict on them stands: they stay on Flash.

### Decision
- **Printed Devanagari: route to Surya 2 on the GEX45 GPU filler.** That needs a row in
  `scripts/gpu/ocr-filler-routes.tsv` and a writer with guards and provenance. Recommended, but not done here: no page
  text was written. Derek decides (#7243).
- A page-level Flash fallback for two-column indexes and word lists would remove Surya's main weak class. The classifier
  that routes them is not built.

*Replicated?* Yes: this run replicates the 7243 print result on 50 new books.
*Spend:* $0.
- The owned GEX45: 2 GPU-minutes in task `152-sanskrit-confirm-7243`.
- agy subscription: 50 Flash calls.
- Claude subscription, Opus: 100 reads, 41 adjudications and 61 grader calls, all `claude -p`.
- No paid API. Mongo was read only, never written.

*Artifacts:* `scripts/eval/sanskrit-gex45-7243/`:
- the preregistration: `CONFIRM.md` (with Amendment 2a), `pages-confirm.json`, `candidates-confirm-observed.json`;
- the references: `refs-manifest-confirm.json`, `refs-confirm/` (7 public texts);
- the results: `results-confirm.json.gz`, `results-confirm-vs-agy.json.gz`, `results-confirm-rawstored.json.gz` (the
  first scoring), `severity-confirm.json`, `severity-blind-key-confirm.json`, `controls-confirm.json`, `reads-confirm/`
  (the 7 public pages);
- the GPU run record: `runs/confirm-*`;
- the harness: `confirm-classify.py`, `confirm-refs.py`, `confirm-stored.mjs`, `confirm-sev.py`, plus `--pooled` in
  `draw.mjs` and `--pages` in `score.mjs`.
