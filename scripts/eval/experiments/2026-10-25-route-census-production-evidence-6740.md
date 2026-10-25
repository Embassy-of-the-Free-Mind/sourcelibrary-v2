---
stage: ocr
measure: [accuracy, none]
languages: []
scripts: []
canons: []
n_books: 134126
n_pages: 30511395
verdict: "Production's own record now gives the OCR estimator input rows in its existing formats: 2,261 did-not-read and guard k-of-n rows over 30.5M live pages, 596 accuracy rows scoring production's stored reads of 545 reference pages, 671 draft-to-replacement cells (change rates, not accuracy), and 60 days of pages delivered per route. Only the Gemini API writers stamp a failed read; the other routes (Paddle, Yigdzin, Kraken, the CLI lanes, Claude) leave no stamp, so they get no did-not-read row."
status: informational
decision: "Rows for estimator v2/v3 to ingest (#6740). No routing change and no write to production."
superseded_by: null
issue: [6740, 7263, 6553]
---
## 2026-10-25 · Route census: what production's routes already did, as estimator evidence (#6740)

PRIOR ART: `scripts/eval/estimator/ocr/refusal-census.mjs` does the per-book walk for lite only and reads no
`page_revisions`. `scripts/audit/ocr-revision-provenance.mjs` counts `page_revisions` rows by source but never pairs a
draft with the text that replaced it. `scripts/eval/ocr-routing/stored-census.mjs` counts pages per engine now and
has no failures. `scripts/eval/benchmark/refs/` holds the references; until now only experiment reads were scored
against them. The scorer is `scorePage` from `scripts/eval/en-ocr-reference-5124.mjs`, unchanged. This PR only
exports it and stops its stages running on import.

Derek, 2026-10-25: "can you use existing data of routes?" The run was read-only on Mongo, made no model calls and
cost $0. Script: `scripts/eval/estimator/ocr/route-census.mjs`, with the emit stage in `route-census-emit.mjs`.
Every stage checkpoints and a rerun resumes. The run went through `books → revisions → live → pairs → change → refs
→ throughput → emit` on 2026-10-25. Raw files (1.7 GB) are on the job box in
`/mnt/HC_Volume_105839809/jobs/route-census-6740/run/`. The estimator inputs are committed under
`scripts/eval/estimator/ocr/results/route-census-6740/`.

### Where the rows are, and their format

| file | rows | format | part |
|---|---|---|---|
| `failures.jsonl` | 2,261 | `failure-observations.jsonl` columns (`rate, route, script, judge, k, n, unit, books, source, file, quote, note`), plus `stage, chart, language, era, kind, raw_route, k_books, k_refused, k_failed, k_guard, k_empty, k_ever_refused, read_after_refusal` | 1 |
| `ocr-table.jsonl` | 596 | `build-ocr-table-v1.py` columns (`chart, panel, page, work, engine, engine_family, kind, period, year, cer, scored, failure, n_ref, n_ref_source, era, fame_web, dense, stratum, num_*`), plus `stored_version, stored_source, language, ref_kind, ref_source, anchored, edition, lower_bound, scorer, pareto_scale` | 2 |
| `refs-scored.jsonl` | 964 | every stored version (live and each revision) of each reference page, with its score. No text | 2 |
| `corrections.jsonl` | 671 | draft engine × replacing engine × language × page kind: `pairs, books`, a sampled `change_cer_*` (labelled change), `lane_mode`, and where a reference exists `better/same/worse` | 3 |
| `reference-pairs.jsonl` | 52 | draft → replacement pairs where both stored reads score against a reference | 3 |
| `throughput.jsonl` / `capacity.json` | 463 / 37 | field × route × source × day: pages delivered, active hours; then per route the median, p90 and max pages a day | 4 |
| `coverage.json` | — | chart × engine cells with production rows and no experiment rows, and the reverse | 5 |

`rate` values in `failures.jsonl`:
- `failed_read` is the one `failures_v0.py` already reads.
- `guard_refused`, `translation_failed_read` and `translation_guard_refused` are new names. v0's `RATES` list skips
  them until a model asks for them, so nothing already fitted changes.

### Part 1 · Did not read, every route (`failures.jsonl`)

**The denominator** is the route's own attempts as the live page records them: pages it wrote, plus pages it left
refused or failed under its own model stamp (`last_skip.model` / `fail_blocked_model` where present). Cells are route ×
chart × language × era × book kind (`book_class`: printed / handwritten). A cell needs ≥ 20 pages. `k` counts refused
+ failed pages. **Empty fields are not counted in k.** They are often blank leaves, and they sit in their own column,
`k_empty`.

| rate | route | cells | k / n | rate | refused at least once (`k_ever_refused`) |
|---|---|---|---|---|---|
| failed_read | gemini-3-flash-preview | 567 | 133 / 4,104,516 | 0.003% | 7,494 |
| failed_read | gemini-3.1-flash-lite-preview | 264 | 0 / 1,752,056 | 0 | 9,996 |
| failed_read | gemini-3.1-flash-lite | 307 | 9,755 / 964,429 | 1.01% | 13,489 |
| failed_read | gemini-2.5-flash | 30 | 0 / 21,027 | 0 | 464 |
| guard_refused | PaddleOCR-VL-1.6 | 7 | 3,113 / 343,617 | 0.91% | — |
| guard_refused | gemini-3.1-flash-lite | 51 | 2,002 / 267,670 | 0.75% | — |
| guard_refused | gemini-3-flash-preview | 10 | 33 / 498,884 | 0.01% | — |
| guard_refused | gemini-3.8-flash-low | 2 | 26 / 1,922 | 1.35% | — |
| translation_failed_read | gemini-3.1-flash-lite-preview | 319 | 3,310 / 2,171,919 | 0.15% | — |
| translation_failed_read | gemini-3-flash-preview | 307 | 2,118 / 2,417,773 | 0.09% | — |
| translation_failed_read | gemini-3.1-flash-lite | 182 | 118 / 1,174,361 | 0.01% | — |
| translation_failed_read | not recorded | 86 | 7,771 / 44,664 | 17.4% | — |
| translation_guard_refused | gemini-3.1-flash-lite | 64 | 4,140 / 358,441 | 1.16% | — |
| translation_guard_refused | gemini-3-flash-preview | 24 | 2,564 / 612,828 | 0.42% | — |

Notes on reading these rates:

- **Only the Gemini API writers stamp a failed read.** The writers that stamp are `batch-collector.mjs` and
  `realtime-ocr.mjs`. `cli-ocr.mjs`, `claude-ocr.mjs` and the specialist lanes (Paddle, Yigdzin, Kraken, NDL) write
  nothing when a read fails. Those routes therefore read 0 of n here by construction, and the emit stage gives them
  **no `failed_read` row** (`summary.json` → `part1.unstamped_routes`). Paddle alone has 1.66M pages, Yigdzin 680K,
  agy 3.8 Flash 85K translations and Claude 32K OCR pages. The absence of a stamp is not the absence of a failure.
  Their failure rates must come from experiments or from the guard rows.
- **A RECITATION stamp does not say which route refused.** 15,353 pages carry one under a non-Gemini engine
  (ia-ocr 14,927, MinerU 211, …): an unrecorded Gemini route refused them, then another engine read them. They are
  tallied apart, by language × era (`part1.unattributed_refusals`), and never charged to the engine that read them.
  97% are English (12,717 from 1880 on), which matches the census finding that the refused pages are the ones with
  a clean text online.
- **After retries, or at least once?** `k` is the page left unread after the route's retries. `k_ever_refused` is
  refusal-census's measure: the stamp survives a later successful read, and that read may have been another Gemini
  route's.
- **Translation refusals mostly carry no model.** The translate worker stamps a refusal without a model, so 7,771 of
  them sit under `not recorded`. The per-model translation rates are biased low by that much.
- **Guard rows read `page_revisions`, so their denominator is pages that have a revision history.** Pages never
  rewritten are not in it, so these rates are upper bounds.

### Part 2 · Accuracy against references production already holds (`ocr-table.jsonl`)

There are 964 reference pages: 954 benchmark references plus 10 volunteer-corrected OCR pages (34 volunteer
corrections are translations). **545 of them carry at least one production read.** That gives 596 page × engine rows
from 470 works and 29 chart × engine cells. Each row is the **engine's first stored read** of the page; later versions
(long-s pass, cleanups, re-reads) are in `refs-scored.jsonl`.

| chart | stored engine | pages | works | median CER | fame_web | anchored | edition |
|---|---|---|---|---|---|---|---|
| latin | gemini-3-flash-preview | 151 | 108 | 0.074 | 137 | 106 | 101 |
| english | gemini-3-flash-preview | 89 | 89 | 0.030 | 89 | 44 | 0 |
| chinese-manuscript | PaddleOCR-VL-1.6 | 67 | 67 | 0.247* | 67 | 0 | 67 |
| greek | gemini-3-flash-preview | 33 | 33 | 0.072* | 33 | 0 | 33 |
| english | gemini-3.1-flash-lite-preview | 31 | 31 | 0.008 | 31 | 5 | 0 |
| english | gemini-3.1-flash-lite | 28 | 28 | 0.013 | 28 | 9 | 0 |
| latin | gemini-3.1-flash-lite | 27 | 17 | 0.073 | 21 | 5 | 20 |
| english | ia-ocr (the Archive's text) | 21 | 21 | 0.006 | 21 | 0 | 0 |
| chinese-print | PaddleOCR-VL-1.6 | 18 | 18 | 0.414* | 18 | 0 | 18 |
| other:arabic | gemini-3.1-flash-lite-preview | 14 | 14 | 0.095 | 0 | 14 | 0 |

\* These rows are not on the Pareto's scale; see "Scale" below.

**Provenance of each reference, and why it counts as one.** The kinds are those in `refs/*.json`.
- **Wikisource proofread pages (77) and Gutenberg (35):** human-proofread texts of the same scan or edition.
- **Same-edition transcriptions (139):** CAMENA and similar, keyed from the same edition.
- **EEBO-TCP keyed text (99, `ocr-same-text`):** double-keyed from the same microfilm.
- **Edition e-texts (166):** Perseus, First1KGreek, el.wikisource, Kanripo, CBETA. These are modern editions of the
  work, not transcriptions of this leaf (`edition = 1`).
- **Same-leaf transcriptions (15):** made from the leaf by eye.
- **Corrected served OCR (55):** our own stored read, corrected by eye. This anchors on production by construction.
- **Volunteer span corrections (10):** see `lower_bound` below.

Flags on these rows:
- **`fame_web`.** 517 of 596 rows (87%) have a public web text. That is exactly the kind of page the recitation filter
  knows, and the kind on which v1 found the refusal logit +2.5 for lite. Where the read exists, the page was read, so
  these rows cannot measure refusal. They are the read-given-not-refused level.
- **`anchored`** (237 rows). The reference window was cut with the production read as probe, or the reference is a
  correction of it. Both favour the production engine.
- **`lower_bound`** (10 rows). A volunteer fixes only the spans they saw, so the CER of the draft against the
  correction is a lower bound on its error: median 0.006 on 10 pages from 3 books.
- **Scale (`pareto_scale = 0` on 210 rows).** Every row was scored with `scorePage`, as the brief asked.
  - The Pareto's Chinese, Japanese and Greek strata were scored by `benchmark-score.mjs`. That scorer folds Han
    variants and counts Greek letters only, and its helpers are not exported. Those rows are therefore not on the
    Pareto's scale: CER here runs high (Paddle 0.25–0.41).
  - Use them within the census panel, with their own offset, or leave them out.
  - The Latin-script rows are on a comparable normalisation: lowercased, ſ folded, punctuation dropped.

### Part 3 · Draft → replacement pairs (`corrections.jsonl`)

`page_revisions` holds 3,744,085 rows. Each was paired with the state that replaced it: the next revision, or the live
field. Each pair was then classified, in this order:

| class | ocr pairs | translation pairs |
|---|---|---|
| reread (a different engine's read replaced it) | 898,002 | 111,251 |
| edit of the same read (long-s pass, cleanups, markup) | 835,635 | 710,644 |
| relocation (leaf shift, contamination, stranded text, withhold) | 368,395 | 518,285 |
| re-read by the same model | 156,778 | 11,302 |
| filled an empty field | 76,604 | 1,259 |
| guard-refused output replaced | 31,105 | 10,311 |
| Claude / model correction | 10,595 | 2,785 |
| human (volunteer) correction | 10 | 34 |

Per the data-provenance doc, edits and relocations are not reads. They never count as a read, a delivered page or a
change. For each reread or correction cell, up to 300 pairs were drawn: one page per book first, by a deterministic
hash of the revision id, never `$sample`. 15,550 pairs were scored as **change**: `scorePage` of the draft against the
text that replaced it. **This is a change rate, not accuracy.**

| draft → replacing engine | language, kind | pairs | books | median change | lane mode |
|---|---|---|---|---|---|
| PaddleOCR-VL → Opus 5.5 (`opus_correct_6561`) | Chinese, printed | 2,667 | 528 | 0.32 | correct |
| PaddleOCR-VL → Opus 5.5 (`opus_correct_6561`) | Chinese, handwritten | 1,704 | 542 | 0.20 | correct |
| flash-lite-preview → Opus 5.5 translation (Florentine, `translate_cli`) | Nahuatl-Spanish | 2,429 | 3 | 0.46 | fresh read |
| Gemini 3 Flash → Opus 5.5 (`reocr_cli`) | Latin, printed | 1,632 | 268 | 0.011 | fresh read |
| flash-lite-preview → Opus 5.5 (`reocr_cli`) | Latin, printed | 894 | 147 | 0.038 | fresh read |
| Gemini 3 Flash → Opus 5.5 (`reocr_cli`) | German, printed | 436 | 74 | 0.003 | fresh read |
| Gemini 3 Flash → Opus 5.5 (`reocr_cli`) | Latin, handwritten | 135 | 21 | 0.15 | fresh read |
| Gemini 3 Flash (Tengyur repairs #5797) | Tibetan translation | 225 | 149 | 0.002 | correct |

How to read these cells:

- **`lane_mode`.** It is `correct` where the writer was handed the draft (`engine.input.draft`, a review block, or a
  correction reason). It is `fresh_read` where the later text is an independent read that only replaced the draft:
  most `reocr_cli` rows, despite the "Opus correction" framing.
- **Missing from the data.** The Latin #5924 Opus correction and the Yigdzin Flash correction (#6560) have no pairs
  in `page_revisions`: no revision carries their reason, and no Yigdzin draft was replaced by a Gemini text. As far as
  this record shows, they were evaluated but never written to pages.
- **High change on a same-family reread is a flag, not a quality.** For example, lite-preview → lite runs 0.75–0.97 on
  Latin, English and Greek. Most of those drafts were not of this leaf (the #3362 and #5309 repair re-reads).
- **References on both sides.** Only 52 pairs have a reference for both the draft and the replacement: 31 better,
  12 same, 9 worse (±0.005 CER). All are rereads (Flash and Paddle replacing lite or Flash). **No corrector pair lands
  on a reference page**, so no corrector is scored here.

### Part 4 · Pages delivered per route, 2026-08-26 to 2026-10-24 (`capacity.json`)

"Delivered" means pages whose live field was written that day (`ocr.updated_at` / `translation.updated_at`, text
present). Pages written in the window and later superseded are added on their `original_date`, unless the
replacement was an edit of the same read.

| field | route | source | active days | pages | median per active day | p90 | max |
|---|---|---|---|---|---|---|---|
| ocr | PaddleOCR-VL-1.6 | paddle | 9 | 1,604,855 | 87,002 | 480,118 | 480,118 |
| ocr | bdrc-yigdzin-v1 | bdrc | 9 | 740,740 | 77,119 | 312,719 | 312,719 |
| ocr | gemini-3.1-flash-lite | batch_api | 53 | 718,627 | 1,737 | 42,563 | 201,226 |
| translation | gemini-3.1-flash-lite | ai | 50 | 541,396 | 1,851 | 40,121 | 131,873 |
| translation | gemini-3-flash-preview | ai | 32 | 501,993 | 343 | 22,263 | 219,706 |
| ocr | ia-ocr | ia_djvu | 16 | 345,636 | 1,032 | 97,059 | 158,423 |
| ocr | gemini-3-flash-preview | batch_api | 39 | 169,604 | 385 | 7,102 | 117,451 |
| translation | gemini-3.8-flash-low (agy) | ai | 11 | 88,320 | 6,494 | 15,116 | 17,133 |
| ocr | claude-opus-5-5 | ai | 11 | 32,526 | 1,374 | 8,861 | 11,843 |
| translation | claude-opus-5-5 | ai | 11 | 22,722 | 1,634 | 3,601 | 7,017 |

What this measures, and what it does not:

- **It is write time, not read time.** The GPU lanes (Paddle, Yigdzin) write whole runs in bursts, so their per-day
  maximum is a writer's rate, not compute capacity. Use the median of active days beside the meters.
- **It undercounts.** A page rewritten later keeps only its last write, and superseded reads are added back only
  where `page_revisions` holds them. That is why this total (≈3.2M OCR pages in 60 days) sits below the 3.45M OCR
  calls in 30 days that the meters show (#7263). The meters also count failed calls and eval calls.
- **Seconds per page are not here.** Production does not log per-page compute time: batch `run.submitted_at →
  collected_at` is queue latency. Experiment `secs_per_page` stays the source (`src/data/ocr-pareto.json`).

### Part 5 · Bias, and which cells are new (`coverage.json`)

**Assignment is not random.** The router chose each route for its kind of page: Paddle for Chinese, Yigdzin for
Tibetan, lite for Latin-script print, the Archive's text for 1880–1930 English. Every row therefore carries `chart`,
`language`, `era`, `kind` and `books` so that a model can condition on them. Production rows must not be compared
across routes without those covariates.

**References exist only on some pages.** They sit on famous texts (87% `fame_web`), mostly in Latin script, and on
volunteer-reviewed pages. **Did-not-read rows** are counts per book cell. Treat them as clustered by book
(`books` and `k_books` are given). One volume can carry most of a cell's k.

Coverage against the Pareto's chart × engine cells:

| part | rows | chart × engine cells | cells with no experiment row before |
|---|---|---|---|
| 1 did-not-read (`failed_read`) | 1,193 | 79 | 63 (e.g. latin and latin-script-other × flash-lite-preview, 1.3M pages; english × the Archive's text, 298K; Cyrillic, Indic, Korean, Arabic, Hebrew × Gemini 3 Flash) |
| 1 guard / translation | 1,068 | — | all (no experiment rows of these rates existed) |
| 2 accuracy | 596 | 29 | 17 (Arabic, Indic, Hebrew × Gemini; english × the Archive's text; english/latin/greek × flash-lite-preview; volunteer) |
| 3 corrections | 671 | — | all (change rates; no experiment rows) |
| 4 capacity | 37 routes | — | all |

The reverse direction is in `coverage.json → experiment_only` (124 cells). These engines exist only in experiments
(the agy CLI arms, Claude, Mistral, Chandra, DeepSeek, Qwen, Surya, Tesseract). Production has no stamped attempts
for them.

TAKEN: `scorePage` on every chart, flagged `pareto_scale = 0` for CJK and Greek — why: the Pareto's scorer for those
strata is not exported, and copying it would make a second scorer (#6740).
TAKEN: no `failed_read` row for any route whose writer never stamps a failure — why: 0/n there is the absence of the
stamp, not of the failure (#6740).
