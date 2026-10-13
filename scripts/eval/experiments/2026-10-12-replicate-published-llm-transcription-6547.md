---
stage: ocr
measure: accuracy
languages: [de, en]
scripts: [Latn]
canons: []
n_books: 43
n_pages: 63
verdict: "Greif et al. replicates through our CLI route: Gemini 3.1 Pro via agy reads the 30 city-directory pages at 0.79% normalised CER (their API run 0.77%; paired difference +0.02 points, 95% CI −0.03 to +0.07) and corrects the Transkribus draft to 0.75% (theirs 0.80%). The three Humphries results are not testable: their 50-document set is unpublished. On the nearest public set, Bentham R0 (33 pages), reader disagreement flagged 10% of words and covered 59% of Pro's errors (theirs 4% / 76%). A model resolver did not beat the primary reader except on the one page Pro invented."
status: informational
decision: "No routing change. For #6544: the CLI route costs nothing measurable on Pro; Gemini CLI reads of handwriting need the restart/duplicate check and the view_file log, because 5 of 66 Gemini reads wrote the page twice and 1 was invented without the image being opened."
superseded_by: null
issue: [6547, 6544, 6523]
---
PRIOR ART: the published papers and their own data and code (Greif: github.com/niclasgriesshaber/llm_historical_dataset_benchmarking; Humphries: github.com/mhumphries2323/Transcription_Pearl); the #6523 CLI runner (`scripts/eval/run-cli-arm.py` + `scripts/lib/agy-tool-gate.py` on branch `job-cli-ocr-fix-6523c` @ 5fa9ae0b1, sentinels + tool gate) and its `ocrReadProblem` duplicated-reply rule (`scripts/lib/cli-chatter.mjs`); the #6388 planted-error controls. None of them reproduces a published LLM transcription number on the paper's own data.

## 2026-10-12 · Do three published LLM transcription results reproduce through our $0 CLI route?

**Why.** The #6544 manuscript numbers only mean something if our setup reproduces published results on the original data. This replication separates two questions: does the method fail to transfer, or is our pipeline off? It also checks whether the CLI route, which gives no temperature or resolution control, costs accuracy against what the papers ran.

**Data (posted on #6547 before any call).**

| paper | public? | used |
|---|---|---|
| Greif, Griesshaber & Greif 2025 (arXiv 2504.00414) | **yes**, MIT: 10 directories × 3 pages, a reference per 3-page document, Transkribus Print M1 drafts, and their own model outputs, including a Gemini 3.1 Pro revision run | all 30 pages |
| Humphries & Leddy, "Gemini 3 solves handwriting recognition" | no | — |
| Humphries & Leddy, "When models disagree" | no | — |
| Humphries et al. 2024, "Unlocking the Archives" (arXiv 2411.03340) | no: "decided not to make the dataset public" | — |
| *stand-in:* Bentham Dataset R0 (zenodo 44519) | yes, CC BY 4.0 | the 33-page ICFHR-2014 test set: English handwriting 1748–1832, page-level PAGE XML |

The stand-in is **indicative only**. A different set can neither replicate nor refute a number measured on another set. It differs from Humphries' set in three ways:
- mostly one writer (Bentham and his copyists), not 33 hands;
- heavy strike-throughs and insertions;
- the transcriptions are online.

Ids, sources and licences are in `scripts/eval/replicate-6547/manifest.json`. The data stays in `$JOB_SCRATCH` and is not committed.

**Routes and models.**
- Gemini 3.1 Pro (`gemini-3.1-pro-high`, the CLI's default thinking) and 3.8 Flash (`gemini-3.8-flash-low`, and `-high` as the resolver) through `agy -p`, with the #6523 runner: plan mode, sentinels, tool gate, at most 2 calls in flight.
- Opus (`claude-opus-5-5`, CLI default effort) through `claude -p --restricted --tools Read`, in a sealed one-image folder (`run-claude-arm.py`).
- $0 (subscriptions); 213 agy calls and 148 claude calls (plus one model-id probe).
- The CLI sets no temperature or media resolution. The papers ran temperature 0: Greif with dynamic thinking; Humphries with high resolution and minimal thinking.

**Scoring.** Failed reads are counted and never scored (#6523 rule). A failed read is one of:
- empty or refusal;
- **duplicated**: `ocrReadProblem`'s check, ported;
- **restarted**: new. Three or more 25-character lines written twice. It fires on 5 Gemini reads and on 0 Claude reads and 0 Greif pages. It catches a second copy that has been *respelled*, which the exact probe misses.

Per paper:
- **Greif.** Their `txt_accuracy.py` definitions: normalised (ASCII, lower case, no punctuation) and non-normalised CER, pooled per 3-page document, plus our `benchmark-score.mjs` letters-only CER. **Scorer control:** rescoring *their* published outputs reproduces their table (3.1 Pro 0.77/1.47, 2.0 Flash + Transkribus 0.84, Transkribus 3.68, all within 0.02 points).
- **Bentham.** Humphries' strict (case and punctuation count) and modified (both ignored) CER/WER. His modified form also forgives spelling modernisation through enchant + nltk; that part is not ported, so ours is stricter.
  - The reference's region order is not reading order, so lines are sorted top to bottom.
  - The reference also omits marginal archive notes. Each number is therefore given twice: **page** (everything counts) and **anchored** (only the reading's words inside some reference line's best window; this forgives omitted marginalia and order, and also forgives invented extra text).
- **Intervals:** 95%, 10,000 resamples by document (Greif: 10 documents; Bentham: pages).
- **Anchoring control.** 3 errors not on the page were planted in the draft: one digit change, plus two words swapped for words from the same page, each at a site where the draft was right. Greif: 12 pages (4 whole documents); Bentham: 10 pages. A site is found by a 3-token left context. Plants whose context repeats in the reference are set aside as ambiguous (3 per set).

### (a) Greif et al.: image + Transkribus draft → corrected (30 pages, 10 documents, 0 failed reads)

| arm | route | normalised CER [95% CI] | non-normalised CER | ours | s/page |
|---|---|---|---|---|---|
| *their* Transkribus Print M1 (the draft) | — | 3.67% (rescored 3.68% [1.75, 6.23]) | 4.95% | 3.30% | — |
| *their* Gemini 2.0 Flash, image + draft (**paper headline**) | API, T=0 | 0.84% [0.47, 1.27] | 1.91% | 0.68% | — |
| *their* Gemini 3.1 Pro, image only (revision) | API, T=0, dynamic thinking | 0.77% [0.40, 1.22] | 1.46% | 0.57% | — |
| *their* Gemini 3.1 Pro, image + draft (revision) | API, T=0 | 0.80% [0.34, 1.35] | 1.59% | 0.54% | — |
| **ours** Gemini 3.1 Pro, image only | CLI | **0.79% [0.39, 1.28]** | 1.57% [0.96, 2.24] | 0.59% | 83 |
| **ours** Gemini 3.1 Pro, image + draft | CLI | **0.75% [0.35, 1.22]** | 1.50% [0.85, 2.28] | 0.52% | 78 |
| ours Opus, image only | claude -p | 0.71% [0.31, 1.19] | 1.48% [0.80, 2.23] | 0.45% | 13 |
| ours Opus, image + draft | claude -p | 0.68% [0.32, 1.09] | 1.35% [0.80, 1.90] | 0.48% | 15 |

- **Paired by document, our CLI arm minus their API arm, same model, same pages, same prompt:**
  - image only: +0.02 points normalised (CI −0.03 to +0.07), +0.10 non-normalised (−0.08 to +0.28);
  - with draft: −0.05 (−0.21 to +0.09) and −0.09 (−0.29 to +0.07).
- **Gain from correction:** on a strong reader, correction adds about nothing: Pro 0.79 → 0.75, Opus 0.71 → 0.68. The paper's own gain (1.27 → 0.84) was on Gemini 2.0 Flash.
- **Anchoring:**
  - Opus: 0 of 33 planted errors survived.
  - Pro: 2 of 33 (6%, CI 0–20% by page). Both are on one page, type-6-p2: "Krähenstr. 417" for the image's 412, and "Eisenb." for "Vorst.".
  - On that page Pro made no `view_file` call. It still made 260 edits to the draft, so the image reached it inline (#6523 saw the same).
  - The anchoring documents scored separately: Pro 0.65% planted against 0.52% clean; Opus 0.43% against 0.42%.
- **Setup differences:**
  - their API at temperature 0, ours CLI with default sampling;
  - the same prompt (their German prompt, verbatim) plus our sentinel line;
  - their PNGs come from pdf2image at the default 200 dpi; ours are rendered with pdftoppm at 200 dpi;
  - one run, not their two.

**REPLICATED.** Our CLI Pro is within their interval and within 0.05 points of their API Pro, and the paper's <1% claim holds for every arm. The route costs nothing measurable here.

### (b) Humphries single reader: Bentham stand-in (33 pages)

| reader | did not read | page strict CER / WER | page modified CER / WER | anchored strict CER / WER | anchored modified CER / WER | s/page |
|---|---|---|---|---|---|---|
| *Humphries: Gemini 3 Pro, their 50 docs* | — | — | — | 1.67 / 4.42 | 0.69 / 1.33 | — |
| Gemini 3.1 Pro (CLI) | 3 restarted | 8.70 / 14.39 | 7.51 / 9.77 | 4.53 [2.04, 9.25] / 9.31 | **3.51 [1.11, 8.13]** / 4.98 | 80 |
| — without the invented page 071_030_001 | | 6.56 / 11.62 | 5.40 / 6.94 | 2.45 / 6.93 | 1.46 [1.01, 1.97] / 2.55 | |
| Gemini 3.8 Flash low (CLI) | 2 duplicated | 7.89 / 12.34 | 6.95 / 8.47 | 3.17 / 7.23 | 2.33 [1.14, 4.13] / 3.56 | 43 |
| Opus (claude -p) | 0 | 5.13 / 9.22 | 4.32 / 5.68 | 2.21 [1.71, 2.79] / 5.86 | 1.50 [1.05, 2.04] / 2.52 | 8 |

- **Pro invented page 071_030_001.** It made no `view_file` call and wrote 198 words of other Bentham prose, from memory ("As a system of procedure then…"). The page is "Of Irreparable Personal Injuries". It is a real misread, so it is scored.
- **Restarts.** All 5 Gemini restarts are on pages whose text is online. In 116_286_002, Pro's second copy is respelled ("woud", "concepton", "profitible"). This looks like a recitation-filter cut and restart.
- **Ranking.** Humphries ranked Gemini 3 Pro well ahead of Claude (~4%). Here Opus is at least as good as Pro.
- **Setup differences:**
  - other documents and other hands; model 3.1 Pro, not 3 Pro;
  - CLI default thinking, not minimal; no temperature or resolution control;
  - one run, not ten;
  - his transcription prompt (Transcription Pearl, verbatim) plus the sentinel line.

**NOT TESTABLE** (the data is not public).

### (c) Humphries disagreement: Bentham stand-in (29 pages that all three read)

Readers: Pro (primary), 3.8 Flash low and Opus. A flag is a primary word where any other reader differs (modified form). The resolver is 3.8 Flash high, as in #6544. It sees the image and the primary text with each flagged span marked `[[A: … | B: … | C: …]]`.

| measure | Humphries | ours | ours without the invented page |
|---|---|---|---|
| share of text flagged | 4% | 10.4% of words (CI 5.9–17.2 by page) | 7.6% |
| share of the primary's errors inside a flag | 76% (106/139) | 59% (169/286; CI 25–73) | 34% (46/136) |
| CER if flags resolved correctly (oracle, anchored modified) | 0.23% | 1.32% [0.62, 2.40] from 3.46% | 0.89% from 1.33% |
| CER with a model resolving the flags | (humans) | 1.65% [1.14, 2.24] | 1.63% (the primary alone: 1.33%) |

- **Flags work as a detector.** Pro's invented page had 188 of its 198 words flagged.
- **A model does not resolve the flags well.** On the other 28 pages the resolver made the text slightly *worse* than the primary (1.63% against 1.33%).
- **Why the catch rate is low.** By eye, about half of 30 random unflagged errors are reference conventions that every reader shares:
  - struck-through words the reference keeps ("seve served");
  - `&` and `&c` written out;
  - split hyphenations; folio and article numbers;
  - reference slips ("grab them up by the root").

  No disagreement among readers can flag these. Humphries' own reference and modified metric forgive more of them.
- **Setup differences:** our readers are 3.1 Pro, 3.8 Flash and Opus 5.5 (his: 3 Pro, 3.5 Flash, Opus 4.7); word-level flags (his granularity is unstated); a model resolver (his: a human).

**NOT TESTABLE** (the data is not public).

### (d) Unlocking the Archives: HTR draft + image → corrected

- **Their result:** Transkribus Titan + Claude 3.5 Sonnet, 3.0% strict / 1.8% modified CER.
- **No public data, no Transkribus.** The print half of the method (an LLM corrects a Transkribus draft) is covered on real Transkribus drafts by (a).
- **Handwriting stand-in:** the draft is the 3.8 Flash read (an LLM draft, not HTR), corrected with Transcription Pearl's correction prompt (verbatim) plus the sentinel line. 31 pages (the 2 duplicated drafts are excluded).

| corrector | draft page strict CER | → corrected | draft anchored modified | → corrected | anchoring survived |
|---|---|---|---|---|---|
| Opus | 7.89% | 5.58% [4.02, 7.47] (−29%) | 2.33% | 1.54% [0.99, 2.20] (−34%) | 0 / 26 |
| Gemini 3.1 Pro | 7.89% | 5.61% [4.07, 7.47] (−29%) | 2.33% | 1.66% [1.13, 2.30] (−29%) | 0 / 26 (1 site rewritten: £5050 for £5000, neither) |

**NOT TESTABLE** (the data is not public). The direction matches: correction cuts about a third of the error, against their −61% from a weaker HTR draft.

### What this means for reading #6544

1. **The CLI route measures the model, not the route.** It runs with the #6523 sentinels + tool gate. On the one paper where model, prompt, pages and scorer all match, CLI Pro equals API Pro to within 0.05 points.
   - So a gap between #6544's CLI arms and Flash-Lite cannot be blamed on the CLI's missing temperature or resolution controls, at least on print.
2. **Gemini CLI reads of handwriting fail in two shapes that #6544 must count.**
   - The page written twice: 5 of 66 Gemini reads, on text that is online. The respelled restart passes the exact-probe check, so #6544 needs the line-repeat check too.
   - A page invented without opening the image: 1 of 33 Pro reads.
   - So #6544 should log `view_file` per read and treat a read that never opened the image as suspect.
3. **Correction arms are unlikely to be dominated by anchoring:** 0–6% of planted errors survived, and Opus survived none. Keep the control.
4. **Score the disagreement arm two ways.**
   - As a detector it works: it caught the invented page.
   - As an accuracy lever a model resolver did not help. #6544 should report flagged share, oracle CER and resolver CER separately, and should not read a resolver gain into a pure accuracy improvement.
5. **Opus is a strong reader:** best on Bentham, level on Greif. It is a sound draft source and cross-family adjudicator for #6544.

**Artifacts.**
- Scripts: `scripts/eval/replicate-6547/` (`prep.py`, `run-claude-arm.py`, `textmetrics.py`, `disagree.py`, `score-greif.py`, `score-bentham.py`, `manifest.json`).
- Scores: `scripts/eval/results/replicate-6547/{greif,bentham}-score.json`.
- Raw reads: in `$JOB_SCRATCH/{greif,bentham}/out/` on Hetzner (not committed).

**Rerun:**
1. Fetch the Greif repo and the Bentham Zenodo record into `$JOB_SCRATCH`.
2. `prep.py greif|bentham`.
3. `run-cli-arm.py` (6523c branch) / `run-claude-arm.py` per arm.
4. `prep.py bentham2`, then the resolver and correction arms.
5. `score-greif.py`, `score-bentham.py`.

*Replicated?* (a) yes, against the paper's own published outputs. (b)–(d) cannot be, on these data.
