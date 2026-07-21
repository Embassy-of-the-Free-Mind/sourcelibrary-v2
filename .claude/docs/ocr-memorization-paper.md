# Reading or Reciting? Measuring the Memorization Subsidy in Vision-Language-Model OCR of Historical Documents

_Working paper plan + running draft. Started 2026-07-19 (issues #3212/#3235; PRs #3253/#3255).
Companion dataset: `scripts/eval/dataset/` (v0.1 exported; v0.2 after workstream-1 pages land).
Status of every number: reproducible from `scripts/eval/observations/*.jsonl` via
`report-canonical-gap.mjs`; raw model outputs are the durable artifact._

## The claim (one paragraph)

OCR benchmarks for historical documents are overwhelmingly built on canonical texts —
Genesis, Homer, the Vulgate — because those are the texts with published transcriptions
to score against. But frontier vision-language models have *memorized* those texts, so
benchmark scores conflate reading the page with reciting the training data. We measure
this **memorization subsidy** directly: matched canonical/non-canonical reference
passages on pages of the same books, scored identically. Same-book controlled, the
subsidy is real (~1pp for Pro-class models, ~5pp for small ones); pooled across
unmatched pages it vanishes into page-difficulty noise, which is itself the
methodological point. Its extreme
form is **fabrication**: models emit letter-perfect canonical text that is not printed
on the page at all. Scores on non-canonical text — which models can only read — are
the numbers that transfer to the rare, untranscribed material digitization projects
actually exist to serve.

## Contributions (revised 2026-07-19 per the verified related-work dossier)

1. **The memorization control**: canonical vs non-canonical reference rows on matched
   pages (two books currently carry both classes; expanding this is the top priority),
   each row visually audited against the page scan.
   Per the dossier's novelty assessment: the specific quantity "canonical-vs-non-canonical
   OCR accuracy gap" is unpublished as of 2026-07-19. Position as "known in speech
   (Tseng et al. 2505.22251 proved test-transcript contamination in ASR), unmeasured in
   OCR" — never claim "never studied in transcription." **The window is months, not
   years** (see scoop watchlist) — sequence the release accordingly.
2. **An outcome battery that separates failure modes** — in particular, unconditional
   accuracy reverses the model ranking that alignment-conditioned accuracy produces;
   and the observation that **consensus/agreement methods fail on canonical text**
   (models reciting the same memorized passage agree while both misreport the page) is
   a new failure condition against the Consensus Entropy line (2504.11101, 2603.19790).
3. **A page-covariate observation design** enabling disaggregated + interaction
   analysis. NOT a first — frame as "restoring the UNLV-ISRI factor-analysis tradition
   (Rice/Jenkins/Nartker 1996) for the VLM era, with canonicity as the new factor";
   Beyene & Dancy (FAccT 2026) indict the field for exactly this metric poverty.
4. **Ground truth from page-aligned scholarly etexts — REFRAMED.** Not novel as "etexts
   as ground truth" (GT4HistOCR built training GT from DTA in 2018; Smith & Cordell
   recommended the practice; Angleraud et al. 2603.02803 generate GT from TEI). The
   honest, still-novel version: page-aligning *independent* etexts (TITUS, First1K) to
   a library's *own held editions* as near-zero-cost evaluation references — coupled to
   the reflexive point that **the ground-truth supply and the contamination are the
   same variable**: the texts with free transcriptions are precisely the texts models
   have memorized. (The dossier confirms no prior work states this; it may be the
   paper's sharpest sentence.)
5. **A released dataset**: pages/references/runs JSONL with license-gated reference
   texts, sha256 pointers where sources forbid redistribution, and raw model outputs
   for re-scoring.
6. **(If the prompt ablation lands)** the effect of annotation-format prompts on OCR
   character accuracy — the dossier found no existing study; unclaimed territory worth
   a subsection.

**Title note:** "Reading or Guessing?" (Karamolegkou et al., arXiv:2605.27750, May
2026) already exists with the same title shape on the adjacent phenomenon. Either keep
"Reading or Reciting?" as a deliberate, cited echo (defensible — recitation vs guessing
IS the distinction between the papers) or retitle; decide at draft time.

## Outcome measures (the design core — why "accuracy" alone misleads)

Every run is scored on a battery; each outcome isolates a different failure mode:

| Outcome | Definition | Failure mode it catches |
|---|---|---|
| **aligned** | word-level subsequence guard ≤ 0.35 (char ≤ 0.30 CJK) | passage not usably present: refusal, truncation, wrong reading order, catastrophic misread |
| **char_accuracy** (conditional) | subsequence CER on the reference span, aligned runs only | character-level misreading, conditioned on task success |
| **char_accuracy_raw** (unconditional) | same, ALL runs | expected accuracy without alignment-survivorship bias |
| **truncation rate** | finish_reason = MAX_TOKENS | deliberation/verbosity consuming the output budget |
| **span_dispersion** | greedy in-order match span ÷ matched units (1.0 = contiguous) | reading-order scrambling (two-column interleave) that free-skip accuracy deliberately ignores |
| **recension divergence** | accuracy vs alternate recension minus accuracy vs printed edition | recitation fingerprint: output matches the memorized critical text better than the page |

Headline demonstration (2026-07-19 evening rebuild, n=1,077 observations / 921
reference-scored, 40 pages): conditional accuracy ranks Pro best (99.2% canon);
**unconditional accuracy inverts the ranking** — Pro 90.5%, Flash 88.1% (truncation
15%/19%), while Flash-Lite, the cheapest API model, leads at 98.0% with zero
truncation and the production pipeline reaches 98.9%. Alignment-conditioned accuracy
silently excuses exactly the failure mode that distinguishes models. The inversion is
the most robust result in the set: it survived tripling the page count and held under
every arm.

Recension divergence status: plumbing implemented (`alt_references` in works files →
`alt_scores` per observation); measured once manually (Prologus Galeatus: Stuttgart
recension guard 0.134 vs printed-edition/Clementine 0.058 on the same page); blocked
on a redistributable alternate text (Weber edition is in copyright) — fetch-at-build
is the likely resolution.

## Dataset design (summary; datasheet in dataset README)

- 40 pinned pages (12 canonical / 28 non-canonical; Armenian 8, Greek 12, Latin 5,
  Hebrew 4, German 5, Chinese 6), 4 scripts + CJK, print + manuscript
  + woodblock, visually audited `page_class` covariates, **measured image resolution
  (0.64–17.4 MP, 27× range)**.
- References: published transcriptions only; identity decided by the subsequence
  guard, never titles; one-page rule; license-gated redistribution.
- Runs: raw text retained; scores re-derived at build time with `scoring_version`.
- Anti-recitation protocol: pin only pages that verifiably PRINT the passage (image
  audit, not OCR audit); prefer pages whose OCR also transcribes non-reference
  material; treat perfect scores on degraded/manuscript sources as hallucination
  flags. Two canonical rows were deleted under this protocol after page-scan audits
  proved recitation (a 1450 Mishnah MS; a Daxue Huowen page) — the incident that
  motivated the whole design.

## Results (n=40 pages, 1,077 observations; rebuilt 2026-07-19 evening)

Reproduce with `report-canonical-gap.mjs` (main battery) and `report-arms.mjs`
(resolution + prompt arms) over `observations/ocr-observations-2026-07-19.jsonl`.

1. **Same-book contrasts hold — and they are the only clean subsidy evidence.**
   Virgil book (canonical Aeneid I vs non-canonical Vita Vergilii, same 1580
   edition, same scan): canon beats non-canon for **every** model — lite 97.2 vs
   91.8 (5.4pp), sonnet5 96.8 vs 92.1 (4.7pp), pipeline 99.3 vs 96.2 (3.1pp),
   mistral 96.5 vs 95.2 (1.3pp), flash 97.2 vs 96.0 (1.2pp), pro 97.0 vs 96.0
   (1.0pp). Vulgate book (Genesis 1 vs Jerome's two prologues) is flat to slightly
   negative — consistent with the prologues being partially memorized themselves
   (medium risk), i.e. the gap tracks the memorization gradient, not text genre.
   Only **two** books currently carry both classes; expanding that count is the
   single highest-value next page-hunt.
2. **The pooled gap did NOT survive tripling the page count — report this plainly.**
   At n=23 the pooled subsidy read pro +2.2pp / sonnet5 +2.6pp / lite +1.3pp. At
   n=40 it is pro +1.19pp, sonnet5 +1.07pp, pipeline +0.34pp, lite −0.08pp,
   flash −1.31pp, mistral −1.95pp. The added non-canonical pages (Teubner Hero,
   Simplicius, 19th-c. German) are *cleaner* than the canonical pages they pool
   against, so the pooled statistic moved with the page mix, exactly as predicted.
   **The paper's quantitative claim must rest on same-book contrasts; pooled
   numbers belong in the text only as a demonstration that pooling is unsafe.**
3. Manuscript-beats-print anomaly (unchanged): sonnet5 reads Iliad I at 99.4% on a
   1555 manuscript (1.66 MP) vs 97.3% on clean Teubner print it cannot recite.
4. **Outcome-battery ranking inversion** (all runs, no alignment survivorship):
   lite 98% aligned / 98.0% unconditional / 0% truncated; pipeline 100 / 98.9 / 0;
   sonnet5 77 / 92.3 / 0; pro 86 / 90.5 / 15; flash 85 / 88.1 / 19; mistral
   83 / 95.6 / 0. Conditional accuracy ranks Pro first; unconditional accuracy puts
   the cheapest model and the production pipeline ahead of it.
5. Factor structure: density and layout hit *alignment* (reading order,
   deliberation) while type/ligatures hit *accuracy*. Truncation remains a
   model-family behavior (Gemini Pro/Flash) that appears only on dense pages.
6. **Resolution ablation (new arm; 6 pages × {native, 2000, 1000, 600}px × 2 models
   × 2 runs).** Legibility is not the active variable in this range — *truncation
   is*. Flash pooled: 90.0% native, 83.2% @2000, 88.4% @1000, 92.8% @600, entirely
   non-monotonic, and the page-level swings track truncation flips: the Hebrew
   Sha'arei Orah page goes 50.2% → 95.2% when downscaled to 600px as its truncation
   rate falls 100% → 0%, while the Greek Dioscorides page collapses 94.3% → 65.5%
   as *its* truncation rises 0% → 100%. Lite is flat within 0.6pp across the whole
   27× range (95.5 / 96.1 / 96.1 / 96.1) with zero truncation throughout. Reading
   these pages is not resolution-limited above 600px; output-budget behavior is.
   This weakens the "Hebrew pages are low-resolution" confound hypothesis — the
   Hebrew page got *better* smaller.
7. **Prompt ablation (new arm; all 40 pages × 2 models × 3 runs, production
   annotated OCR prompt vs bare transcription).** The annotation contract costs
   about a point of unconditional accuracy — flash 88.1% → 87.2% (−0.91pp), lite
   98.0% → 96.7% (−1.24pp) — with alignment essentially unchanged (lite even
   improves, 97.5% → 99.2%). Per-page variance dwarfs the mean: flash swings from
   −48pp (Simplicius) to +84pp (Zohrab John), and inspection shows those extremes
   are alignment/truncation flips, not character-level reading changes. Split by
   canonicity the interaction is inconsistent across models (flash +6.3pp canon /
   −4.0pp noncanon; lite −5.0pp canon / +0.4pp noncanon), so **no canonicity ×
   prompt interaction is claimed**. The defensible sentence: the production
   annotation overhead is close to free on average, and any per-page effect runs
   through the output budget.
8. **Mistral OCR now covers the non-canonical set** (the recommender's P1 gap-hole
   arm). It aligns on 83% of runs at 95.6% unconditional accuracy, and it fails
   *categorically* rather than gradually: 0/4 aligned on canonical Armenian and 0/3
   on canonical Greek, while reaching 99.6% on non-canonical Greek. A specialist
   OCR system with no recitation channel is the natural control group for the
   subsidy argument, and its pooled gap is the most negative in the set (−1.95pp).

### Corpus arm (PR #3273, 2026-07-19) — n=109,953 revision pairs

Free, reference-free, and complementary: `page_revisions` stores the text each
re-OCR replaced, so every consecutive transition is a same-page double-OCR pair.
126,551 revisions → 109,953 eligible pairs, mean agreement **87.0%**.

6. **Agreement tracks era and script far more than model.** pre-1500 58.4% → 1900+
   96.2%; space-less scripts 50.4% vs spaced 87.5%; Tibetan 21.7% and Hebrew 57.1%
   against German 95.3% and English 95.5%. Model pair is a minor term next to these.
7. **Marginalia is the discriminating signal.** Marginal text agrees at **56.9%** on
   pages whose body text agrees at 87.0% — models reproduce the body block and
   disagree about the gutter. Fate across revisions: kept 19,696 / gained 6,235 /
   lost 2,477. This is a paper-worthy result in its own right: bulk CER on the body
   block hides the fact that the hardest, most scholarly-valuable marks on the page
   are essentially unreliable.
8. **Bulk agreement is not a quality measure without inclusion criteria.** Five
   distinct populations score identically as "disagreement", each found by reading
   page text rather than by reasoning about the metric: editorial notes (only ~3% of
   measured disagreement); space-less-script tokenization (a Chinese page is ~22
   whitespace tokens vs ~310 for Latin, so one glyph invalidates a token — 36.7%
   word-agreement vs 72.7% character-agreement); image-only pages (covers and plates
   where both texts are AI descriptions of one engraving); commentary-as-transcription
   (`I'll provide the transcription now` stored AS the transcription); and
   degeneration (repetition loops — one page with 8,104 words and 40 unique — plus
   `&nbsp;` padding). The last two **invert direction**: a shorter, disagreeing
   re-OCR of a looping prior is the repair, not the damage.
9. **Consensus-method caveat, corpus-scale.** Contribution 2 argues agreement fails on
   canonical text because reciting models agree. The corpus adds the converse failure:
   agreement also *understates* quality wherever the metric itself is mis-specified
   (space-less scripts) or the page has no text to agree about (plates). Both
   directions of failure are now measured, not asserted.

Caveat carried forward: this arm has NO ground truth. It characterises agreement and
its factors; it cannot say whether 87% agreement means 87% correct. The regression
queue derived from it is explicitly unverified (priors longer than a page can hold
still rank at the top).

## Related work — verified dossier (2026-07-19 sweep; every entry abstract-checked)

### Contamination / benchmark leakage
- **Xu et al. 2406.04244** — canonical BDC survey; text benchmarks only, no OCR/vision → supports "the field lacks this for OCR".
- **Sainz et al. 2310.18018** (Findings of EMNLP; re-check 2023-vs-2024 against the Anthology) — "contamination causes overestimation"; calls for per-benchmark measurement. We answer this call for the OCR benchmark class.
- **Golchin & Surdeanu 2308.08493** (ICLR'24 spotlight) — guided-completion contamination detection; our page-scan audit is the OCR-native analog.
- **Shi et al. 2310.16789** (ICLR'24) — Min-K% Prob membership inference; could VALIDATE our memorization_risk covariate (planned check).
- **Song et al. 2411.03823** (Findings EMNLP'25) — MM-Detect: contamination in 12 MLLMs; shows text-side pretraining contamination surfaces in multimodal evals — exactly our mechanism, but VQA, never OCR.
- **Park et al. 2511.03774** (ICLR'26) — VLM contamination detection via semantic perturbation; method could jump to OCR quickly (watchlist).
- **Xu, Wu & Ryu 2606.10066** — controlled contamination audit of medical VLM benchmarks; the "per-domain audit" genre we join.
- **Tseng et al. 2505.22251** — ASR test-set contamination (LibriSpeech/Common Voice verbatim in pretraining): THE cross-modal precedent. Position: "known in speech, unmeasured in OCR." Their "subtle WER effect" warns us to handle confounds carefully.
- **Akeret 2606.07608** — Swiss German ASR SOTA fabricated by contamination (3.9% WER via memorization); recent proof contamination fabricates transcription SOTA.

### Memorization & extraction of canonical text
- **Carlini et al. 2012.07805** (USENIX'21) — verbatim extraction exists, scales with model size.
- **Carlini et al. 2202.07646** (ICLR'23) — memorization drivers: scale, duplication, context. Predicts our canonicity gradient; tension to discuss: our SMALL models show LARGER gaps.
- **McCoy et al. 2111.09509** (RAVEN) — n-gram novelty; usable as an overlap-based canonicity score for our passages.
- **Chang et al. 2305.00118** (EMNLP'23, "Speak, Memory") — memorized books inflate downstream task performance; the closest existing "memorization subsidy" statement, text-only. Cite prominently; ours is the vision channel in pp-of-CER.
- **Karamolegkou et al. 2310.13771** (EMNLP'23) — verbatim reproduction of famous literary works — exactly our canonical class. NB: author overlap with the nearest-competitor group.
- **Cooper et al. 2505.12546** — per-work, per-model graded memorization of books (Llama 3.1 70B near-complete on some) → motivates graded memorization_risk, not binary.
- **Ahmed et al. 2601.02671** — extraction from PRODUCTION models (Gemini 2.5 Pro 76.8% nv-recall on Harry Potter, no jailbreak) — the exact model families we score.
- **Jayaraman et al. 2402.02103** (NeurIPS'24) — VLM déjà-vu memorization is image-side/privacy; text-recitation-through-vision remains unmeasured.

### OCR factor studies
- **Rice, Jenkins & Nartker, UNLV-ISRI TR-96-01** — the 1990s stratified OCR tests; our design is its VLM-era descendant. (Pull the PDF before quoting specific dpi numbers.)
- **Smith & Cordell 2018 agenda** — recommended etext reuse + statistical analysis of OCR; claim (3/4) implements, doesn't invent.
- **van Strien et al. 2020** — OCR quality's downstream impact; the standard "OCR error as variable" citation.
- **Vesalainen et al. 2602.14524** — Qwen beats TrOCR on CER but silently MODERNIZES historical orthography ("selective linguistic regularization") — language-prior interference in factor form; no memorization angle. Also motivates our fold choices.
- **Beyene & Dancy 2603.25761** (FAccT'26) — OCR eval review 2006-2025: historical material invisible, CER-centric metrics miss structural failure, no contamination coverage → citable evidence of the gap.

### VLM-OCR benchmarks & failure modes
- **OCRBench v2 (2501.00321)** — keeps a PRIVATE test set to validate public trends: implicit admission contamination is live, unmeasured.
- **CHURRO (2509.19768, EMNLP'25)** — 155 corpora, 99K pages; flagship historical benchmark; aggregates widely digitized (= plausibly memorized) transcriptions with no contamination analysis. Our claim (1) is a critique its users need.
- **olmOCR (2502.18443)** — the citable eval venue for Mistral-OCR-class systems (Mistral OCR itself: vendor blog only).
- **Consensus Entropy (2504.11101)**; **risk-controlled OCR (2603.19790)** — consensus methods; we document their failure condition on memorized text (recitation breaks independence).
- **Levchenko 2510.06743** (LM4DH) — HCPR/AIR "over-historicization": the prior MISFIRING stylistically; recitation is the prior SUCCEEDING — and contaminating the score. Sharpens our distinction.
- **Greif et al. 2504.00414** — <1% CER post-correction on 18-19th c. German directories — note: administrative text is memorization-clean; which celebrated numbers to trust.
- **Kanerva et al. 2502.01205** ("No Free Lunches") — post-correction helps English, fails Finnish: language priors are the active ingredient — resource-level cousin of the subsidy.
- **DeepSeek-OCR (2510.18234)** — ~97% precision under 10× token compression → ~60% at 20×: resolution/token budget as first-order factor (our caveat 2's mechanism).
- **Humphries et al. 2411.03340** (Historical Methods) — the DH "LLMs transcribe archives" landmark; journal version notes whole-page hallucination qualitatively — our fabrication finding, unmeasured, unframed.
- **Shu et al. 2506.05551** (NeurIPS'25, TextHalu-Bench) — "semantically plausible yet visually incorrect" scene-text readings; priors override vision; no historical docs.
- **HalluText (OpenReview LRnt6foJ3q, under review)** — names "OCR hallucination" from language priors; modern docs, no canonicity. Flag as under-review if cited.
- **Karamolegkou, Angleraud, Sagot & Clérice 2605.27750 ("Reading or Guessing?", May 2026)** — THE closest prior: VLM OCR on Ancient Greek critical editions; perturbation + grounding analysis shows errors stay fluent and weakly image-conditioned. Does NOT: label canonicity, quantify a memorized-vs-novel gap, frame as contamination, release covariates. Cite in the first paragraph; differentiate generously.
- **Angleraud et al. 2603.02803** — same group: TEI-generated GT, Qwen3VL-8B at 1.0% median CER on real Greek editions. This team owns the adjacent lane.

### Etexts as ground truth
- **GT4HistOCR (1809.05501, Zenodo)** — 313K line pairs from DTA et al., CC-BY: the direct precedent; ours differs by page-alignment to HELD editions, for EVALUATION, with contamination labels.
- **IMPACT dataset (HIP 2013)** — institutional-scale manual GT; our cost contrast.
- Cross-ref: CHURRO-DS is already recycled scholarly transcription at scale, unlabeled for canonicity — the field's ground truth is contaminated by construction.

### Prompt/format effects
- **Tam et al. 2408.02442** (EMNLP'24 industry) — structured-output constraints degrade reasoning; nearest rigorous result, not OCR.
- **GutenOCR (2601.14490)** — prompt contract materially changes OCR behavior on same model/page.
- **Gap (dossier-verified): no study measures annotation-format effects on OCR character accuracy** → our prompt ablation is unclaimed territory.

### Scoop watchlist (re-check before submission)
Karamolegkou/Angleraud/Sagot/Clérice (most likely to add canonicity next); Akeret-style honest-baseline audits spreading ASR→OCR; Park et al.'s perturbation method applied to OCR; CHURRO team under reviewer pressure; medical-audit template (2606.10066) transferring. **As of 2026-07-19 the quantity "memorization subsidy in VLM OCR" is unpublished. Publish fast.**

## Experiments planned (each cheap, each targets one confound)

- ~~**Resolution ablation**~~ — RUN 2026-07-19 (result 6). Follow-up worth doing:
  extend below 600px to find where legibility actually binds, and re-run on pro to
  see whether the truncation mediation is a Flash-family artifact. (Natural
  experiment also available: the corpus-wide native-res re-archive gives
  before/after image pairs.)
- ~~**Prompt ablation**~~ — RUN 2026-07-19 (result 7): ≈1pp unconditional cost, no
  reliable canonicity interaction.
- ~~**Workstream-1 pages**~~ — LANDED: 12 new non-canonical pages (Hero, Simplicius,
  Philo, Eznik, Xorenac'i) plus 5 German DTA pages, taking the set to 40.
- **More same-book pairs** — the binding constraint on the headline claim. Every new
  book that prints both a memorized and a non-memorized passage is worth more than
  ten additional unmatched pages.
- **Recension alt-references** for 2-3 rows (recitation fingerprint at scale).
- **Agreement→accuracy calibration** on non-canonical rows only (consensus is NOT
  independent on canonical text — two models reciting agree while both misreport the
  page). The corpus arm of this is now MEASURED (PR #3273) — see "Corpus arm" below —
  but calibration itself is still open: the corpus gives agreement and its factors,
  never accuracy. Only the anchor rows can supply truth.
  The double-OCR supply is far larger than first thought: `page_revisions` snapshots
  every OCR overwrite — **126,551 prior OCR versions across 100,992 distinct pages**,
  full text with model + prompt_version on both sides (mostly flash→current and
  lite→current transitions) — plus split-page parents, duplicate holdings, and
  re-archive before/after pairs. Every page also carries `ocr.prompt_version` /
  `prompt_name`, so prompt provenance is a corpus-wide covariate for free.
- **Within-work canonicity gradient** (Derek, 2026-07-19) — the design upgrade the
  same-book contrasts approximate but do not achieve. Aeneid vs *Vita Vergilii* share
  a *binding*; they are still two texts, two genres, two typographic settings. The
  clean contrast is within ONE work and ONE scan: *Iliad* I (hyper-canonical, quoted
  everywhere) vs a middle book; Genesis 1 vs a genealogy chapter; the *Analects*
  opening vs an inner chapter. Edition, typeface, scan quality, resolution and layout
  are held constant by construction, and canonicity varies only by how often that
  PASSAGE appears in training corpora. Two payoffs: it removes the confounds
  Results #3 currently apologises for in both directions, and it converts a two-cell
  contrast into a **slope**. Requires replacing the binary `page_class.canonical_text`
  (currently 12 true / 11 false, with `memorization_risk` on only 11 of 23 pages) with
  a graded per-passage canonicity score. Derek's framing: this is the inverse of
  standard membership inference — instead of asking whether a text is in the training
  data, rank passages by how *hard* they were to avoid.
- **Non-generative baseline → difference-in-differences.** The strongest identification
  available and currently absent from this design. Every measurement here is
  VLM-against-reference, so page difficulty and memorization stay entangled; the
  paper handles that with caveats rather than design. A **non-generative engine cannot
  recite**, so it absorbs difficulty and nothing else:

      subsidy = (VLM − baseline)|canonical − (VLM − baseline)|non-canonical

  The baseline must be genuinely non-generative — Tesseract or Kraken (free, local;
  Kraken has historical-script models). `runners.mjs` already has Gemini, Claude and
  `mistral-ocr-latest`, but all three are neural and all could in principle recite, so
  none of them can serve as the control. Tesseract will read 16th-c type badly; badly
  *in a way that cannot recite* is exactly the required property. This also gives the
  paper a claim that survives the scoop watchlist: a contamination estimate that does
  not depend on the reference text being uncontaminated.
- **Error taxonomy** (unblocked, free, no model calls). The outcome battery measures
  error RATES, never error KINDS. A second recitation fingerprint is available in
  data already held: classify each diff as **image-conditioned** (long-ſ/s confusion,
  ligature splits, gutter and margin loss, line-order scrambling — errors that track
  what the scan looks like) versus **editorial** (normalised spelling, expanded
  abbreviations, regularised orthography, modern punctuation — errors that track a
  critical edition). A model reading the page makes the first kind; a model reciting
  makes the second. Unlike `recension divergence`, this needs no redistributable
  alternate text, and it is computable over the 109,953-pair corpus as well as the
  anchor rows.

## Limitations to state plainly

- n=40 pages, unbalanced cells (12 canonical / 28 non-canonical, and only two books
  hold both classes); interaction estimates are hypotheses, and the pooled
  canonical-vs-non-canonical statistic is confounded by page mix in both directions.
- The resolution and prompt arms ran on flash + lite only, 2–3 runs per cell; their
  page-level effects are large but noisy, and both are mediated by truncation, so
  they say more about output-budget behavior than about reading.
- Scores are passage-scoped (free-skip): completeness and hallucinated additions
  outside the reference span are unmeasured.
- "Published transcription" is never zero-exposure (First1K is on GitHub);
  memorization_risk is a recorded gradient, not a binary.
- Reference-transcription conventions (abbreviation expansion, recension drift)
  masquerade as OCR error; per-row audit notes document known cases; cross-edition
  rows are lower bounds.
- Greedy span dispersion is ordinal, not calibrated.
- `canonical_text` is binary and `memorization_risk` is populated on only 11 of 23
  pages; the within-work gradient above is the fix, and until it lands every
  canonicity claim is a two-cell contrast, not a dose-response.
- The corpus arm (n=109,953) has no ground truth and its regression queue is
  unverified — cite it for agreement structure and factor effects, never for accuracy.

## Venue / form

Candidates: (a) blog-post research note first (house pattern, citable, fast) →
(b) workshop/conference paper (NLP4DH / LM4DH / DH venue; or an eval-focused ML
venue). Dataset DOI via Zenodo at submission time. Both pending Derek's call on
naming and hosting.
