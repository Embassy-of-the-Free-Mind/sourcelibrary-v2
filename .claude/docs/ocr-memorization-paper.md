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
passages on pages of the same books, scored identically. The subsidy is real (~1–3pp
for Pro-class models, up to ~5pp for small ones, same-book controlled), and its extreme
form is **fabrication**: models emit letter-perfect canonical text that is not printed
on the page at all. Scores on non-canonical text — which models can only read — are
the numbers that transfer to the rare, untranscribed material digitization projects
actually exist to serve.

## Contributions (revised 2026-07-19 per the verified related-work dossier)

1. **The memorization control**: canonical vs non-canonical reference rows on matched
   pages (three same-book contrasts), each row visually audited against the page scan.
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

Headline demonstration (2026-07-19, n=495 observations, 23 pages): conditional
accuracy ranks Pro best (99.2% canon); **unconditional accuracy inverts the ranking**
— Pro 90.5%, Flash 86.9% (truncation rates 20%/29%), while Flash-Lite, the cheapest
model, leads API models at 97.3% with zero truncation. Alignment-conditioned accuracy
silently excuses exactly the failure mode that distinguishes models.

Recension divergence status: plumbing implemented (`alt_references` in works files →
`alt_scores` per observation); measured once manually (Prologus Galeatus: Stuttgart
recension guard 0.134 vs printed-edition/Clementine 0.058 on the same page); blocked
on a redistributable alternate text (Weber edition is in copyright) — fetch-at-build
is the likely resolution.

## Dataset design (summary; datasheet in dataset README)

- 23 pinned pages (→ ~35-38 after workstream-1), 4 scripts + CJK, print + manuscript
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

## Results so far (all preliminary at n=23 pages)

1. Same-book Virgil contrast: canonical Aeneid beats non-canonical Vita for every
   model; largest gaps in small models (lite 5.4pp, sonnet5 4.7pp). Vulgate same-book
   contrast ~flat — consistent with Jerome's prologues being partially memorized
   (medium risk), i.e. the gap tracks the memorization gradient, not text genre.
2. Manuscript-beats-print anomaly: sonnet5 reads Iliad I at 99.4% on a 1555
   manuscript (1.66 MP) vs 97.3% on clean Teubner print it cannot recite.
3. Pooled subsidy among aligned runs: pro +2.2pp, sonnet5 +2.6pp, lite +1.3pp,
   pipeline +1.1pp, flash −0.7pp — pooled numbers carry page-difficulty confounds
   in BOTH directions (Armenian inverts: its canonical page is the hardest page in
   the set; Hebrew's non-canonical pages are its lowest-resolution ones).
4. Factor structure: density and layout hit *alignment* (reading order, deliberation)
   while type/ligatures hit *accuracy*; resolution spans 27× and confounds naive
   language-level comparisons (measured, now controllable).
5. Truncation is a model-family behavior (Gemini Pro/Flash), not a page property
   alone, and only appears on dense pages — a genuine interaction.

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

- **Resolution ablation**: same pages fetched at multiple widths → resolution curve
  with everything else constant. Cheapest manipulable factor; directly tests the
  Hebrew confound. (Natural experiment also available: the corpus-wide native-res
  re-archive gives before/after image pairs.)
- **Prompt ablation**: bare transcription vs production annotated prompt, same pages
  ×3 runs — is the annotation overhead free? (Current evidence: suggestive no-harm,
  uncontrolled.)
- **Workstream-1 pages**: 10-15 more non-canonical pages across density/type cells
  within the five page-aligned editions (agent running).
- **Recension alt-references** for 2-3 rows (recitation fingerprint at scale).
- **Agreement→accuracy calibration** on non-canonical rows only (consensus is NOT
  independent on canonical text — two models reciting agree while both misreport the
  page). The corpus arm of this is now MEASURED — see "Corpus arm" below — but
  calibration itself is still open: the corpus gives agreement and its factors, never
  accuracy. Only the anchor rows can supply truth.
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

- n=23 pages, unbalanced cells; interaction estimates are hypotheses.
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
