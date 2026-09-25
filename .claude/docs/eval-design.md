# Eval design: one registry, one result store, paired comparisons, a landing rule

PRIOR ART: `.claude/docs/ocr-quality-measurement-loop.md`, `.claude/docs/ocr-translation-eval-landscape.md`, #4735, #4925, #3499 — each covers one part (stability signal, OCR-vs-translation split, the standing benchmark method, the seven pending decisions, contamination); none says how eval data is collected, stored, compared and landed across every study. This doc is that design and links them instead of restating them.

Living doc (undated). Issue: #5106. Status: **design only** — nothing here is implemented until its follow-up issue lands; every paid step goes to Derek with a cost first.

## Who this is for, and the one question

Derek and the other dev, seated, deciding where OCR and translation money goes and what readers are shown. The question they bring:

> *For this kind of page, which engine is accurate enough, how sure are we, and what would it cost to be sure?*

The design succeeds when that question has **one place to go** (the registry + store, rendered on `/platform/admin/ocr-evidence`) and the answer **cannot silently mislead** — every number on the surface says what it measured (accuracy, agreement or stability), on how many *books*, and paired against what.

Secondary readers: a session about to run an eval (it reads §3–§9 and inherits the schema instead of inventing one); the TU Delft paper (#4916), which cites cells from the store, never recalled numbers.

### What this supersedes

- The **method** sections of #4735 and #4925 stay as written; this doc makes them the schema they were describing.
- `scripts/eval/INDEX.md` stays the catalogue of scripts; this doc is the design they must conform to.
- Per-study result formats (`results/*.json` shapes that differ per script) are superseded by §5. Existing files are folded in by §12, not rewritten.
- The dashboard's *unpaired median per engine* view is superseded by §7 (paired by default). Until the follow-up lands, the page must carry the label in §2.

## 1. What went wrong, in one table

The evidence is in #5106. The design answers each by construction:

| Failure (2026-09-25) | Root cause | Design answer |
|---|---|---|
| Surya "1.6% vs 6.6%" on Greek was an artefact | the dashboard leads with each engine's median over different page sets (the paired block exists in the JSON but comes second) | §7: an engine-vs-engine number exists only on shared pages; the unpaired median is greyed and labelled |
| English/French/Italian/Dutch/… have 0 reference pages | references follow e-text convenience | §3: sample size per stratum is set from live pages at stake; §4: reference acquisition is a pipeline with a queue ordered by that gap |
| lite-vs-flash *agreement* quoted as quality | one word for three measurements | §2: `measure` is a required enum on every score; only `accuracy` may be called quality |
| two paid studies sat in dead worktrees | no definition of landed | §9: a run is done when four things are true, and a check flags results that are not on main |
| #350 closed on "improved with v10" | claims without a cell | §10: a routing/withholding change cites a store cell id or it does not merge |

## 2. Vocabulary that cannot be confused

Every score row (§5) carries `measure`, one of:

| `measure` | Compared against | May be called | Cannot see |
|---|---|---|---|
| `accuracy` | an **independent reference** (§4) for the same leaf | "quality", "CER", "accurate" | the reference's own errors (recorded per reference as `reference_error_rate`, hand-read) |
| `agreement` | **another engine's** output on the same leaf | "agreement with X" only | errors both engines share; **recitation** (engines agree on memorised text, #5093) |
| `stability` | the **same engine's** repeat read | "repeat stability" only | anything systematic (a model that always misreads ſ as f is perfectly stable) |
| `preference` | a **blind judge's** pairwise verdict (translation, §8) | "preferred by judge J on task T" | fidelity to source unless the judge packet is source-grounded (#5104) |

Rules:
- A surface (dashboard cell, EXPERIMENTS entry, issue comment, paper table) prints the `measure` word next to the number. Today the page (`src/app/platform/(protected)/admin/ocr-evidence/page.tsx`) says "Median error" and "Proxy" in a footnote and never "accuracy" or "agreement"; `benchmark-dashboard-data.mjs` will emit `measure` per cell, the page renders it, and a cell without it fails the JSON build (#5119).
- `agreement` and `stability` are **screening** signals: they can send pages to a human or to a reference queue; they cannot close a decision. The `.claude/docs/ocr-quality-measurement-loop.md` stability loop stays exactly that.
- The word *quality* appears in prose only with a citation to an `accuracy` cell.

## 3. One page registry across every study

### 3.1 The unit is the book

- One registry row is **one page of one book**. Two pages of the same book are one observation for any rate; the store enforces it by refusing a second page from a `book_id` in the same stratum unless the row is marked `repeat_of: <slug>` (used only for stability draws).
- Sample size per stratum is stated as **referenced books**, never pages. Grades keep the dashboard's existing thresholds (`thresholds` in `src/data/ocr-benchmark-evidence.json`): `exploratory` < 30, `directional` ≥ 30, `decision-grade` ≥ 50 referenced books and ≥ 50 untied pairs, `rate_n` 150 for quoting a corpus rate. The dashboard counts referenced *pages*; under the one-page-per-book rule (`lib/sampling.mjs sampleOnePagePerBook`) they are the same number, and the store makes that an invariant rather than a convention.

### 3.2 Strata are assigned from the page, not the catalogue

A registry row has two sets of stratum fields and both are required:

| Field | Source | Why both |
|---|---|---|
| `catalogue.language`, `catalogue.published`, `catalogue.text_role` | `books.*` at draw time | reproducibility of the draw; audit of catalogue error rates |
| `observed.script` (latin, greek, hebrew-square, hebrew-rashi, cjk-woodblock, cjk-manuscript, tibetan-dbu-can, syriac-estrangela, …), `observed.period` (print date of the leaf, or `unknown`), `observed.kind` (print / manuscript / tablet / mixed), `observed.canonical` (bool), `observed.by` (eye / classifier@version) | the page image, classified before any engine runs | 17/20 "Greek pre-1700" pages were Latin (#4884); a "1716" Hagakure was a reprint; Sumerian "1600s" is a museum number |

- A draw goes: sample the **book** from the catalogue stratum → pick an **interior** page (skip 15% front, 5% back — front matter lies) → classify the page by eye or classifier → the page enters the stratum its `observed.*` says, and the draw log records the catalogue→observed transition rate per stratum (a free measurement of catalogue error; #4884 got 4.6% Greek-majority from "Greek").
- `observed.canonical: true` means the text is one a model may have memorised (scripture, Kanjur, Perseus classics, Zohar). Canonical pages may be referenced, but a stratum's decision-grade count is taken over **non-canonical** pages first; a cell that is decision-grade only with canonical pages is labelled `canonical-dependent`.
- Script-class strata exist where routing or withholding differs by script inside a language: `hebrew-rashi` vs `hebrew-square`, `cjk-woodblock` vs `cjk-manuscript`, `tibetan-print` vs `tibetan-manuscript`, `latin-manuscript` vs `latin-print`, `japanese-kuzushiji` vs `japanese-print`.

### 3.3 Sizing from live pages at stake

`referenced_books_needed` per stratum is computed from the gap table (§11) and the decision it feeds: a cell that gates a routing change over ≥ 100K live pages is sized for decision-grade; one under 20K pages for directional; a stratum with no pending decision is `exploratory` and gets references only when a source is free.

### 3.4 Sealing and the reserve (#3499)

- A stratum file is sealed once (`sealed_at`, `seed`, `draw_rule`) as today (`scripts/eval/benchmark/*.json`, `benchmark-seal.mjs`). A sealed page is never re-drawn; a defective page (wrong leaf, blank, unreadable scan) is **marked** `excluded: <reason>` and a spare is promoted, so the history stays.
- Every registry row carries `reserve: true|false`. Reserve rows' **reference text** is never exported, never posted in an issue, never deposited (HF/Zenodo, `deposit-*` scripts), and never used in a training or fine-tuning set; only scores leave. The dataset exporters (`export-eval-dataset.mjs`, `scripts/eval/dataset/`) and the `/licensing` corpus export must read this flag — that is the enforcement #3499 lacks, tracked as its own follow-up.
- `published_text: <date>|null` records when a page's *transcription* became public on the site, so a future study can segment "possibly in training corpora" from "not".

### 3.5 Registry layout

Keep the per-stratum JSON files (they are the sealed artefacts) and add one derived index, `scripts/eval/registry/pages.jsonl`, rebuilt by a script from the stratum files plus the reference and observation directories. One line per page:

```
slug, book_id, page_number, image_url, provider,
catalogue{language, published, text_role, languages[]},
observed{script, period, kind, canonical, by, at},
stratum, substratum, sealed_at, seed, spare, excluded,
reserve, published_text,
reference{id|null}, leaf_check{status, by, at},
repeat_of
```

Slugs stay as today (`greek-da99cc-p426`). External pages (Wikisource-hosted scans, `ws-*`) are allowed in the index with `book_id: null` and `origin: external`; they never count toward a library stratum's grade (§11 shows why: all 77 Latin "reference pages" are external today).

## 4. References: what the truth is

### 4.1 Reference record

One record per reference, in `scripts/eval/benchmark/refs/<slug>.json` (+ `.txt` as today), with these fields required:

```
slug, source (wikisource-la | perseus | first1k | kanripo | cbeta | sefaria | gretil |
        bdrc | etcbc-peshitta | ia-djvu | gutenberg | human-transcription | …),
source_url, source_revision (commit / oldid / fetch date),
licence (spdx or "unknown"),        # ETCBC Peshitta is CC BY-NC; unknown blocks export
unit {kind: page|column|leaf|window, chars},   # a whole-volume "page" is degenerate
alignment {method, window_chars, overlap, guard},
leaf_check {status: ok|shifted|wrong-work|unchecked, by, at, note},
canonical (bool), memorization_risk (none|low|high),   # names as in dataset/v0.x references.jsonl
made_by {engine|human, model, prompt_hash, finish_reason}   # for model-made references
reference_error_rate {n_hand_read, errors, by, at} | null
```

Rules that follow:
- **No reference without a leaf-identity check.** `leaf_check.status != ok` keeps the page out of every accuracy cell (Praetorius #4732; the 197 held IA books #3368; the offset calibration that hid #3368). The check is a human looking at image and text once, or the pairing script (`reocr-pairing-check.mjs`) with its result recorded.
- **A reference unit must be a leaf-sized unit.** `unit.chars` above `max_width` for the script (the registry's `max_width`) is rejected: one Derge "page" was a whole volume and turned alignment into subsequence matching.
- **Licence is a field, not a footnote.** `unknown` or `NC` licences are usable for scoring and blocked from any export.
- **Model-made references record their refusals.** `finish_reason` and length ratio are kept; RECITATION refusals cluster on the cleanest print, so a model-made reference set is biased hard and the bias is measured per band, not dropped.
- **Non-canonical first** (`non_canonical`, `memorization_risk` already exist on `dataset/v0.x` references and `ground-truth/` entries; the registry adopts those names). Where a language's e-texts are scripture (Syriac, Hebrew, Tibetan, Pali, Sanskrit), the acquisition queue (§4.2) prefers pages the source *does not* cover — apparatus, commentary, colophons, later authors — and references them by hand.
- **Reference error rate is measured, not assumed.** 20 hand-read pages per source give `reference_error_rate`; an engine cannot be scored below the reference's own error.

### 4.2 Acquisition pipeline

A queue file, `scripts/eval/registry/reference-queue.jsonl`, ordered by (live pages at stake × decision pending) ÷ cost per referenced page. Each entry names the stratum, the cheapest source tried first, and the cost class. The sources, cheapest first:

1. **Held e-text of the same edition** (Wikisource *of our scan*, Kanripo/CBETA, Perseus/First1K, GRETIL, Sefaria, BDRC, CAMENA, Deutsches Textarchiv, ITKC): align to our page (`refresh-ws-references.mjs`, `build-reference-groundtruth.mjs`), human QA of leaf identity and alignment ≈ 3 min/page.
2. **IA/Gallica delivered text** as a *screening* reference only (IA CER median 3.9% in accepted bands, 5.4% wrong-page delivery, #4790): never an accuracy reference, useful for leaf checks.
3. **Human transcription** — print ≈ 20 min/page; manuscript ≈ 45 min/page; specialist scripts (Rashi, kuzushiji, Syriac MS) by a reader of that script. The volunteer pool has strong Spanish/Dutch/French/German/Latin and none for Syriac/Japanese/Armenian (#4916), so specialist hours are paid or partnered.
4. **Agreement + invention** only as a proxy row, `measure: agreement`, never promoted to a reference.

Every queue entry becomes a reference record or a recorded skip (`skipped: no-e-text | rights | wrong-leaf | refused`) — absence is not failure, and a silent skip is.

## 5. One result store

### 5.1 Outputs (append-only)

`scripts/eval/store/outputs/<engine>/<YYYY-MM>.jsonl`, one line per (engine, page, run):

```
run_id, slug, engine, model, engine_version, prompt_id, prompt_hash,
params {thinking, temperature, max_tokens, batch: bool, context_given: hash|null},
outcome: text | refusal | truncated | loop | empty | error,
finish_reason, chars, text_hash, text_path,
cost_usd, latency_ms, at, by (session), issue
```

- **Outcome is an enum, never inferred from text.** Refusals, truncations (MAX_TOKENS), loops and empties are outcomes; they count in every rate as failed reads (a vanished loop is not a reading; a partial answer is a failed read). A run whose outputs are all `error` or `empty` is a **failed run** whatever the job status said.
- **Provenance is written, not documented.** `prompt_hash` is the hash of the prompt actually sent; production's prompt is stamped as an arm (#4932); `params.thinking` and `temperature` are recorded because production does not record them (#4613, the open gap in `data-provenance.md`). A missing value is written as `null` with `provenance_captured: false`, so "predates writer" is distinguishable from "lost".
- **Translation runs record their context.** `params.context_given` is the hash of the continuity text the page received (the context leaks into the page; the head/tail change lost 13–24).
- **Cost is a field**, summed per `run_id` and per issue; the store is the ledger the `EXPERIMENTS.md` entry quotes.
- The store is **never read by a production lane**. It is evidence for a human; §10 is the only path from a cell to a routing constant.

### 5.2 Scores (derived, versioned)

`scripts/eval/store/scores/<scorer>@<version>/<YYYY-MM>.jsonl`:

```
slug, engine, run_id, measure (accuracy|agreement|stability|preference),
against {reference_id | engine+run_id | judge_packet_id},
metric {cer, acc_windowed, acc_upper, bow, seq, invention, gap, lines_ratio, …},
scorer, scorer_version, fixtures_hash, normaliser_version, convention_table_version,
abstain: bool, abstain_reason, at
```

- Scores are **recomputable** from outputs + references; a scorer fix (the #4735 bug understated every published number) re-runs the scorer and writes a new version alongside, never over.
- `fixtures_hash` pins the per-script fixtures the scorer passed before scoring (§6). A scorer with no fixture for the page's `observed.script` writes `abstain: true, abstain_reason: no-fixture` — it does not score.
- `abstain` is a first-class value: an empty comparable set is UNJUDGED, not different.

### 5.3 Comparisons (never stored, always derived)

A comparison is a function over the store: `(engine A, engine B, stratum, measure)` → the **shared** pages where both have a scorable outcome → wins/losses/ties, median Δ, bootstrap CI, sign-test p (`lib/paired-stats.mjs`), untied pairs, and the grade from referenced *books*. `benchmark-dashboard-data.mjs` already computes this as `paired_vs_production`; §7 makes it the only comparison that is shown. The metrics kernel stays `lib/metrics.mjs` (`scoreAgainstReference`, the two-stage identity guard); §5.2 adds versioning around it, not a new scorer.

## 6. Instruments: the scorer is also under test

- **Fixtures per script before any score.** `scripts/eval/fixtures/` holds one unrelated file today; it becomes `scripts/eval/fixtures/<script>/` holding (reference, corrupted, expected-metric) triples covering: combining marks (Devanagari, Syriac, Ethiopic — the tokenizer shredded them), tag conventions (`->TITLE<-` ate a page body), long-s and ligatures, RTL, vertical CJK, leader dots and nbsp runs, bracketed editorial markers, dhāraṇī/mantra syllable runs. A scorer version is usable for a script only if its fixtures pass; the store records the `fixtures_hash`.
- **Positive control from the input's shape.** Each stratum keeps a noised-reference control at the *page length and span distribution of the inputs* (two-leaf folios included), not the reference's; the control's score is on the dashboard cell. A control that scores 0.97 while real folios cap at 0.5 shares the blind spot and is not a control.
- **Every probe reports its positive control** before its "not found" is a finding.
- **Structure alongside similarity.** For every page: lines vs the book's modal line count, length ratio, and a fixed-position omission check (order-free identity cannot see a dropped first line, 4/8 Yigdzin pages at identity 0.943).
- **Two-population gates.** A gate over one score reads its below-threshold items before it is trusted; `bow − seq` separates "apparatus drags the median" from "scrambled".
- **Conventions table.** `scripts/eval/lib/conventions.json`: per engine, the systematic differences that are not errors (NDL inline kunten, Kraken Syriac line order, Surya column merges) with the normaliser rule that neutralises each; `convention_table_version` is on every score. A new engine is diffed by eye on two known-good pages before it is scored.
- **Hand-read precision before any rate.** A class an instrument flags (loops, fabrications, drift) gets 20 hand-read members and a recorded precision before its count is quoted (74% of "950,222 fabricated citations" was the verifier).
- **Segment by source.** Anything read from `page_revisions` is split by `source` first (`.claude/docs/data-provenance.md`); anything comparing processed vs unprocessed populations states what ordered the processing.

## 7. Paired by default

- An engine-vs-engine number is **only** computed on shared pages (§5.3). The dashboard cell shows `wins–losses–ties (n books)`, median Δ with CI, and the grade; the unpaired median per engine is shown only greyed, under the paired block, labelled "on its own pages, not comparable".
- Every A/B has an **A-vs-A arm first**: the same engine and prompt twice, reported as the noise floor next to the A/B margin. A non-inferiority bound is stated relative to that floor (production failed its own −5pp bound at n=17).
- Comparing a swept population against an unswept one is not an A/B; it measures the sweep's order.
- The grade is by **books**, the CI by pages-as-books; `rate_n` (150) applies before a corpus *rate* is quoted.
- A comparison over a stratum whose `catalogue→observed` transition rate is unknown is labelled `catalogue-stratum` on the surface.

## 8. Translation's parallel design

Translation shares the registry (same books, same interior-page rule, same reserve) and adds:

- **Reference where humans translated**: 84000 (Tibetan, 2,679 pages), Loeb/Perseus English, published scholarly translations we hold — `reference.kind: human-translation`, licence recorded; scored as `accuracy` on fidelity metrics only (verified-note rate, source-grounded omission/addition counts), never on fluency.
- **Blind pairwise judging** (`preference`): every packet contains a **same-arm control** (byte-identical pairs) and its tie rate is read first (`translation-page-break-fix-ab.mjs` and `translation-batch-shadow-judge.mjs` already do this; `translation-model-ab.mjs` does not, #5127); pairs are emitted once each with their own seed and merged (a regenerated packet shifted a shared PRNG stream and invalidated 59/114 keys); the packet pins `text_hash` of exactly what each judge saw (#4681's seam draws were mislabelled — the judges read the plain draft); the judge is validated on the **deployed task format**, not a simplified one; a source-grounded fidelity judge (#5104) is run alongside a fluency judge, and a fluency win with a fidelity loss is a loss.
- **Page-boundary detectors** as standing scores (`scripts/lib/block-drift.mjs`, `scripts/audit/translation-page-boundaries.mjs`, #5021): drift, forward duplicate, context leak (shared run ≥ 200 chars with the previous page), each with its hand-read precision on 20 and its single-page-lane noise floor.
- **Context is recorded** per run (`params.context_given`), and echo/short gates (#5089) are outcomes, not silent drops.
- OCR and translation keep separate designs for the *reference* (a transcription vs a translation) and share everything else; `.claude/docs/ocr-translation-eval-landscape.md` remains the rationale.

## 9. Landing rule

A run is **done** when all four are true, and the EXPERIMENTS entry links each:

1. Outputs and scores are on `main` in the store (§5), with `run_id` and cost.
2. `scripts/eval/EXPERIMENTS.md` has an entry in its existing format (date · question · design · result · replicated? · artifact), plus `run_id`, sample in books, `measure`, grade, decision taken or deferred, and cost.
3. The dashboard JSON is regenerated (`benchmark-dashboard-data.mjs`) and the cell shows the run.
4. The issue has the result posted, with the cell id.

Checks (follow-up issues; design here):
- **Stranded-results check** (weekly, Hetzner or Actions): for every worktree in `.claude/worktrees/`, untracked or unpushed files under `scripts/eval/results/` or `scripts/eval/store/` older than 3 days → one issue comment on the run's issue, or a new `eval` issue if none. Two paid studies sat two weeks in dead worktrees.
- **Conflict-marker check**: CI fails on `^(<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)` in `EXPERIMENTS.md` and in `scripts/eval/store/**`.
- **Store schema check**: every appended line validates against §5 (required fields, `measure` enum, `outcome` enum, `book_id` uniqueness per stratum).
- **Zero-output check**: a `run_id` with no `outcome: text` rows is marked `failed` in the run index.
- **Checkpoint rule**: any corpus walk feeding the store writes a checkpoint every 100K items and materialises its id list before slow work.

## 10. From evidence to decision

1. A cell reaches the grade its decision needs (§3.3) with a paired result (§7) and its five worst pages read by eye (#4735 rule 5).
2. The session opens an issue **proposing** the change (routing constant, specialist lane, withholding rule), quoting the cell id, the paired table, the noise floor and the cost delta per year. It does **not** change `LATIN_SCRIPT_LANGUAGES` (`scripts/lib/translate-core.mjs`, imported by `scripts/lib/ocr-routing.mjs`, parity pinned by `tests/unit/translate-core-parity.test.ts`), an allowlist, or a lane.
3. **Derek signs off** on any spend-affecting or reader-facing change (a comment on that issue). Settled decisions (Syriac → Kraken lane, #4883; translation non-Latin → lite, #4762) are not reopened by a new cell unless the cell is decision-grade and the issue says what changed.
4. The change lands in its own PR, citing the cell id in the commit; the routing constant's comment cites it too.
5. After the change, the stability loop watches the affected stratum for 30 days (a free signal; not a quality claim).
6. The store is never read by a production lane; a job that wants to act on eval evidence goes through steps 2–4. Writing to a store a job reads is actuation (`ingest_is_actuation`).

## 11. Gap table (measured 2026-09-25)

Source: Atlas `books` (live = `visible && pages_count > 0`, 41,928 books, 8,806,456 pages), stratified by **catalogue** language × period (§3.2 says these are not the final strata; page classification is the first step of every row). Reference counts are from `scripts/eval/benchmark/*.json` + `refs/` (library pages) and `scripts/eval/results/benchmark/ref-ws-*/ref-pinned-*` (external Wikisource-hosted scans and pinned canonical pages). Grades use the dashboard thresholds (30 / 50 referenced books). Cost model: per referenced page, model spend ≈ $0.02 (production lite + flash + two specialists; #4925 puts seven decisions at ≈ $10 API); human time 3 min/page when an e-text aligns (assumed 70% of draws), else 20 min/page print or 45 min/page manuscript. Scripts and raw outputs: `.claude/docs/eval-design-census/` (snapshot; #5121 turns it into `scripts/eval/registry/`).

Two findings before the table:
- **Most Latin and German "reference pages" today are external, and none of them are the sealed registry pages.** Of the 77 Latin references the dashboard counts, 65 are Wikisource-hosted scans (`ws-la-*`, `results/benchmark/ref-ws-*`, no `book_id`) and 12 are pinned library pages from `ground-truth/` (canonical passages, year unrecorded). The sealed Latin strata (`latin-pre1700`, `latin-1700s`, 44 pages) have **no reference** and are scored against a proxy. The Latin per-century figures (10 / 11 / 12 for the 1500s–1700s) are external pages. English and French have none of either kind.
- **The local mirror's `visible` flag is stale**: it reports 57,399 live books / 12.4M pages against Atlas's 41,928 / 8.8M (the mirror is from 2026-09-10 and keeps since-hidden books). Corpus counts for evals come from Atlas `books` (cheap) until the mirror refresh carries `visible`.

| Language | Period (catalogue) | Live books | Live pages | Registry refs (library pages) | Pinned refs (library pages, year unrecorded) | External refs (Wikisource scans) | To directional (30) | To decision-grade (50) | Cheapest reference source | Est. cost to decision-grade |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Chinese | unknown | 11,636 | 1,755,013 | 73 | 6 | 0 | 0 | 0 | Kanripo / CBETA / ctext (held) | $0.00 + 0.0 h |
| Latin | 1500s | 3,179 | 929,551 | 0 | 0 | 10 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| Latin | 1600s | 3,214 | 789,365 | 0 | 0 | 11 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| Latin | unknown | 6,990 | 491,083 | 0 | 12 | 0 | 18 | 38 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $0.76 + 5.1 h |
| English | 1800s | 917 | 366,570 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| German | 1700s | 847 | 326,007 | 0 | 0 | 9 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| Latin | pre-1500 | 1,405 | 322,788 | 0 | 0 | 2 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| English | 1900+ | 963 | 305,595 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| Tibetan | unknown | 1,440 | 276,691 | 0 | 0 | 0 | 30 | 50 | BDRC/ACIP e-texts (canonical → recitation risk); hand transcription for non-canonical | $1.00 + 13.0 h |
| Latin | 1700s | 676 | 253,199 | 0 | 0 | 12 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| Latin | 1800s | 342 | 166,081 | 0 | 0 | 30 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| German | 1600s | 731 | 163,816 | 0 | 0 | 0 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| Greek | 1800s | 254 | 135,844 | 5 | 0 | 23 | 25 | 45 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $0.90 + 6.1 h |
| English | 1700s | 357 | 128,503 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| Greek | 1500s | 246 | 115,354 | 59 | 0 | 0 | 0 | 0 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $0.00 + 0.0 h |
| Italian | 1500s | 320 | 108,184 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| German | 1800s | 299 | 104,729 | 0 | 0 | 20 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| French | 1700s | 280 | 97,816 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| English | 1600s | 311 | 93,229 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| Chinese | 1700s | 559 | 85,245 | 11 | 0 | 0 | 19 | 39 | Kanripo / CBETA / ctext (held) | $0.78 + 5.3 h |
| Greek | pre-1500 | 171 | 75,512 | 5 | 0 | 0 | 25 | 45 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $0.90 + 6.1 h |
| French | 1800s | 181 | 75,470 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| German | 1500s | 333 | 74,453 | 0 | 0 | 1 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| French | 1600s | 178 | 72,465 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| Dutch | 1600s | 265 | 68,381 | 0 | 0 | 0 | 30 | 50 | DBNL (rights vary) / nl.wikisource | $1.00 + 6.8 h |
| Greek | 1900+ | 158 | 67,502 | 0 | 0 | 2 | 30 | 50 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $1.00 + 6.8 h |
| Greek | unknown | 194 | 60,356 | 0 | 17 | 0 | 13 | 33 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $0.66 + 4.5 h |
| Russian | 1800s | 112 | 52,948 | 0 | 0 | 0 | 30 | 50 | ru.wikisource (pre-1918 orthography editions) | $1.00 + 6.8 h |
| Dutch | 1700s | 190 | 46,795 | 0 | 0 | 0 | 30 | 50 | DBNL (rights vary) / nl.wikisource | $1.00 + 6.8 h |
| Russian | 1900+ | 126 | 46,654 | 0 | 0 | 0 | 30 | 50 | ru.wikisource (pre-1918 orthography editions) | $1.00 + 6.8 h |
| Latin | 1900+ | 104 | 42,978 | 0 | 0 | 0 | 30 | 50 | la.wikisource / CAMENA (neo-Latin) / PHI+Perseus (canonical → recitation risk) | $1.00 + 6.8 h |
| Sanskrit | 1900+ | 126 | 38,568 | 0 | 0 | 0 | 30 | 50 | GRETIL / SARIT (canonical → recitation risk); Devanagari print needs fixtures | $1.00 + 6.8 h |
| German | 1900+ | 113 | 36,969 | 0 | 0 | 0 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| Greek | 1600s | 68 | 35,603 | 6 | 0 | 0 | 24 | 44 | Perseus / First1KGreek (held, canonical) → prefer non-canonical: scholia, PG columns | $0.88 + 5.9 h |
| Chinese | 1600s | 299 | 34,685 | 2 | 0 | 0 | 28 | 48 | Kanripo / CBETA / ctext (held) | $0.96 + 6.5 h |
| Sanskrit | 1800s | 120 | 33,065 | 0 | 0 | 0 | 30 | 50 | GRETIL / SARIT (canonical → recitation risk); Devanagari print needs fixtures | $1.00 + 6.8 h |
| German | unknown | 317 | 32,249 | 0 | 7 | 0 | 23 | 43 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $0.86 + 5.8 h |
| French | 1500s | 104 | 31,975 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| French | 1900+ | 60 | 25,435 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| Korean | 1800s | 60 | 24,138 | 0 | 0 | 0 | 30 | 50 | ITKC 한국고전종합DB (hanja/hangul mixed) | $1.00 + 6.8 h |
| Sanskrit | unknown | 108 | 23,863 | 0 | 0 | 0 | 30 | 50 | GRETIL / SARIT (canonical → recitation risk); Devanagari print needs fixtures | $1.00 + 6.8 h |
| English | 1500s | 87 | 23,590 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| Hebrew | unknown | 98 | 21,981 | 0 | 4 | 0 | 26 | 46 | Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings | $0.92 + 6.2 h |
| Chinese | 1800s | 131 | 21,963 | 0 | 0 | 0 | 30 | 50 | Kanripo / CBETA / ctext (held) | $1.00 + 6.8 h |
| English | unknown | 121 | 21,613 | 0 | 0 | 0 | 30 | 50 | en.wikisource / Gutenberg (page-aligned via IA djvu where held) | $1.00 + 6.8 h |
| Italian | 1600s | 74 | 20,477 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| Arabic | pre-1500 | 74 | 18,718 | 0 | 0 | 0 | 30 | 50 | OpenITI / Shamela (typeset modern → weak for manuscript); hand transcription for MS | $1.00 + 13.0 h |
| Korean | unknown | 116 | 18,687 | 0 | 0 | 0 | 30 | 50 | ITKC 한국고전종합DB (hanja/hangul mixed) | $1.00 + 6.8 h |
| Chinese | 1500s | 100 | 17,849 | 5 | 0 | 0 | 25 | 45 | Kanripo / CBETA / ctext (held) | $0.90 + 6.1 h |
| Syriac | 1800s | 32 | 17,253 | 0 | 0 | 0 | 30 | 50 | ETCBC Peshitta (CC BY-NC, canonical); Digital Syriac Corpus; Kraken lane already measured (#5093) | $1.00 + 13.0 h |
| Italian | 1800s | 45 | 16,444 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| Syriac | 1900+ | 25 | 16,237 | 0 | 0 | 0 | 30 | 50 | ETCBC Peshitta (CC BY-NC, canonical); Digital Syriac Corpus; Kraken lane already measured (#5093) | $1.00 + 13.0 h |
| Arabic | 1800s | 42 | 14,373 | 0 | 0 | 0 | 30 | 50 | OpenITI / Shamela (typeset modern → weak for manuscript); hand transcription for MS | $1.00 + 13.0 h |
| Armenian | 1800s | 26 | 13,843 | 0 | 0 | 0 | 30 | 50 | Digilib (AUA) / hy.wikisource; pinned refs exist (9) | $1.00 + 6.8 h |
| Japanese | 1900+ | 25 | 13,583 | 0 | 0 | 0 | 30 | 50 | NDL digital / Aozora (Meiji+); pre-1868 kuzushiji needs hand transcription | $1.00 + 13.0 h |
| Italian | pre-1500 | 47 | 13,559 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| German | pre-1500 | 57 | 12,634 | 0 | 0 | 0 | 30 | 50 | de.wikisource (held, 30 external pages) / Deutsches Textarchiv | $1.00 + 6.8 h |
| French | unknown | 55 | 12,314 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| Arabic | unknown | 90 | 11,904 | 0 | 0 | 0 | 30 | 50 | OpenITI / Shamela (typeset modern → weak for manuscript); hand transcription for MS | $1.00 + 13.0 h |
| Korean | 1700s | 37 | 10,432 | 0 | 0 | 0 | 30 | 50 | ITKC 한국고전종합DB (hanja/hangul mixed) | $1.00 + 6.8 h |
| Italian | 1700s | 38 | 10,088 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| Hebrew | 1500s | 28 | 9,917 | 0 | 0 | 0 | 30 | 50 | Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings | $1.00 + 6.8 h |
| Spanish | 1600s | 28 | 9,409 | 0 | 0 | 0 | 30 | 50 | es.wikisource / Biblioteca Virtual Cervantes | $1.00 + 6.8 h |
| Hebrew | 1600s | 36 | 8,250 | 0 | 0 | 0 | 30 | 50 | Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings | $1.00 + 6.8 h |
| Hebrew | 1800s | 20 | 7,843 | 0 | 0 | 0 | 30 | 50 | Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings | $1.00 + 6.8 h |
| Italian | 1900+ | 34 | 7,767 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| Dutch | 1500s | 36 | 7,718 | 0 | 0 | 0 | 30 | 50 | DBNL (rights vary) / nl.wikisource | $1.00 + 6.8 h |
| Chinese | 1900+ | 27 | 7,560 | 2 | 0 | 0 | 28 | 48 | Kanripo / CBETA / ctext (held) | $0.96 + 6.5 h |
| Arabic | 1900+ | 27 | 6,909 | 0 | 0 | 0 | 30 | 50 | OpenITI / Shamela (typeset modern → weak for manuscript); hand transcription for MS | $1.00 + 13.0 h |
| Italian | unknown | 32 | 6,848 | 0 | 0 | 0 | 30 | 50 | it.wikisource / Biblioteca Italiana (LiberLiber) | $1.00 + 6.8 h |
| Chinese | pre-1500 | 40 | 6,738 | 3 | 0 | 0 | 27 | 47 | Kanripo / CBETA / ctext (held) | $0.94 + 6.3 h |
| Dutch | 1900+ | 31 | 6,664 | 0 | 0 | 0 | 30 | 50 | DBNL (rights vary) / nl.wikisource | $1.00 + 6.8 h |
| Hebrew | 1700s | 23 | 6,661 | 0 | 0 | 0 | 30 | 50 | Sefaria (canonical → recitation risk); Rashi script: hand transcription of non-canonical printings | $1.00 + 6.8 h |
| Spanish | 1500s | 20 | 5,951 | 0 | 0 | 0 | 30 | 50 | es.wikisource / Biblioteca Virtual Cervantes | $1.00 + 6.8 h |
| Sumerian | 1600s | 373 | 5,759 | 0 | 0 | 0 | — | — | exclude: cuneiform tablets, transliteration not OCR; "1600s" is a museum-number artefact | — |
| French | pre-1500 | 23 | 5,455 | 0 | 0 | 0 | 30 | 50 | fr.wikisource / Gutenberg / Gallica ALTO where we hold the same scan | $1.00 + 6.8 h |
| Latin-German | 1600s | 36 | 5,327 | 0 | 0 | 0 | 30 | 50 | de.wikisource + la.wikisource | $1.00 + 6.8 h |
| Korean | 1600s | 20 | 4,688 | 0 | 0 | 0 | 30 | 50 | ITKC 한국고전종합DB (hanja/hangul mixed) | $1.00 + 6.8 h |
| Japanese | 1800s | 46 | 4,499 | 0 | 0 | 0 | 30 | 50 | NDL digital / Aozora (Meiji+); pre-1868 kuzushiji needs hand transcription | $1.00 + 13.0 h |
| Unknown | unknown | 27 | 4,358 | 0 | 0 | 0 | — | — | classify the pages first (page-level script class), then route | — |
| Egyptian hieroglyphs | 1900+ | 29 | 2,325 | 0 | 0 | 0 | — | — | exclude: not an OCR lane | — |
| Japanese | 1600s | 30 | 1,696 | 0 | 0 | 0 | 30 | 50 | NDL digital / Aozora (Meiji+); pre-1868 kuzushiji needs hand transcription | $1.00 + 13.0 h |
| Javanese | unknown | 37 | 467 | 0 | 0 | 0 | — | — | exclude for now (37 books, 467 pages) | — |
| Egyptian hieroglyphs | pre-1500 | 54 | 196 | 0 | 0 | 0 | — | — | exclude: not an OCR lane | — |
| Egyptian hieroglyphs | unknown | 36 | 160 | 0 | 0 | 0 | — | — | exclude: not an OCR lane | — |

Totals over the 85 strata: 3771 referenced library pages to bring every non-excluded stratum to decision-grade; ≈ $75 model spend and ≈ 572 human hours under the cost model above.

Reading the table:
- **English** (940K live pages, 0 references, routed to lite) and **French** (321K, 0) are the largest unmeasured decisions; both have free e-texts (Wikisource, Gutenberg) and IA djvu page alignment for editions we hold. First reference strata: English 1600s–1800s, French 1600s–1800s.
- **Latin 1500–1799** (1.97M live pages, 0 library references) is where lite degrades (flash ~0.7% vs lite 3–5% CER on the external pages); CAMENA and la.wikisource cover a fraction; the rest is Latinist transcription (#4925 decision 5: ~17 h).
- **Rashi**: no catalogue stratum exists. ≈ 111 live Hebrew books (≈ 35K pages) plausibly carry Rashi script by title (Zohar Cremona/Mantua 1558, Mikraot Gedolot 1517, Talmud, commentaries) — a title heuristic, to be replaced by page classification. Sefaria covers the canonical commentaries (recitation risk high); the non-canonical printings need a reader of Rashi script at ≈ 20 min/page.
- **Chinese** is decision-grade already (73 library references, Kanripo/CBETA), but almost entirely in the `unknown` period bucket — 11,636 books have no parseable date, so the period axis is meaningless for CJK until pages are classified.
- **Tibetan** (290K live pages, 1,439 books held pending retranslation) has 0 references in the registry; the 84000 human translations are the translation reference (#4925 decision 7), and OCR references must be non-canonical (recitation passed e-text checks at 96%).
- Excluded from the OCR lane: Sumerian (tablets; the "1600s" is a museum number), Egyptian hieroglyphs, Javanese (467 pages), `Unknown`/`auto-detect` (classify first).

## 12. Migration plan (no paid work rerun)

| Existing artefact | Becomes | How |
|---|---|---|
| `scripts/eval/benchmark/*.json` (13 sealed strata, 662 pages; the file is the seal, no hash) | registry stratum files, unchanged | index builder reads them; adds `observed.*` from `benchmark/script-class/*.json` (362 pages classified by eye) where present, else `observed.by: null` and the page is `catalogue-stratum` until classified (#5122) |
| `benchmark/refs/*.json|txt` (360 records, 242 with text) | reference records | schema fill-in: `licence` (from `reference-sources.json`), `leaf_check: unchecked`, `unit.chars` from the text, `canonical` from source (Perseus/CBETA/Kanripo → true); pages with `.json` but no `.txt` become `skipped: <reason>` |
| `results/benchmark/<stratum>-<date>.json` (23 files) | store outputs + scores | one converter: each page×engine block → an `outputs` line (`outcome` from `empty`/`loop`/`missing`/text; `prompt_hash: null, provenance_captured: false`) and a `scores` line (`measure: accuracy` if `has_ref`/`tier` else `agreement`, `scorer: benchmark-score@<git sha of the run date>`) |
| `results/benchmark/ref-ws-*`, `ref-pinned-*` | store rows with `origin: external` | same converter; never counted in a library stratum's grade |
| `src/data/ocr-benchmark-evidence.json` | regenerated from the store | `benchmark-dashboard-data.mjs` reads the store instead of the results files; `paired_vs_production` stays, `measure` added per cell |
| Per-language lite study (#5090, `per-language-suitability.mjs`, results) | store rows, `measure: agreement`, engines lite vs flash | converter; the cells are labelled agreement on the dashboard and can never read as quality again |
| Syriac vs published (#5093, `scripts/eval/syriac-vs-published/`) | reference records (`source: published-edition`, `canonical: true`, `recitation_risk: high`) + store rows for the Kraken lane and Gemini reads, `outcome` from the wrong-passage classification | converter; the "19% right passage" result becomes an accuracy cell with `canonical-dependent` |
| `scripts/eval/dataset/v0.*`, `observations/` (#3235) | a **view** over the store, exported by `export-eval-dataset.mjs` honouring `reserve` and `licence` (its licence policy — include / pointer-only with `reference_sha256` — is kept) | no data moves; `build-observations.mjs` re-scores at build time today and keeps doing so from store outputs; `v0.4-difficulty` stays reference-free by design |
| `ground-truth/` (55 pinned library pages), `ground-truth-ws/` (121 external), `reference-works/*.json` | reference records (`origin: library` / `external`), `leaf_check: unchecked` until read | index builder; the `_note` and `page_class` fields carry over |
| Translation A/B packets (`translation-*-ab.mjs`, judge outputs) | store `outputs` (arm texts, `context_given`) + `scores` with `measure: preference`, `against.judge_packet_id`, same-arm tie rate per packet | converter per script; packets without pinned text hashes are imported with `text_hash: null` and marked `unpinned` |
| `EXPERIMENTS.md` (2,034 lines) | unchanged, plus a `run_id` per entry going forward | back-fill `run_id` only where the converter can match a results file |
| `PREREGISTRATION-*.md` (8) | unchanged; new ones add the §7 A-vs-A arm and the §3 sizing line | template update |

Order: index builder → reference schema fill → results converter → dashboard reads the store → dataset exporter reads the store → checks. Each is one PR; none reruns a model.

## 13. Past challenges → mechanism

Each row names the mechanism that prevents the failure by construction; "accepted risk" says why not.

| Challenge (lesson / issue) | Mechanism | Where |
|---|---|---|
| Pages in a book counted as N observations (`sample_one_page_per_book`) | one `book_id` per stratum enforced by the store; grades in books | §3.1, §5 |
| Catalogue year/language is the work's, not the leaf's (`catalogue_year_is_the_works_date_classify_the_page`, #4884) | `observed.*` required; `catalogue-stratum` label until classified; transition rate logged | §3.2 |
| `books.language` is the edition's; IA mistags non-Latin (`language_field_is_edition_not_source`, `ia_nonlatin_language_mistag`) | `catalogue.text_role` and `languages[]` recorded; strata from `observed.script` | §3.2 |
| Front matter lies (`ocr_field_is_an_object_and_front_matter_lies`) | interior-page draw rule (skip 15% / 5%); `ocr.data` in every reader | §3.2 |
| Cohort label tracks the import batch (`cohort_label_proxy_tracks_ingest_not_content`) | strata from content fields only; the share the instrument can score is on the cell | §3.2, §6 |
| Recitation defeats agreement (#5093, #350, `tibetan_lite_ocr_fails`) | `observed.canonical`, `recitation_risk`; non-canonical first; `canonical-dependent` label; agreement never closes a decision | §2, §3.2, §4 |
| Reference reads refused on clean print (`eval_reference_reads_get_refused_on_clean_print`) | `made_by.finish_reason` kept; refusals a line item per band | §4.1 |
| Wrong-leaf references (#4732, #3368, `ia_leaf_offset_is_always_zero_calibration_masked_3368`) | `leaf_check` required; non-ok excluded; non-zero offsets are a defect, never a calibration | §4.1 |
| Degenerate reference unit; window span cap (`degenerate_reference_unit…`, `alignment_identity_capped_by_window_span`) | `unit.chars` ≤ `max_width`; control spans the input's max span | §4.1, §6 |
| Scorer bug understated every number (#4735); tag stripper ate the body; tokenizer shredded combining marks | fixtures per script; `scorer_version` + `fixtures_hash` on every score; scores recomputed, never overwritten | §5.2, §6 |
| Positive control shares the blind spot; probe needs a control | control from input shape; every probe reports its control | §6 |
| Order-free identity misses a fixed-position omission; one gate hides two populations | structure checks alongside similarity; two-population read below threshold | §6 |
| Engine conventions read as errors | conventions table, versioned, applied by the normaliser | §6 |
| Repeat-metric false positives are typography; dhāraṇī false marks | normaliser fixtures (leader dots, nbsp, markers); mantra rule in the conventions table | §6 |
| Vanished symptom is not a capability; partial answer is a failed read | `outcome` enum; refusals/truncations/loops counted as failed reads | §5.1 |
| Empty comparable set is not disagreement | `abstain` on scores | §5.2 |
| Precision is not accuracy (#4777) | 20 hand-read members and recorded precision before a count is quoted | §6 |
| Judge cannot say TIE; regenerated packet broke keys; noise floor unmeasured; same-family "leniency" was task collapse | same-arm control per packet; per-pair seeds; pinned `text_hash`; A-vs-A arm first; judge validated on the deployed format | §7, §8 |
| Unpaired medians misled; swept vs unswept measures order | comparisons only on shared pages; processed-vs-unprocessed is not an A/B | §7 |
| `prompt_version` is three vocabularies; provenance documented not written (#4932) | `prompt_hash`, `params`, `provenance_captured` on every output; production prompt stamped as an arm | §5.1 |
| `page_revisions` mixes maintenance with reads | segment by `source` before any number | §6 |
| Continuity context leaks; head vs tail | `params.context_given`; leak detector as a standing score | §5.1, §8 |
| Batch success with every request cancelled; silent page gaps | zero-output check marks the run failed; outputs counted against pages | §5.1, §9 |
| Published text enters training corpora (#3499) | `reserve`, `published_text`; exporters honour the flag | §3.4 |
| Results stranded in worktrees; walks without checkpoints | landing rule; stranded-results check; checkpoint rule | §9 |
| Activity count is not a metric; measure usefulness before the third PR | every cell has a denominator (books) and a grade; the first store PR must show one decision the old files could not answer | §3.1, §12 |
| Eleven corrections caught by controls, not reasoning | controls, noise floor and hand-read precision are schema fields, so a result without them cannot be reported | §6, §7 |
| Ingest is actuation | the store is never read by a production lane; §10 is the only path | §5.1, §10 |
| Conflict markers in `EXPERIMENTS.md` | CI check | §9 |
| #350 closed without measurement | a claim closes an issue only with a cell id | §10 |
| Accepted risk: `observed.period` for undated CJK/Tibetan books stays `unknown` until a classifier exists | the period axis is reported as unknown, not guessed; a follow-up may add a date classifier | §11 |
| Accepted risk: human transcription hours for manuscripts (Latin MS, Arabic MS, kuzushiji, Syriac MS) are not free | queued by pages-at-stake; each is Derek's spend decision | §4.2, §11 |

## 14. Follow-up issues

Each is one PR; none makes a model call without a cost line and Derek's yes.

- #5119 — OCR evidence dashboard: paired comparison by default, `measure` label on every cell, unpaired medians greyed
- #5120 — Landing checks for measurement runs: stranded results in worktrees, conflict markers, zero-output runs
- #5121 — Registry index + append-only result store + converters for existing benchmark, per-language and Syriac results (no paid rerun)
- #5122 — Classify every sealed registry page from the image: observed script, period, kind, canonical
- #5123 — Scorer fixtures per script before any score: combining marks, tag conventions, long-s, RTL, vertical CJK, leader dots, mantra runs
- #5124 — First reference strata: English and French library pages from Wikisource / Gutenberg aligned to editions we hold
- #5125 — First reference stratum: Rashi script (Hebrew) — page classification, then non-canonical transcription
- #5126 — First reference stratum: Latin 1500–1799 library pages (CAMENA, la.wikisource, Latinist transcription)
- #5127 — Translation judge packets: same-arm control and pinned text hash in translation-model-ab.mjs
- #3499 — reserve enforcement (`reserve` flag honoured by the dataset and licensing exporters) stays on its own issue; this design adds the field (§3.4) and a comment there links it.

## 15. Links

Issues: #5106 (this design), #4735, #4925, #3499, #3235, #5090, #5093, #5021, #4884, #4932, #350, #3368, #4732, #4777, #4916, #4920, #4762, #4883, #5089, #5104. Docs: `.claude/docs/ocr-quality-measurement-loop.md`, `.claude/docs/ocr-translation-eval-landscape.md`, `.claude/docs/invariants/measurement-instruments.md`, `.claude/docs/data-provenance.md`, `.claude/docs/paper-corpus-certification-4916.md`, `.claude/docs/invariants/paired-artifacts.md`. Scripts: `scripts/eval/INDEX.md`, `benchmark-seal.mjs`, `benchmark-refs.mjs`, `benchmark-run-api.mjs`, `benchmark-score.mjs`, `benchmark-dashboard-data.mjs`, `per-language-suitability.mjs`, `scripts/eval/syriac-vs-published/`, `scripts/lib/block-drift.mjs`, `scripts/audit/translation-page-boundaries.mjs`, `translation-model-ab-JUDGE-PROMPT.md`. Lessons: `~/.claude/projects/-Users-dereklomas-sourcelibrary/memory/lesson_*.md` as named in §13.
