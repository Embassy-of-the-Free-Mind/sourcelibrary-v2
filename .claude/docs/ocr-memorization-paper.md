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
| **char_accuracy_windowed** | fitting alignment: leading/trailing insertions free, interior CHARGED | free-skip inflation — junk *between* the reference's own characters. LOWER bound; pair with char_accuracy, the UPPER bound |
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

- 44 pinned pages (12 canonical / 32 non-canonical; four within-work pairs added
  2026-07-23 with `canonicity_grade` + `same_work_contrast` fields; Armenian 9,
  Greek 13, Latin 7,
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

## Results (n=44 pages, 980 reference-scored observations; rebuilt 2026-07-23 — results 1–8 quote the 2026-07-19 n=40 build)

> **RE-DERIVED 2026-07-21 — and the result is a CONFOUND, not a correction.**
> Observations now carry `char_accuracy_windowed` + `bracket_width` alongside the
> free-skip score. Pooled, the subsidy drops for every model under the windowed
> metric, mostly going negative (−3 to −22pp). That is NOT evidence the subsidy was
> a scoring artifact. Bracket width (non-reference material inside the passage span)
> is **10.4pp on canonical pages vs 1.8pp on non-canonical** — the widest are
> canonical pages whose layout interleaves commentary (Zhuangzi interlinear 45.5pp,
> Aeneid verse-in-commentary 13.6pp, Analects text+translation+commentary 12.7pp).
> The mechanism is structural: **canonicity CAUSES commentary**. Canonical texts are
> exactly the ones that attract glosses, interlinear translation and apparatus. So
> the windowed metric overcharges canonical pages for a non-memorization reason,
> just as free-skip overcredits verbose output for a non-reading reason. **Both
> bounds are differentially biased with respect to the contrast, in opposite
> directions — the bracket does not bracket the subsidy.**
> On layout-clean pages the two metrics largely agree (sonnet5 +8.8/+8.3pp, flash
> +2.3/+0.6pp, lite +1.8/+1.7pp; pro-preview the outlier at −9.7/−23.9pp), but that
> subset is 4 canonical pages vs 28 non-canonical with residual bracket asymmetry —
> an indication, not an estimate. **Quote no pooled subsidy figure.**
>
> _Superseded note (kept for provenance):_ **RE-DERIVATION PENDING (2026-07-21).** Every accuracy number below is computed on
> `char_accuracy`, the free-skip subsequence score, now known to be an UPPER bound
> whose inflation scales with output verbosity — measured at 12.9pp for Tesseract vs
> 5.7pp for Gemini on these same pages, so the bias does NOT cancel when engines or
> models are differenced. The pooled subsidy figures are the most exposed: they are
> differences of differences of an inflated quantity. `charAccuracyWindowed` now
> ships alongside it (`scripts/eval/lib/metrics.mjs`), and re-scoring is FREE — raw
> outputs are retained and scores re-derive at build time via `scoring_version`.
> **Do not quote subsidy numbers in a draft until they are recomputed on both bounds.**

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

### Within-work canonicity pairs (2026-07-23; PR #3320 rows, sweep in ocr-observations-2026-07-23.jsonl)

Four pairs pin a hyper-canonical and a low-canonicity passage of the SAME work in the
SAME held scan (edition, typeface, scan quality held constant by construction; rows
carry `canonicity_grade` + `same_work_contrast`): Vulgate Genesis 1 ↔ Genesis 5
begat-list (1566 Louvain), Aeneid I ↔ X.362-382 (1580 Meyen), Iliad I ↔ XIII.493-517
(1555 MS Rouse 358), Zohrab John 1 ↔ 1 Chronicles 1 (1805). Sweep: pro, flash, lite,
sonnet5, mistral-ocr ×2-3 + pipeline, ~$1.2 total. Per-pair aligned-mean accuracy
(raw in parentheses where alignment failed):

9. **The manuscript pair is the headline: the within-work gradient is real and large
   where everything is held constant.** Same 1555 scribe, same page style, light
   density both sides. Canonical Iliad I: pro/flash/lite all read **100.0%**, sonnet5
   99.4% — perfect scores on 16th-c. Greek cursive, which the anti-recitation
   protocol itself says to treat as recitation flags. Mid-poem Iliad XIII: pro 90.7%
   (−9.3pp), lite 94.4% (−5.6), flash 97.2% (−2.8), sonnet5@w2000 94.8% (−4.6, width
   caveat below), pipeline 99.1% (−0.9). On manuscript Greek the subsidy is 3–9pp
   with page difficulty removed by construction.
10. **On clean print the within-work gradient is small (0–2pp) — and the interesting
   failure is behavioral, not character-level.** Vulgate pair (readers only): sonnet5
   −1.1pp, lite −2.0pp, mistral-ocr −0.3pp, pipeline flat at 100/100. But pro and
   flash *fail alignment* on the begat-list while reading Genesis 1 fine (flash raw
   98.7% canon vs 46.4% noncanon; pro raw 93.9 vs 54.2): the repetitive genealogy
   induces the truncation/scramble failure mode in exactly the models prone to it.
   Aeneid pair: flat for every model (pro +0.3, sonnet5 +0.1, flash 0.0, lite −0.3,
   mistral +0.5, pipeline −1.0) — consistent with commentary layout dominating and
   with Aeneid X being only medium-low canonicity (it is still the Aeneid), and
   measured against a cross-edition reference that undercounts the noncanon side
   (~8 documented 1580-vs-modern divergences).
11. **The Zohrab pair is a design lesson, not a subsidy estimate: within-work does
   not mean within-difficulty.** The direction *inverts* — canonical John 1 scores
   WORSE than the Chronicles genealogy for every engine (lite 92.9 vs 95.7; pro
   1/3 aligned vs 2/3; flash raw 15.9 vs 97.5) — because 480 pages apart the NT
   page is typographically harder. In a large composite volume, pair pages from the
   same quire, not just the same work. Kept as a documented negative control.
12. **Input caps are a failure mode of their own.** claude-sonnet-5 returned API
   400s on the native-resolution Iliad XIII scan (5.8MB archived image > Anthropic's
   5MB cap) — it cannot see the page at all at native res; its cell ran at
   `@w2000` (2.1MB), which is also closer to the canonical page's 1.66MP. Echoes
   result 6: above minimal legibility, model *behavior* (output budgets, input
   caps), not optics, is the binding constraint. mistral-ocr failed alignment on
   BOTH sides of the manuscript pair (raw 79.2 canon / 44.0 noncanon) — the
   categorical-failure pattern of result 8 extends to manuscripts.

Design note: pooled across the four pairs these effects would largely cancel
(9.3pp manuscript gap, ~1pp print gaps, one inverted pair) — the within-work
gradient must be reported per-pair, which is the point of pinning pairs.

### Occlusion/degradation pilot (2026-07-23; 140 runs, 0 errors, ~$4; harness `--occlude`/`--blur`/`--save-image` in qa-eval, analysis `report-occlusion.mjs`)

Ten pages (the four pairs + two Hebrew controls), lite + sonnet5 ×2, all arms on a
2000px base: baseline, @occ25 (mid-page band masking 25% of height), @blur2/@blur4.
Every occluded image was visually audited afterward; the audit changed the analysis.

13. **Silent fill-in is the default behavior, and it is now measured per passage.**
    Of 28 occluded runs, exactly ONE mentioned the mask — models otherwise
    transcribe straight through a 25%-of-page gray band without comment. After
    normalizing for how much of the reference each mask actually covered
    (`fill-in excess` = occluded-run reference coverage − visually audited visible
    share), the excess column reads as a **graded retrievability score**:
    Iliad I **+32pp** (both models, on the 1555 MANUSCRIPT), 1 Chr (Armenian)
    +18/+28, Aeneid I +21/+22, Vulgate Genesis 5 +16/+21, Aeneid X +16/+17,
    Iliad XIII **−13/−16** (the one true negative — occlusion also scrambles
    reading order, so a pure reader goes slightly negative). This ordering is the
    first empirical **canonicity slope** — the graded instrument the within-work
    plan called for — and its sharpest point: models reconstruct hyper-canonical
    text through a mask even on a manuscript page, in a hand they are reading, not
    reciting from print.
14. **Blur is the geometry-free twin, and it confirms the manuscript result.**
    Under σ=4 blur the canonical Iliad I holds 100.0%/99.8% (Δ 0.0pp) while
    non-canonical Iliad XIII on the SAME manuscript collapses −32/−48pp.
    Degradation robustness on the memorized passage only — page style, hand, and
    blur level identical by construction. On clean print blur4 barely binds
    (±1-3pp both classes), so the blur detector needs degradation strong enough to
    impair *reading* before memory's robustness shows; occlusion works everywhere
    but needs geometry audit. The two are complementary arms of one test.
15. **The predictability confound, found by the audit.** "Low-canonicity" print
    passages showed positive fill-in too — and each case is explainable:
    Aeneid X is still the Aeneid (reference = the memorized Wikisource text);
    the Armenian 1 Chronicles genealogy is a name-chain reconstructable from
    CROSS-LINGUAL memory (Adam→Seth→Enos in Armenian orthography, +28pp) where
    the Latin Genesis 5 begat-list with its unpredictable lifespan numbers filled
    in less. The cloze measures **retrievability = memorization + structural
    predictability**, not verbatim edition memory alone — the right control for
    the membership test is text that is unpredictable AND unpublished, which
    (reflexively, again) reference-bearing pages can never fully be.
16. **Pilot design corrections for v2** (both found by the image audit, neither
    visible in the score table alone): (a) the fixed mid-page mask MISSED the
    reference passage entirely on two of five canonical pages (Vulgate Genesis 1 —
    it masked the woodcut; Hebrew Genesis 1 — band sat below vv.1-5), silently
    producing flat Δocc that looks like recitation; v2 masks must be
    passage-targeted per page. (b) Raw Δocc conflates mask-passage overlap with
    fill-in — the visible-share normalization is mandatory, and eyeballed shares
    carry ±10-15pp, so v2 should compute overlap from line coordinates or
    per-token masked-region scoring. Also recorded: sonnet5 under blur4 on
    Armenian returns 0.0% both classes (model breakdown, not signal), and the
    single mask mention was sonnet5 on the Zohrab John page.

### Occlusion v2 — passage-targeted masks (2026-07-24; ~$1.16; masks audited in `occlusion-v2-masks-2026-07-24.json`)

17. **The v2 rerun repairs both v1 design flaws and the detector strengthens.**
    Hand-placed rects mask a 27–50% chars-weighted INTERIOR share of each
    reference passage (first/last lines always visible — the cloze), share
    computed from GT-substring/line offsets, not eyeballed; zero pages excluded
    (v1 lost 2 of 5 canonical pages to a missed mask). Fill-in excess, canon vs
    non-canon (lite/sonnet5): Vulgate +15/+14 vs +18/+20; Virgil **+36/+37** vs
    +5/+3; Iliad MS +17/+17 vs **−4/−6**; Zohrab +26/+9 vs +13/+13; Hebrew
    +31/+32 vs **−3/−3**. The two structurally unpredictable non-canonical
    controls (Iliad XIII, Sha'arei Orah) sit flat-to-negative — reader behavior —
    while every canonical page fills in strongly, including the two v1 could not
    measure (Vulgate Genesis 1, Hebrew Genesis 1). The genealogies stay
    intermediate-positive off-canon, confirming result 15's predictability
    confound rather than contradicting the detector. Tooling note recorded for
    reuse: sharp's `composite().resize()` in one chain silently shifts the mask
    (JPEG shrink-on-load) — materialize the composite before resizing.

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

### Calibration scorecard (2026-07-23/24, PRs #3336 + #3342) — agreement→accuracy, anchors → corpus

Two sessions built this in parallel; the canonical implementation is
`scripts/eval/calibration-scorecard.mjs` (PR #3336; offline, zero cost) →
`results/calibration-scorecard-2026-07-23.{json,md}`. Per non-canonical anchor
page: mean inter-model agreement paired with reference accuracy (both bounds);
per-script OLS with bootstrap CIs over pages, n<5 scripts refused (never
extrapolated); applied to the 109,953-pair revision corpus by stratum. The
duplicate implementation (#3342, closed) differed by pairing at the cross-model
PAIR level (2,023 pairs) and applying per-pair over `is_live` pairs only; its
surviving contribution is the pair-level r addendum in result 18.

17. **The scorecard answers the reader question, with flags carrying the real
   information.** German ≈99.8% estimated accuracy, English ≈99.8% (cross-script
   transfer), French ≈99.5%, Latin ≈97.0% (its per-script slope is not
   significant, so Latin cells carry "trust magnitude, not cell ordering"),
   16th-c Greek 94.8% estimated off median agreement of only 44.8% — flagged;
   Tibetan and Chinese are UNCALIBRATED (space-less, zero non-canonical
   anchors): 12.8% median agreement on 18th-c Tibetan is reported as a flag,
   not laundered into an accuracy number. The zero-spaceless-anchor gap is a
   finding — every Chinese anchor is a canonical classic, exactly the rows the
   consensus-failure result disqualifies from fitting.
18. **The r-split evidence for excluding canonical rows is MECHANISM, not this
   dataset's correlations — say so plainly.** Page-level on the 44 pages, the
   pooled split REVERSES the pilot (canon r=0.777 > noncanon 0.714): at n=12
   canonical pages pooling six scripts, between-script separation inflates a
   pooled r (Simpson-shaped artifact). Pair-level recomputation (2,023
   cross-model pairs, #3342) lands in the pilot's direction — noncanon 0.688 vs
   canon 0.516 — but decomposing it within script shows why neither number is
   dispositive: each script's canonical cell is 1–2 pages, so per-script canon r
   is computed on pairs from a single page (Greek: one Iliad page, r=0.709;
   Armenian: one Zohrab page, r=0.493). Every level of the r comparison is
   underpowered at 12 canonical pages. The exclusion decision rests on the
   demonstrated recitation mechanism (results 9, 13–14), and the paper should
   cite it that way rather than leaning on any r split.
19. **Honesty rails on every estimate.** (a) Corpus pairs are mostly
   within-Gemini-family transitions — self-agreement shares failure modes, so
   calibrated numbers are conditional on the anchor fit transferring and lean
   HIGH; anchor accuracy is additionally the free-skip upper bound. (b) The
   curve's low end is soft: anchor disagreement is about NON-reference page
   material (pairs below 0.3 agreement still average ~78% free-skip accuracy),
   while corpus low-agreement pairs may be genuinely broken text — a failure
   shape anchors never exhibit. Canon-heavy strata are flagged (recitation
   inflates agreement without inflating accuracy). The scorecard is a calibrated
   *estimate with flags*, not a measurement; the IA-OCR baseline supplies the
   independent second reading it lacks.

### IA-OCR corpus baseline — pilot (2026-07-23, PR #3341)

`scripts/eval/ia-ocr-baseline.mjs` → `results/ia-ocr-baseline-pilot-2026-07-23.md`.
200 sampled books with `ia_identifier`, IA's own non-generative OCR fetched and
page-aligned by text probes: 115 books aligned, 2,276 page rows scored, zero AI
cost. Chinese strata are EXPECTED-COLLAPSE controls (0–1 of 30 books aligned,
per the Tesseract-typography lesson) and Greek/Hebrew 1500s mostly unalignable —
those cells are unmeasurable, not model advantage. Where IA is competent
(19th/20th-c roman type), ours-vs-IA disagreement is an upper bound on combined
error from an independent reading with no memorization channel; 16th-c Latin
agreement (27.2%) says the baseline collapses on ligatures, as predicted. The
corpus-scale diff-in-diff (use (c) in the experiment entry) needs the full
harvest, not this pilot.

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

**Priority order (Derek, 2026-07-23) — reader-first, then membership, then expansion.**
The organizing question is not the research agenda's but the reader's: *how accurate is
the text Source Library serves?* Sequence: (1) the calibration scorecard (free, answers
the reader question); (2) the IA-OCR corpus baseline (free, zero AI cost); (3) the
degradation/occlusion membership pilot (~$2–5, validated against the pinned pages);
(4) more pairs / the canonicity slope. Details below.

- ~~**Calibration scorecard — the reader-first deliverable (free).**~~ RUN
  2026-07-23/24, twice in parallel (PR #3336 = canonical implementation, #3342
  closed as duplicate; results 17–19 above). Fitted on non-canonical anchor
  pages only, applied to the revision-pair corpus per stratum. Remaining from
  the original plan: the **/research product page** (needs Derek's sign-off on
  publishing the numbers), the per-book/per-page confidence surface in the
  reader, and — the binding measurement gap — **non-canonical spaceless
  anchors** (every Chinese anchor is a canonical classic, so no spaceless fit
  exists and CJK/Tibetan cells get agreement flags only). Original notes: pilot
  r=0.75 noncanon vs 0.49 canon — recitation fakes agreement; stratify by
  script and era.

- **IA-OCR corpus baseline (Derek, 2026-07-23; free, zero AI cost).** PILOT RUN
  2026-07-23 (PR #3341; results section above): 200 books, 115 aligned, 2,276
  page rows. REPLICATED 2026-07-24 on Hetzner with a fresh independent 200-book
  sample (100 aligned, 1,971 rows — `ia-ocr-baseline-pilot-2026-07-24.*`):
  identical stratum rank ordering, per-stratum agreement within ±9pp (Latin
  1500s 33.7 vs 27.2; English 1900s 83.6 vs 87.4; French 1800s 82.1 vs 80.5;
  German 1600s 47.3 vs 47.7) — the table is stable across samples, not a
  sampling artifact. Combined evidence: ~4,200 pages / ~215 aligned books.
  Still open: the true full-corpus harvest needs a `--per-stratum` flag
  (the sample stage's built-in stratum caps ignore `--total`), and the
  within-band diff-in-diff.
  Original design: most exportable
  books carry an `ia_identifier`, and Internet Archive publishes its own OCR
  (ABBYY/Tesseract-class) for the same scans we imported — downloadable per book, page
  numbering mappable to ours. Three uses, in increasing strength: (a) a corpus-scale
  agreement/error measurement between free-corpus OCR and ours, by script and century
  — the cheap public "how much better is VLM OCR" number; (b) a second *independent*
  reading for consensus, complementing the revision pairs (which share the Gemini
  family and are NOT independent); (c) the big one: IA's engine is **non-generative —
  it cannot recite** — so this is the corpus-scale version of the diff-in-diff
  baseline below, already computed:
  (Gemini − IA)|canonical − (Gemini − IA)|non-canonical, at thousands-of-books scale.
  MUST be scoped by the Tesseract lesson: the baseline's competence tracks typography
  (fine on 19th–20th-c roman type, hopeless on 16th-c ligatures and CJK), so compute
  within script AND era bands, and treat baseline-collapse cells as unmeasurable, not
  as model advantage. Implementation is a scripts-side harvest
  (`ia_identifier` → djvu.txt/hOCR fetch → page-align → score with the existing
  metrics), no model calls.

- **Degradation-robustness membership test (Derek, 2026-07-23) — "is this book in the
  training data?"** Reading needs pixels; reciting does not. Degrade the page image
  and the accuracy-vs-degradation curve separates the two: steep = reading, flat =
  memory carrying the load. Evidence already in hand: sonnet5 reads the Iliad *better*
  on the smudgy 1555 manuscript (99.4%) than on clean Teubner print it cannot recite
  (97.3%), and the manuscript's canonical page reads 100.0% (result 9). Key design
  points: degrade by BLUR/NOISE, not resolution alone (result 6: resolution effects
  are truncation-mediated — the Hebrew page *improved* when shrunk); the test is
  naturally within-page (native vs degraded, difficulty controlled by construction);
  and it has a reference-FREE mode — compare the model's degraded-image output to its
  own native-image output, so it can run on books with no transcription at all.
  End state: a per-book recitation-risk scanner. Positioning: Park et al. 2511.03774
  do perturbation-based contamination detection for VLM *benchmarks* (semantic
  perturbation, VQA); the image-channel dose-response for OCR, keyed to specific held
  editions, is unclaimed. Commercial corollary: "this book is demonstrably in training
  corpora" vs "this corpus demonstrably is NOT" are both evidence-backed statements
  the licensing track can use.

- ~~**Occlusion cloze pilot**~~ — RUN 2026-07-23 (results 13–16): silent fill-in
  confirmed and graded per passage (the first canonicity-slope data); blur arm
  delivers a geometry-free manuscript confirmation; v2 needs passage-targeted
  masks + computed overlap. Original spec follows.
  Mask a band of the page and read what the model emits for pixels that do not exist.
  A reading model loses exactly the band; a reciting model fills it in. Text produced
  for occluded regions is per-page, reference-free proof of recitation.
  - **Pages:** the four within-work pairs (8 pages) + 2–4 additional canonical pages
    (Genesis 1 Hebrew, Analects/ctext if plumbed) — every page has known canonicity,
    so the pilot validates the detector against labels (target: detector separates
    canon from noncanon; the pairs are the cleanest validation since page style is
    constant within a pair).
  - **Manipulations:** (i) occlusion: solid-fill horizontal band covering ~20–25% of
    the text block (mid-column, margins left visible so layout parsing survives);
    (ii) blur ladder: Gaussian σ ≈ 1/2/4 px at 2000px width for the dose-response
    curve. Harness: add `--occlude=frac` and `--blur=sigma` to qa-eval next to the
    existing `--width=` (sharp composite / blur), arms tagged `@occ25`, `@blur2` per
    the `@wN` convention.
  - **Models:** lite (zero truncation — clean curves) + sonnet5 (strong reader) ×2
    runs. ~8–12 pages × 2 models × 4 arms × 2 runs ≈ 130–190 calls ≈ $2–5.
  - **Metrics:** occlusion fill-rate = fraction of masked-region reference tokens
    reproduced anyway (canonical pages: expect >0 under recitation; non-canonical:
    ~0). Degradation slope = accuracy (or native-output self-agreement, for the
    reference-free mode) vs blur level. Also record whether the model *mentions* the
    mask — silent fill-in vs flagged gap is itself a finding.
  - **Confounds to log:** blur hits small/dense type harder (stratify by page_class);
    the mask could be described rather than filled (that's a pass, not a fail);
    prompt says nothing about the occlusion.

Earlier planned experiments (status as of 2026-07-23):

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
- **Agreement→accuracy calibration** — superseded by the *calibration scorecard*
  entry above (same experiment, reader-first framing + product form). Original notes:
  on non-canonical rows only (consensus is NOT
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
- ~~**Within-work canonicity gradient**~~ — FIRST TRANCHE RUN 2026-07-23 (results
  9–12): four pairs pinned (PR #3320), graded `canonicity_grade` + `same_work_contrast`
  fields added, swept for ~$1.2. The manuscript pair delivers the clean 3–9pp gradient;
  print pairs are 0–2pp; one pair inverts on page difficulty (design lesson: same
  quire, not just same work). Remaining from the original design: more pairs
  (especially manuscript + CJK — ctext works are hardcoded in
  `build-ctext-groundtruth.mjs`, needs its own plumbing), and converting the two-cell
  contrast into a graded per-passage canonicity *slope*. Original rationale (Derek,
  2026-07-19) — the design upgrade the
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
- **Non-generative baseline → difference-in-differences.** Corpus-scale
  implementation now exists for free: the *IA-OCR corpus baseline* entry above (IA's
  ABBYY/Tesseract output on our own imported scans). The anchor-page Tesseract/Kraken
  version below remains useful for pages without an `ia_identifier`. Original
  rationale: the strongest identification
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

- n=44 pages, unbalanced cells (12 canonical / 32 non-canonical; four books now
  carry within-work pairs, but each pair is still one page per side, and only two books
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
- **The canonical/non-canonical contrast is confounded with LAYOUT, and no metric
  fixes it.** Canonical texts attract commentary, so canonical pages carry more
  interleaved apparatus (bracket width 10.4pp vs 1.8pp). Free-skip scoring ignores
  that material (crediting verbosity); windowed scoring charges for it (penalising
  canonical pages). The two bounds are biased in OPPOSITE directions with respect to
  the contrast being measured. This is why the within-work gradient is a
  prerequisite and not a refinement: only same-work, same-edition, same-layout pages
  hold the confound constant.
- Passage-scoped accuracy is BRACKETED, not point-estimated: free-skip is an upper
  bound (flatters noisy output), windowed is a lower bound (charges legitimate page
  material interleaved inside the passage — marginal cross-references between verses
  take a correct Vulgate transcription from 100% to 65%). Report both; the bracket
  width itself measures how much non-reference material sits inside the span.
- Tesseract is not a usable baseline for CJK (0-13% on woodblock) and its competence
  tracks TYPOGRAPHY, not language: ~80-90% agreement with Gemini on 19th/20th-c roman
  type (English 1888, Dutch 1931, German 1901, Latin CSEL 1890), far lower on 16th-c
  type with long-s and ligatures. A baseline arm must be scoped to material the
  baseline can actually read, or its collapse is misread as model advantage.

## CHR 2027 outline (2026-07-24; draft master: `paper/reading-or-reciting-chr2027.md`)

Long paper, 6,000 words excl. references/tables (tables are free space — push detail
there), ACH LaTeX template, double-blind until Oct 23 notification (arXiv preprint
permitted; the submitted PDF must not link named repos — review copy uses an
anonymized dataset mirror and refers to "a digital library of historical sources").

1. Introduction (~700w) — the 100.0%-on-a-1555-manuscript hook; ground-truth supply
   = contamination; contributions.
2. Related work (~650w) — contamination/memorization; OCR eval tradition; consensus
   methods; generous ¶ differentiating 2605.27750 (deliberate title echo).
3. Dataset & design (~900w) — 44 pages, covariates, anti-recitation protocol told
   via the deleted-rows incident, within-work pairs, license-gated references,
   outcome battery.
4. Measuring the subsidy (~1,000w) — within-work pairs (manuscript 3–9pp, print
   0–2pp, behavioral collapse on repetitive text, Zohrab inversion as design
   lesson); same-book Virgil; pooled-statistic instability AS the point.
5. Reference-free detection (~1,000w) — occlusion cloze (27/28 silent fill-in;
   excess = graded canonicity slope +37→−6; v1→v2 correction told honestly); blur
   as geometry-free twin; predictability confound. Star figure: masked page +
   recited output.
6. Consequences for evaluation practice (~800w) — consensus non-independence
   (r 0.75 vs ~0.5; 110K-pair structure); conditional/unconditional ranking
   inversion; IA non-generative baseline (replicated ±9pp) + diff-in-diff frame;
   prescription: canonicity labels on historical-OCR benchmarks.
7. A library certifying itself (~450w) — the calibration scorecard as deployed
   practice; uncalibratable strata stated as such; the library is the instrument.
8. Limitations (~350w). 9. Conclusion (~200w) — the certificate framing.

Tables: T1 within-work pairs / T2 fill-in excess / T3 IA script×century (both
samples) / T4 outcome inversion. Figures: F1 masked-Aeneid + recited output, F2
blur curves. Appendix: prompts, mask rects, 9-model comparison, ablations.

Timeline: full draft Aug 4 → number verification vs JSONLs Aug 5–8 → Derek read +
freeze Aug 10–11 → anonymize + submit Aug 12–13 (AoE buffer). Notification Oct 23;
camera-ready Nov 13; Manchester Jan 6–8.

## Venue / form — DECIDED 2026-07-24

- **Venue: CHR 2027** (Computational Humanities Research, Manchester, 5–8 Jan 2027).
  **Submission deadline: 2026-08-14 AoE** — three weeks from decision date; the
  deadline is the schedule. Rationale: exact audience (computational methods for
  cultural heritage / the people running digitization pipelines), archival
  proceedings, and the only strong venue whose window lands inside the scoop
  horizon (NLP4DH 2026 already ran in July; its next deadline is ~Mar 2027).
- **At submission time**: arXiv preprint + blog research note (house pattern) go up
  the same week for dated priority.
- **Title: keep "Reading or Reciting?"** as the deliberate, cited echo of
  "Reading or Guessing?" (2605.27750) — recitation vs guessing IS the distinction
  between the papers; say so in the related-work paragraph.
- **Dataset: Hugging Face** (Derek, 2026-07-24), named
  **`sourcelibrary/reading-or-reciting`** (namespace verified unclaimed
  2026-07-24). Card + publish script: `scripts/eval/dataset/hf/` — one-time HF
  org/token setup is Derek's, then `publish.sh v0.3`. Zenodo remains available
  later if a DOI is wanted for the paper's camera-ready; HF revision tags carry
  versioning until then.

## Drafting brief (the prompt to commission a draft)

Nothing above is prose. This section is the commissioning brief for whoever writes
the draft — human or model. It exists because the failure mode of a one-shot "write
the paper" prompt is confident overclaiming, and **a paper arguing that benchmark
scores are inflated cannot itself inflate.** The brief is designed to make the
honest version the easy version.

### Sequence: note first, paper second

Draft the **blog research note** (~1,500 words) before the paper. Compression is a
filter: a claim that cannot survive 1,500 words does not belong in the paper's
abstract either. The note is also citable and dated, which stakes the claim while
the paper is written (see scoop watchlist).

### Inputs — read in this order, and re-derive every number

1. This document (claim, contributions, outcome measures, limitations).
2. **Regenerate the numbers, do not copy them from prose**:
   `node scripts/eval/report-canonical-gap.mjs` and `node scripts/eval/report-arms.mjs`
   over `scripts/eval/observations/ocr-observations-<date>.jsonl`.
3. `scripts/eval/dataset/v0.2/README.md` — the datasheet, caveats, and licensing.
4. The handoffs `.claude/handoffs/2026-07-19-noncanon-eval-{continuation,v02}.md`
   for provenance and the incidents behind the design.

This document has carried **two generations of results**. Any figure that appears
in prose but not in a regenerated report is superseded. The canonical example: the
pooled subsidy once read `pro +2.2pp / sonnet5 +2.6pp` at n=23 and does not survive
at n=40. Reprinting it would be the exact error the paper is about.

### The claim ladder

**Tier A — assert plainly.** Well supported, robust to the rebuild:
- The outcome-battery **ranking inversion**: conditional accuracy ranks Pro first;
  unconditional accuracy puts the cheapest model and the production pipeline ahead
  of it. Survived tripling the page count.
- **Recitation is real and demonstrable**: two canonical rows were deleted from our
  own dataset after page-scan audits proved letter-perfect emission of text not
  printed on the page.
- **Consensus is not independent on canonical text** — the failure condition for the
  Consensus Entropy line. The corpus arm supplies the converse (agreement
  *understating* quality on marginal text).
- **Resolution effects in 600–2000px are mediated by truncation, not legibility.**
- The **annotation prompt costs ≈1pp** unconditional accuracy, alignment unchanged.

**Tier B — assert only with the control named in the same sentence.**
- The memorization subsidy itself: 1.0–5.4pp, **same-book**, and the sentence must
  say it rests on **two books** (1580 Virgil, 1566 Louvain Vulgate).

**Tier C — must NOT be asserted.**
- The **pooled** canonical/non-canonical gap as an effect. It is reported as a
  *methodological* result: pooling across unmatched pages destroys the signal, which
  is why matched contrasts are the design. Do not launder it into a headline number.
- A **canonicity × prompt interaction** — the signs disagree across models.
- Any **causal** account of why small models show larger gaps.
- "First to study", "never studied in transcription", or any unqualified priority
  claim. Use the dossier's formulation: proved for ASR (Tseng et al. 2505.22251),
  **unmeasured in OCR**. Cite Karamolegkou et al. 2605.27750 in the first paragraph
  and differentiate generously.

### Hard prohibitions

- **No citation that is not already in the dossier above.** Every entry there was
  abstract-checked. Adding a remembered reference to a contamination paper is fatal;
  if a new citation is genuinely needed, flag it for verification rather than
  inserting it.
- **No number without a reproduction path.** The draft ships with a numbers table
  mapping each figure to the command and file that produce it.
- **Do not bury the negative result.** That the pooled gap collapsed under a larger
  sample is the paper's credibility, not its embarrassment. It belongs in the
  abstract, not a footnote.
- **No quotation from a source not verified verbatim** (house rule; `get_quote` for
  anything from the corpus).
- Report n on every claim. Cells are unbalanced and small.

### The sentence to build around

The dossier's assessment is that this may be the sharpest available framing, and no
prior work states it: **the ground-truth supply and the contamination are the same
variable.** The texts with free published transcriptions — the only texts cheap
enough to build historical OCR benchmarks from — are precisely the texts the models
have memorized. The field's ground truth is contaminated by construction.

### Self-check before handing the draft back

1. **Numbers table**: every figure, its regenerating command, and its n.
2. **Claims audit**: each claim tagged A/B/C against the ladder; any C-tier claim
   that crept in gets cut or demoted.
3. **Citation audit**: every reference present in the dossier; none invented.
4. **Adversarial referee pass**: a second, independent agent instructed to *reject*
   the draft — strongest available objection to each claim, with the sample sizes in
   hand. Fix what survives. This is the same pattern the first-translation
   verification uses, and for the same reason.
