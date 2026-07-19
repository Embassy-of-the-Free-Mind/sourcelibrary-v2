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

## Contributions

1. **The memorization control**: canonical vs non-canonical reference rows on matched
   pages (three same-book contrasts), each row visually audited against the page scan.
   To our knowledge the first quantification of training-data contamination for OCR
   evaluation (contamination is heavily studied for text benchmarks; a 2026 survey of
   OCR evaluation explicitly notes the absence — VERIFY against related-work dossier).
2. **An outcome battery that separates failure modes** (see below) — in particular,
   unconditional accuracy reverses the model ranking that alignment-conditioned
   accuracy produces.
3. **A page-covariate observation design** (layout, density, type size, source class,
   measured image resolution, canonicity, memorization risk on every row) enabling the
   disaggregated and interaction analysis the eval literature calls for and lacks.
4. **A cheap ground-truth method**: page-aligned scholarly etexts (TITUS, First1KGreek;
   DTA generalizes) of editions a library holds map transcription pages 1:1 onto scan
   pages — free, deterministic ground truth with document provenance.
5. **A released dataset**: pages/references/runs JSONL with license-gated reference
   texts, sha256 pointers where sources forbid redistribution, and raw model outputs
   for re-scoring.

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

## Related work

_Slot for the verified dossier (agent sweep in progress): contamination/memorization
literature, OCR factor studies (UNLV-ISRI resolution classics; 2602.14524 error
patterns; 2603.25761 eval survey — "no substantial work on factor interactions,
contamination, or memorization"), VLM-OCR benchmarks (OCRBench v2, CHURRO-DS,
Consensus Entropy, HCPR/AIR), etext-as-ground-truth precedents (GT4HistOCR, IMPACT),
prompt-format effects. Novelty assessment to be pasted verbatim, including scoop
risks._

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
  page), then extended to the double-OCR corpus (split-page parents, duplicate
  holdings, re-archive pairs) for corpus-scale factor analysis.

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

## Venue / form

Candidates: (a) blog-post research note first (house pattern, citable, fast) →
(b) workshop/conference paper (NLP4DH / LM4DH / DH venue; or an eval-focused ML
venue). Dataset DOI via Zenodo at submission time. Both pending Derek's call on
naming and hosting.
