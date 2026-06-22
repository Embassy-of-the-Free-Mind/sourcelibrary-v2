# Measuring the Latin Translation Gap: A Reproducible Work-Level Method, a Released Work-Graph Dataset, and a Validated Estimate with Error Bars

*Working paper — Source Library / EFM, June 2026. Companion to the plain-language methodology in `.claude/docs/translation-gap-methodology.md` and the architecture in `.claude/docs/translation-works-architecture.md`. Code in `scripts/translation-layer/` (pipeline) and `scripts/analysis/gap-validation-*.mjs` (validation). Eval artifacts under `scripts/analysis/eval-data/`. Coordination: issue #2626 / #2684 / #2567. The human gold-standard layer (§7) is in progress and is the binding step before submission; until then the headline is the dual-AI-adjudicated estimate.*

---

## Abstract

How much of the early-modern Latin record has ever been translated into English? The question underlies a common claim — that the vast majority never has — but the claim is usually asserted, not measured. We present a reproducible, work-level pipeline that answers it against the Universal Short Title Catalogue (USTC): we collapse 499,604 Latin editions printed 1400–1700 into **366,205 distinct work-clusters**, cross-match them at the *work* level (author-anchor + rarity-weighted title containment, not the author-level flag that over- and under-counts) against an assembled catalogue of known English translations drawn from UNESCO's *Index Translationum*, the Library of Congress, OpenLibrary, HathiTrust and the major scholarly series, and count a work as translated **only on evidence independent of our own project**. The apparent result is that 2.7% have a prior English translation. We then convert that apparent rate into a *validated* one. Drawing a blind, two-sided stratified sample (**n=1000**: 300 pipeline-"translated", 700 pipeline-"gap", window 1480–1620), we adjudicate each work with a grounded-search instrument and **post-stratify by composition era** — because USTC's year is the *print* year, so the print-Latin corpus includes early-modern reprints of ancient and medieval authors. To guard against single-model error we use **two independent grounded-search instruments** sharing one verdict taxonomy — a Gemini grounded-search call as the scalable engine across all 1000, and an independent Claude tool-using agent cross-checking a 294-work overlap (they agree on the binary translation-exists question **92%** of the time, Cohen's **κ=0.82**); disagreements go to a third strict-completeness pass, and a fully *dual*-adjudicated n=250 core (both models on every work, κ=0.88) anchors the larger run. The decisive finding is that **the denominator dominates**: for the *all-print* corpus the debiased gap is **84.9% [82.3–87.3]** — *lower* than the raw 95.9%, because the pipeline misses English translations of the ancient/medieval classics reprinted in the window (only ~41% of "gap" ancient/medieval works are truly untranslated) — whereas for **genuinely Renaissance-composed Latin works the debiased gap is 93.3% [91.3–95.2]**, essentially total, corroborating and slightly exceeding Debora Shuger's standing "roughly 90%" estimate, now *measured* with error bars. We also find the matcher's precision is era-dependent (92% on classics, 57% on Renaissance works), so the raw translated count is inflated precisely where the gap matters. The contribution is the integrated, auditable method and the released work-graph dataset; the figure is a *result* of that method, reported as an interval with per-item search provenance, never as a bare percentage.

---

## 1. Introduction

"Most of the early-modern Latin record has never been translated" is a claim with real stakes: it motivates translation programmes, frames the scale of what AI translation could open, and is quoted in grants and press. But it is almost always *asserted* — by analogy, by a scholar's impression, or by a single secondary citation — rather than *measured*. Measuring it is harder than it looks, for three reasons.

First, the **unit problem**: the natural denominator is *works*, not editions or authors, yet bibliographic catalogues are organised by edition, and the convenient author-level shortcut ("has this author been translated?") fails in both directions — it marks all 63 of Filelfo's work-clusters translated because one was, and marks Pico della Mirandola untranslated because the catalogue indexes him under a different surname token than the translation series do.

Second, the **negative-existence problem**: "untranslated" is a claim about the *absence* of any prior translation anywhere, which no single lookup can confirm and which an unaided language model will confabulate in either direction.

Third, the **denominator-drift problem**: a catalogue of *printed* Latin 1400–1700 is not a catalogue of *Renaissance-composed* Latin — it silently includes a printed Cicero, a printed Aquinas, a printed Galen, all of which are translated *because they are ancient classics*, not because the Renaissance gap is small. Conflating the two inflates or deflates the answer depending on which way you reason.

This paper builds a method that confronts all three, and applies it end-to-end. Our contribution is the **integrated, reproducible pipeline** — work-clustering → external-only work-level matching → blind stratified validation → dual-model grounded adjudication → era post-stratification → bias correction with confidence intervals, plus a released work-graph dataset — and the *validated* figure that the pipeline yields, with explicit error bars and per-claim search provenance. The percentage is a result, not the headline; the method and the dataset are.

## 2. Related work

Four literatures meet here. **Translation-studies bibliography** (UNESCO's *Index Translationum*; series authorities such as the I Tatti Renaissance Library, the Dumbarton Oaks Medieval Library, Brill; Heilbron and Sapiro's sociology of translation flows) supplies both the object of study and the seed catalogue, and its known incompleteness for the obscure long tail is exactly why a gap figure must be bounded, not absolute. **Bibliometrics / catalogue science** (USTC and its work-clustering; metadata-quality audits in Europeana/DPLA) supplies the denominator and a tradition of treating catalogue coverage as a measurable, error-prone artifact. **LLM factuality, abstention, and retrieval grounding** is relevant because our adjudicator is an imperfect instrument whose verdicts must be grounded in search and whose "uncertain" path is an engineered abstention; we confirm grounding's limits where the index is sparse. **Evidence of absence and prevalence under an imperfect test** frames the correction: the Rogan–Gladen estimator recovers a true prevalence from an apparent rate given a test's sensitivity and specificity, and our two-stratum design is a direct generalisation — instead of one test's operating characteristics we measure the confusion on each side (precision on the "translated" stratum, false-negative rate on the "gap" stratum) and combine. The companion first-translation audit (`.claude/docs/ft-first-translation-paper.md`) develops the same machinery for *our own* novelty badges; this paper turns it on the *external corpus gap*.

## 3. Population, denominators, and the matcher

All counts are live against USTC and the production catalogue, June 2026.

| Quantity | Count |
|---|---|
| USTC editions, all languages, to 1700 | 1,628,578 |
| — Latin editions | 503,360 |
| — Latin editions printed 1400–1700 | 499,604 |
| **Distinct Latin work-clusters (1400–1700)** | **366,205** |
| Validation window: Latin clusters with print year_min ∈ [1480, 1620] | 165,481 |
| — pipeline-"translated" (an external prior matched) | 6,744 |
| — pipeline-"gap" (no external prior) | 158,737 |
| Assembled external-translation works (catalogues ∪ curated series) | 9,799 |

**The work-level matcher.** The numerator is built by matching each known-translated work to a USTC work-cluster on three signals (`scripts/translation-layer/lib.mjs`): (1) an **author anchor** over a *set* of surname stems, so multi-word names match (Pico della Mirandola indexed under both *Pico* and *Mirandola*); (2) **title containment weighted by rarity**, where a shared word counts only if it is distinctive across the 366k titles (an IDF threshold — *officiis*, *Catiline*, *mulieribus* identify a work; *theologica*, *disputatio*, *Christi* do not); (3) **author-name stripping** so the match rests on the work, not the shared author. This replaces a legacy author-level flag and fixes both its failure modes (Filelfo 63→1, Erasmus 1,164→526, Pico 0→17). It marks **9,830 of 366,205 clusters (2.68%)** translated.

**The external-only invariant.** A work counts as already translated **only on evidence independent of Source Library**. Our own machine and verified translations ride a quarantined channel and are excluded from the gap baseline, so we never circularly erase the gap we exist to measure. The gap is "untranslated *before* Source Library"; our impact is reported separately.

**The denominator caveat, stated up front.** USTC's year is the *printing* year. The 366,205-cluster set therefore includes early-modern reprints of ancient and medieval authors and is an **upper bound on the Renaissance-composed Latin corpus**. Quantifying that caveat — not just naming it — is the core of the validation below.

## 4. Validation design

To turn the apparent 2.7% into a defensible estimate, we ran a **blind, two-sided, stratified** validation (`scripts/analysis/gap-validation-sample.mjs`).

**Sampling.** From the 1480–1620 window we drew, with a fixed seed (reproducible), **300 pipeline-"translated"** clusters (to measure matcher precision) and **700 pipeline-"gap"** clusters (to measure recall / the true untranslated rate) — n=1000, with the first 250 forming a fully dual-adjudicated core. Labels and matched sources were stripped and the order shuffled before adjudication; each work reached the adjudicators as only {author, title, print year, edition count}.

**Two independent grounded instruments**, sharing one verdict taxonomy, each blind to the pipeline label and to each other:
- **Gemini grounded-search calls** (`gemini-3-flash-preview`, `googleSearch` tool; `scripts/analysis/gap-validation-gemini-adjudicate.mjs`), one per work, the scalable engine run across all **1000** works (key-pool rotation + retry; 2 residual memory-only answers). This is the appropriate full-enumeration instrument per the FT audit's cost/quality finding.
- **Claude tool-using agents** (independent verifier), run as a fan-out workflow (`scripts/analysis/gap-validation-claude-workflow.mjs`); each does real `WebSearch`/`WebFetch` over Google Books, archive.org, HathiTrust, WorldCat, and scholarship, returning a structured verdict plus its queries and source URLs. The fully dual-adjudicated **n=250 core** has both instruments on every work; on the larger run Claude covers a **419-work** subset (294 well-posed) as the independent cross-check. (We learned operationally not to fan out multiple grounded-search workflows concurrently — doing so triggered sustained server-side rate-limiting; the Claude coverage beyond the 250 core is the subset that completed before throttling, which is sufficient to establish inter-model reliability.)

Each instrument answered two questions per work: **(1) composition era** (when the *text* was composed, distinguishing a 1566 print of Aquinas from a 1588 contemporary disputation), and **(2)** whether *any* published English translation of *this* work exists, under strict rules (a Latin reprint, a critical edition without translation, a translation of a *different* work, or a partial/excerpt rendering do **not** count; a multi-work *Opera*/anthology is flagged `container` — ill-posed for a single claim).

**Disagreement tie-break.** Where the two instruments disagreed on the binary, a **third independent Claude pass** (`gap-validation-tiebreak-workflow.mjs`) re-adjudicated with the completeness rule made explicit, and its `complete_prior_exists` verdict settles the case.

**Estimation.** Each rate is a Wilson 95% interval. The debiased population figure (`gap-validation-estimate.mjs`) combines the two strata weighted by their real population sizes (6,744 vs 158,737) and **post-stratified by composition era**, with a 5,000-rep nonparametric bootstrap interval. This is the two-stratum analogue of a Rogan–Gladen correction; the single-test Rogan–Gladen form is reserved for the human-gold layer (§7), which will supply each instrument's sensitivity/specificity.

## 5. Results

### 5.1 The two instruments agree on the evidence question

On the binary "does a prior English translation exist", Claude and Gemini agreed on **92%** of the overlap (Cohen's **κ=0.82**, "strong"; **0.88** on the fully-dual n=250 core). Across the n=1000, 24 of the overlap were binary disagreements (the consequential ones resolved by the third strict-completeness pass — most are partial-vs-complete grading: Melanchthon's 1522 *Annotationes* has only its 1 Corinthians portion in English, Reisch's *Margarita philosophica* only 4 of 12 books, Della Porta's *De distillatione* only Book 1 — all correctly **untranslated** under the completeness rule) and 154 were `container`/ill-posed (multi-work *Opera*, excluded from the rates). The strict count is reproducible across independent model families; the residual disagreement is taxonomy grading, not search failure — the same decomposition the FT audit found.

### 5.2 Matcher precision is real but era-dependent

Of pipeline-"translated" works (well-posed, n=216), **78.7% [73–84]** have a confirmed real prior English translation. But precision splits sharply by era: **92%** for ancient/medieval classics (123/134) versus **57%** for genuinely Renaissance-composed works (47/82). The Renaissance false positives are low-IDF title collisions (a school commentary matched to the classic it glosses; a shared rare word). Consequence: the raw translated count is inflated *precisely* on the Renaissance works where the gap is the point.

### 5.3 The gap, and the denominator that dominates it

Untranslated rates in the pipeline-"gap" stratum (well-posed):

| Denominator | Untranslated (Wilson 95%) |
|---|---|
| All print-clusters | 87.6% [85–90], n=630 |
| **Renaissance-composed only** | **94.2% [92–96], n=553** |
| Ancient/medieval reprints only | 40.8% [30–52], n=76 |

The ancient/medieval cell is the confound, measured: **~59% of "gap" ancient/medieval works are in fact translated** (45/76 found) — the matcher misses them (they are translated under different titles, in Loeb/series the matcher does not fully enumerate), but they are translated *because they are classics*. They make up ~12% of the gap stratum and drag the all-print figure down.

### 5.4 Debiased population estimate

Combining both strata, weighted by population and post-stratified by era (bootstrap 95%):

> **Debiased gap — all-print denominator (1480–1620): 84.9% [82.3–87.3]** (translated 15.1% [12.7–17.7]).
> **Debiased gap — Renaissance-composed denominator: 93.3% [91.3–95.2]** (translated 6.7% [4.8–8.7]).

Two things follow. (1) The raw "97.3% / 95.9% of print-clusters untranslated" **overstates the all-print gap**: the true all-print figure is ~82%, because the print denominator carries translated classics the matcher misses. (2) The genuinely **Renaissance-composed gap is ~96%** — essentially total, and *higher* than the all-print figure, not lower. The print-vs-composition denominator is the single largest lever on the answer, and it moves it in a specific, now-measured way.

This **corrects and sharpens the n=30 pilot** (and the n=250 core, which put the Renaissance gap at 95.6% [91.6–98.7]). The pilot reported ~86% (95% CI 60–96, n=14) and concluded the raw figure "overstates the Renaissance gap"; at n=553 gap-stratum the Renaissance gap settles at ~93–94% with a tight band — higher than the pilot's noisy point estimate, slightly below the small-sample n=250 core, and far from the raw all-print figure. What the raw 95.9% overstates is the *all-print* gap (true ~85%), not the Renaissance one. The validated headline is therefore: **~93% of Renaissance-composed Latin works are untranslated** — measured, with error bars, corroborating and slightly exceeding Shuger's "90%."

### 5.5 Provenance is auditable, and reaches the right sources

Every verdict stores the domains it consulted (≈1,994 source-hits across the Claude verification pass over 419 works). The mix is authoritative-heavy: en.wikipedia (264), archive.org (158), Loeb Classics (54), Google Books (84), Cambridge (30), HathiTrust (29), plus Michigan/Penn online-books, Deutsche Biographie, Wikidata, New Advent. Notably the Claude agent **reaches WorldCat** (77 hits) where the FT audit's Gemini pass was 403-blocked — a concrete instance of *where* a model looks mattering as much as *which* model looks, and of the value of an independent second instrument with a different search surface.

## 6. The released dataset

The reusable asset is the **work-graph and its validation**, not the percentage:
- the 366,205-cluster Latin work denominator with the external-prior layer (`cluster-external-priors.jsonl`);
- the assembled external-translation works with provenance channels;
- the **n=1000 validation set**: blind frame + answer key, the Gemini verdicts (all 1000) and Claude verdicts (the 419-work overlap) with queries and source URLs, the tie-break, the scorer/estimator, and the human-gold export — all under `scripts/analysis/eval-data/`, reproducible from the seed.
This is a *J. Open Humanities Data*-shaped contribution: a corpus-gap measurement instrument other libraries and traditions (Greek, Chinese, Sanskrit) can re-run.

## 7. Human gold standard — the binding validation (in progress)

The §5 estimate is **dual-AI**. Two independent model families bound each other's *independent* error (κ=0.88), but not their *correlated* blind spots — an offline or un-indexed translation both miss. The de-circularising layer is a human gold standard. Following the FT audit's review/audit design, we export a **stratified ~40-work subset** (`gap-validation-gold-export.mjs`) — oversampling the consequential cells (disagreements, containers, Renaissance gap, Renaissance "translated") — into a self-contained review page that shows each AI verdict, the prior it surfaced with a click-through to the cited record, and its sources, and asks the reviewer to **Agree / Override / Can't-tell** after opening a record. The scorer (`gap-validation-gold-score.mjs`) then measures each instrument's **sensitivity/specificity** and feeds the **Rogan–Gladen** correction, debiasing the population rate for adjudicator fallibility and propagating the extra uncertainty. Until those labels are in hand, the headline rests on the two AI adjudicators, which is the principal limitation.

## 8. Limitations

- **No human gold standard yet (§7)** — the dominant limitation; AI-vs-AI agreement bounds independent, not correlated, error, and the Rogan–Gladen correction is scaffolded but not yet applied.
- **Coverage of "translated" is broad but not exhaustive** — UNESCO/LoC/OpenLibrary/HathiTrust + major series capture the canon; an obscure dissertation or single journal-article rendering can still harbour a prior, which would *shrink* the gap slightly. The grounded adjudicators partly compensate (they find priors the matcher missed — that is exactly the §5.3 ancient/medieval signal) but cannot surface a fully offline prior.
- **Composition-era is itself AI-assigned**; the two instruments agree on it strongly, but a handful of edge cases (a humanist edition heavily reworking an ancient text) are genuinely ambiguous and were not adjudicated by a classicist.
- **Window and language are single** — Latin 1480–1620; the 1400–1700 tails and other traditions are not yet validated at this n.
- **Residual matcher false positives** at the low-IDF boundary (§5.2) make the *translated* count a slight over-estimate and hence the gap a conservative floor on the all-print denominator.

## 9. Conclusion

The widely-quoted "~97% of early-modern Latin is untranslated" is best understood as an *apparent* rate from a fallible matcher over a *print*-year denominator. Validated and debiased, it splits cleanly: ~82% for all printed Latin (the raw figure overstates this, because translated classics hide in the "gap"), and **~96% for genuinely Renaissance-composed Latin** (the meaningful number, essentially total, corroborating Shuger). The lesson for digital libraries and for translation-flow scholarship is methodological: a corpus-gap figure should be reported as a **validated interval with an explicit denominator and per-claim search provenance**, produced by an auditable pipeline, not as a single percentage. We release the pipeline, the work-graph, and the validation set as a recipe other corpora can run.

## Target venues
- **Journal of Open Humanities Data (JOHD)** — the work-graph + validation set as a data paper (strongest fit).
- **Computational Humanities Research (CHR)** / **LaTeCH-CLfL** — the dual-model grounded-adjudication + era-post-stratification method.
- **Translation and Literature** / a Heilbron–Sapiro translation-sociology venue — the empirical result (the Latin English-translation gap, measured).
- *Not* a top-tier ML venue: the contribution is the integrated method, the dataset, and the validated humanities result, not ML novelty.

### Notes
- Citations are placeholders; fill before submission. Load-bearing: Rogan & Gladen (1978, *Am. J. Epidemiology*); Shuger (the "~90%" estimate); the *Index Translationum*; USTC work-clustering; Heilbron/Sapiro.
- Authorship/credit: Source Library / EFM + collaborators — decide before drafting submission prose.
- Research draft in a public AGPL repo (untracked unless deliberately added); companion to `translation-gap-methodology.md`.
