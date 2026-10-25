---
stage: ocr
measure: [agreement, judged]
languages: [sa, hi, mr]
scripts: [Deva]
canons: []
n_books: 40
n_pages: 40
verdict: "On printed Devanagari, Surya 2 on the GEX45 is within agy Flash's error under the preregistered gate. Median CER: Surya 1.9%, Flash 1.6% (paired Δ +0.2 points, CI −0.15 to +0.85, n = 30 books). Surya had 0 unread or catastrophic pages; Flash had 3, two of them Gemini filter blocks. On pages at severity ≥ 2 or unread, Surya was 47% and Flash 67%. On manuscripts no open engine passes: Surya 27.6% vs Flash 18.2%, n = 10. Chandra 2, dots.ocr, Qwen3-VL-8B, PP-OCRv5 and PaddleOCR-VL all fail both cells. A third of the backlog's pages are Śāradā, which no tested Devanagari engine covers."
status: undecided
decision: "Recommended: a decision-grade confirmation of Surya 2 on ≥ 50 more print books, then route printed Devanagari (~109K backlog pages) to Surya on the GEX45. Manuscripts and Śāradā stay on agy Flash. Derek decides (#7243)."
superseded_by: null
issue: [7243, 4729, 6740, 6871]
---
<!-- PRIOR ART: 2026-10-18-latin-gex45-bakeoff-5924.md (the harness shape and the paired-gate statistics, reused). 2026-09-11-which-languages-can-ocr-on-flash-lite-per-language-4729.md (lite cannot read Devanagari, so Sanskrit routes to Flash). 2026-10-18-gex45-capability-card-6871.md (rates on this card). The #6011 waves had no Sanskrit chart. Nothing before this scored an open engine on Devanagari against Flash on shared pages. -->
## 2026-10-24 · Can an open engine on the GEX45 read the hidden Sanskrit backlog as well as agy Flash? (#7243)

**Yes for printed Devanagari: Surya 2 passes the preregistered gate. No for manuscripts. The sample is exploratory
(30 print books), so the result earns a confirmation run, not the backlog.** Surya's CER is a little worse than Flash's on
the pages Flash reads. It never refused, looped or recited, and Flash lost 3 of 30 print pages.

**Who reads this.** Derek, deciding where the 8,806-book hidden Sanskrit backlog (295K pages, 82K with any OCR) is read.
The options are the GEX45 we already rent, or agy Flash on the subscription quota.

### Design (`scripts/eval/sanskrit-gex45-7243/PREREG.md`, commit 7c2917b4c; Amendment 1 in 699ad0e1f)
- **Draw.** 105 candidate books were drawn page-weighted within three source groups (IA/eGangotri 60, other/IIIF 25,
  Museums of India manuscripts 20), with one interior page per book (`draw.mjs`, seed 7243). Every candidate was
  classified by eye before any engine ran.
- **Test set.** 40 Devanagari pages: 30 print and 10 manuscript, 14 marked hard, 9 canonical. Two drawn pages were found
  while referencing to be another script (one Śāradā, one Newar hand). Each was replaced by the next Devanagari
  candidate of the same group in draw order. The prereg's 28/12 split became 30/10.
- **References.** Each page had two independent Opus reads from full-resolution tiles, then an Opus adjudicator. The
  sha256 of all 40 was frozen in 10cff95dd before any output was scored.
  - **Reference noise** (median R1–R2 CER): print 0.30%, manuscript 6.96%.
  - **Check against an e-text.** The four BORI Mahābhārata pages match GRETIL's text of the same edition exactly
    (0 edits in 3,125 letters).
  - These are model references, so the CER below is agreement with Opus, as in the Latin bake-off.
- **Arms**, all on the same fed image (long side capped at 2,400 px, hashes in `inputs.json`):
  - **F and F2:** Gemini 3.8 Flash low via agy, two passes, giving an A-vs-A noise floor.
  - **On the GEX45:** S Surya 2 (served on the box's vLLM 0.31), C Chandra OCR 2, D dots.ocr, Q Qwen3-VL-8B-FP8,
    P5 PP-OCRv5 with the Devanagari recogniser, PV PaddleOCR-VL-1.6.
  - F, F2 and Q share one prompt. The other engines use their own prompts.
- **Scoring** (`score.mjs`, normaliser `deva-n@1`, self-test pins the combining-mark folds, #5123):
  - Code-point CER over Devanagari only, on order-tolerant text.
  - Unread pages (empty, refused, filter-blocked) score CER 1.
  - Catastrophic means CER > 0.5 or a loop.
  - An inserted passage is ≥ 40 characters with no 8-gram in the reference. This is the recall check (#4523).
- **Gate, per cell.** The upper end of the paired CI of the median CER(E) − CER(F) must be ≤ +2 points. E's
  catastrophic pages must be ≤ F's + 1, and its pages with an inserted passage ≤ F's + 1.
- **Severity (Amendment 1, from Derek's inbox note, #6740).** One blind Opus grader per page saw the image, the
  reference and all 7 arms under shuffled letters. It graded the worst error on the #6740 scale: 0 cosmetic, 1
  recoverable word, 2 meaning changed, 3 structural, 4 misleading, with DNR (did not read) kept apart. It is reported
  beside CER and is not part of the gate.

### Results: CER (view N), median % with 95% CI; Δ = arm − F in points

| arm | print (n = 30) | Δ vs F (CI), W/L | cat. | passages | gate | manuscript (n = 10) | Δ vs F (CI) | cat. | gate |
|---|---|---|---|---|---|---|---|---|---|
| **F** Flash 3.8 low (agy) | **1.6** (0.9–2.1) | — | 3 | 1 | — | **18.2** (11.8–29.4) | — | 1 | — |
| F2 Flash, 2nd pass | 1.4 (0.9–2.2) | −0.03 (−0.19, +0.09), 15/11 | 1 | 0 | (noise) | 15.9 | −0.04 (−3.9, +2.6) | 2 | |
| **S Surya 2** | **1.9** (1.4–3.0) | **+0.20 (−0.15, +0.85), 12/17** | **0** | **0** | **PASS** | 27.6 (20.1–33.6) | +6.2 (+1.3, +10.0) | 0 | fail |
| C Chandra OCR 2 | 4.2 (2.9–5.5) | +2.5 (+1.1, +2.8) | 0 | 0 | fail | 28.0 | +5.5 (0.0, +8.2) | 0 | fail |
| D dots.ocr | 6.8 (5.2–13.8) | +5.4 (+3.5, +8.9) | 1 | 5 | fail | 100 | +68 | 8 | fail |
| Q Qwen3-VL-8B FP8 | 15.2 (13.0–21.0) | +13.6 | 4 | 15 | fail | 76.1 | +51 | 6 | fail |
| P5 PP-OCRv5 Devanagari | 14.9 (10.8–20.6) | +11.0 | 2 | 9 | fail | 69.3 | +46 | 10 | fail |
| PV PaddleOCR-VL-1.6 | 27.7 (22.9–36.0) | +24.4 | 5 | 20 | fail | 81.0 | +54 | 8 | fail |
| F-vs-F2 noise floor | 0.19 | | | | | 2.7 | | | |

- **Flash fails differently from Surya.** On the 27 print pages it read, Flash's mean CER is 1.8% against Surya's 2.6%.
  The gap is Flash's 3 lost pages:
  - two Gemini filter blocks: Agnipurāṇa 1890, blocked in both passes; Rasārṇava 1910, blocked in one;
  - one 71% read of a two-column word index, with the columns interleaved.
  - Post hoc (not preregistered): with those pages removed, Surya still passes. Its Δ is +0.24 (CI −0.06, +1.03).
    Against F2 instead of F it is +0.35 (0.00, +1.17).
- **Where Surya is worse than Flash on print.** The Marathi geomancy page with printed figures (10.4 vs 2.1); a 1894
  two-column dictionary with Bengali glosses (12.0 vs 5.2); the Rasārṇava page (13.1, which Flash's other pass read at
  7.6).
- **Hard and canonical pages.**
  - Hard (n = 14): Surya 3.1 vs Flash 3.7.
  - Canonical (n = 9, Mahābhārata, Gītā, Ṛgveda, Atharvaveda, Yogasūtra, Rājataraṅgiṇī): Surya 1.5 vs Flash 0.9.
  - No arm inserted a passage on a canonical page. None of them reproduced GRETIL's starred apparatus lines, which a
    reciting model would add.

### Results: severity of the worst error per page (#6740 scale; one grader per page, so no α; read as that grader's threshold)

| arm | print: DNR / 0 / 1 / 2 / 3 / 4 | print, ≥ 2 or DNR | errors ≥ 2 per read page | manuscript: DNR / 0 / 1 / 2 / 3 / 4 |
|---|---|---|---|---|
| F Flash | 2 / 1 / 9 / 17 / 1 / 0 | 67% | 1.9 | 1 / 0 / 0 / 7 / 0 / **2** |
| **S Surya 2** | 0 / 1 / 15 / 14 / 0 / 0 | **47%** | 2.4 | 0 / 0 / 0 / 9 / 1 / 0 |
| C Chandra 2 | 0 / 0 / 6 / 24 / 0 / 0 | 80% | 4.1 | 0 / 0 / 0 / 9 / 0 / 1 |
| D dots.ocr | 0 / 0 / 6 / 19 / 5 / 0 | 80% | 3.8 | 4 / 0 / 0 / 1 / 3 / 2 |
| Q Qwen3-VL | 0 / 0 / 1 / 24 / 5 / 0 | 97% | 6.0 | 0 / 0 / 0 / 3 / 6 / 1 |
| P5 PP-OCRv5 | 1 / 0 / 6 / 12 / 11 / 0 | 80% | 5.3 | 0 / 0 / 0 / 0 / 10 / 0 |
| PV PaddleOCR-VL | 2 / 0 / 0 / 22 / 5 / 1 | 100% | 9.7 | 4 / 0 / 0 / 0 / 6 / 0 |

- **Severity agrees with the gate.** Surya has the most print pages with nothing worse than a recoverable word (16/30,
  against Flash's 10/30), and no structural or misleading page. When Flash does read a page, it makes fewer
  meaning-changing errors than Surya (1.9 against 2.4 per page).
- **On manuscripts every arm changes meaning on every page.** Flash is the only arm with **two grade-4 pages**:
  - sa-87c61f7c: the scribe's text is silently replaced by the standard yajñopavīta mantra. This is recitation (#4523).
  - sa-e625b010: an invented phrase.
- With the #6740 example weights (0, 1, 3, 3, 10), mean loss per read page is print S 1.90, F 2.25, C 2.60; manuscript
  S 3.0, F 4.6. The weights are Derek's call; this is shown as illustration only.

### Throughput (GEX45 RTX PRO 4000, 40 pages, model loaded; peak VRAM at util 0.85)

| arm | pages/h | peak VRAM | printed Devanagari backlog (~109K pages) |
|---|---:|---:|---:|
| S Surya 2 | 782 (CLI wall incl. layout fallback) | 21.6 GB | ≈ 140 h ≈ **6 GPU-days** (an upper bound: 40 pages do not fill the batch) |
| P5 / PV / D | 9,581 / ~2,200 / 631 | 9.2 / 9.4 / 19.4 GB | (fail the gate) |
| C / Q | 151 / 227 | 21.0 / 19.7 GB | (fail) |
| F Flash via agy | ~420 (17 s/page, 2 parallel) | — | ≈ 260 h of calls on the shared Google quota, if it is free |

### What the draw says about the backlog (page-weighted, ±7–9 points)
- **Devanagari is about 48% of the backlog's pages (~143K):** about 109K print and 34K manuscript.
- **Śāradā or Newar is about 34% (~100K pages).** Most of it is eGangotri's Kashmir collections, catalogued
  `language: Sanskrit`. No Devanagari engine reads these, and nothing here measured Flash on Śāradā.
- **Another language or script is about 14%:** Urdu, Kannada, Telugu, Gurmukhi, English, Italian.
- **Near-blank: about 3%.**
- The catalogue's `language: Sanskrit` therefore does not route OCR by itself (#4884).

### What this does not show
- **Exploratory grade.** 30 print and 10 manuscript books; the confirmation needs ≥ 50 print books
  (eval-design §3.1).
- **References are Opus.** Agreement with Opus is not accuracy. Print reader noise is small (0.3%) and GRETIL confirms
  4 clean pages. Manuscript references carry about 7% noise, so manuscript CER differences under about 5 points are not
  resolved.
- **Severity has one grader per page** and no planted controls or inter-rater α. Its rates are that grader's threshold
  (eval-design §2).
- **Throughput comes from 40 pages.** It is not a sustained run, and Surya ran through the CLI (layout plus
  block-mode fallback on 1 page).
- **Rights.** These books are hidden and the rights check is pending (#4809). Reference texts and reads are committed
  only for the 21 pre-1931 or manuscript pages; for the rest, `refs-manifest.json` holds hashes.

### Decision
- **Printed Devanagari.** Run a decision-grade confirmation of Surya 2 against Flash: ≥ 50 more print books, the same
  references and gate, with a severity grader carrying planted controls. If it holds, route the ~109K printed Devanagari
  backlog pages to a Surya lane on the GEX45. That is about 6 GPU-days at $0 marginal cost, and frees about 260 h of
  agy Flash quota. A page-level Flash fallback for Surya's weak classes (figures, Bengali glosses, two-column
  dictionaries) is worth testing in that run.
- **Manuscripts (~34K pages).** No open engine is within Flash. They stay on Flash, which itself reads them at about
  18% CER and recited one page in 10, so manuscript OCR is not publishable as it stands.
- **Śāradā (~100K pages).** Untested. It needs its own reference set, and possibly a Śāradā-capable engine, before any
  lane.

*Replicated?* No; F/F2 is a noise floor, not a replication.
*Spend:* $0. agy subscription (80 Flash calls), the owned GEX45 (40 GPU-minutes in gpu-queue task `151-sanskrit-7243`),
Opus subagents on the Claude subscription (84 reads, 37 adjudications, 40 severity grades). No paid API, no Mongo writes.
*Artifacts:* `scripts/eval/sanskrit-gex45-7243/`:
- `PREREG.md`, `pages.json`, `candidates-observed.json` (all 105 candidates with by-eye strata), `inputs.json`;
- `refs-manifest.json` (hashes, R1–R2 noise, rights), `refs/` (21 public texts), `gretil-check.json`;
- `results.json.gz` (`node score.mjs <arms dir>`), `severity.json` with `severity-blind-key.json`, `reads/` (public
  pages), `runs/` (GPU run records and `drive.log`);
- the harness: `draw.mjs`, `classify.py`, `prep.py`, `drive.sh`, `read.py`, `p5.py`, `chandra-arm.py`,
  `surya-collect.py`, `queue-task.sh`, `sevprep.mjs`, `sevagg.mjs`, `SEVERITY-GRADER.md`, the reader and adjudicator
  briefs.
