# Measuring the Latin Translation Gap: A Reproducible Work-Level Method, a Released Work-Graph Dataset, and a Validated Estimate with Error Bars

*Working paper — Source Library / EFM, June 2026. Companion to the plain-language methodology in `.claude/docs/translation-gap-methodology.md` and the architecture in `.claude/docs/translation-works-architecture.md`. Code in `scripts/translation-layer/` (pipeline) and `scripts/analysis/gap-validation-*.mjs` (validation). Eval artifacts under `scripts/analysis/eval-data/`. Coordination: issue #2626 / #2684 / #2567. The human gold-standard layer (§7) is in progress and is the binding step before submission; until then the headline is the dual-AI-adjudicated estimate.*

---

## Abstract

How much of the early-modern Latin record has ever been translated into English? The question underlies a common claim — that the vast majority never has — but the claim is usually asserted, not measured. We present a reproducible, work-level pipeline that answers it against the Universal Short Title Catalogue (USTC): we collapse 499,604 Latin editions printed 1400–1700 into **366,205 distinct work-clusters**, cross-match them at the *work* level (author-anchor + rarity-weighted title containment, not the author-level flag that over- and under-counts) against an assembled catalogue of known English translations drawn from UNESCO's *Index Translationum*, the Library of Congress, OpenLibrary, HathiTrust and the major scholarly series, and count a work as translated **only on evidence independent of our own project**. The apparent result is that 2.7% have a prior English translation. We then convert that apparent rate into a *validated* one. Drawing a blind, two-sided stratified sample (**n=1000**: 300 pipeline-"translated", 700 pipeline-"gap", window 1480–1620), we adjudicate each work with a grounded-search instrument and **post-stratify by composition era** — because USTC's year is the *print* year, so the print-Latin corpus includes early-modern reprints of ancient and medieval authors. To guard against single-model error we use **two independent grounded-search instruments** sharing one verdict taxonomy — a Gemini grounded-search call as the scalable engine across all 1000, and an independent Claude tool-using agent cross-checking a 294-work overlap (they agree on the binary translation-exists question **92%** of the time, Cohen's **κ=0.82**); disagreements go to a third strict-completeness pass, and a fully *dual*-adjudicated n=250 core (both models on every work, κ=0.88) anchors the larger run. The decisive finding is that **the denominator dominates**: for the *all-print* corpus the debiased gap is **84.9% [82.3–87.3]** — *lower* than the raw 95.9%, because the pipeline misses English translations of the ancient/medieval classics reprinted in the window (only ~41% of "gap" ancient/medieval works are truly untranslated) — whereas for **genuinely Renaissance-composed Latin works the debiased gap is 93.3% [91.3–95.2]**, essentially total, corroborating and slightly exceeding Debora Shuger's standing "roughly 90%" estimate, now *measured* with error bars. We also find the matcher's precision is era-dependent (92% on classics, 57% on Renaissance works), so the raw translated count is inflated precisely where the gap matters. The contribution is the integrated, auditable method and the released work-graph dataset; the figure is a *result* of that method, reported as an interval with per-item search provenance, never as a bare percentage. §5.6–5.10 (added October 2026, #7778) give absolute counts, Source Library's share of the validated prior, a pace measured without the catalogue, and two robustness checks on our clustering: at work level the Renaissance gap is about 96%. §10 lists the figures safe to quote.

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

Two things follow. (1) The raw "97.3% / 95.9% of print-clusters untranslated" **overstates the all-print gap**: the true all-print figure is ~85% [82–87], because the print denominator carries translated classics the matcher misses. (2) The genuinely **Renaissance-composed gap is ~93% [91–95]** — essentially total, and *higher* than the all-print figure, not lower. The print-vs-composition denominator is the single largest lever on the answer, and it moves it in a specific, now-measured way.

This **corrects and sharpens the n=30 pilot** (and the n=250 core, which put the Renaissance gap at 95.6% [91.6–98.7]). The pilot reported ~86% (95% CI 60–96, n=14) and concluded the raw figure "overstates the Renaissance gap"; at n=553 gap-stratum the Renaissance gap settles at ~93–94% with a tight band — higher than the pilot's noisy point estimate, slightly below the small-sample n=250 core, and far from the raw all-print figure. What the raw 95.9% overstates is the *all-print* gap (true ~85%), not the Renaissance one. The validated headline is therefore: **~93% of Renaissance-composed Latin works are untranslated** — measured, with error bars, corroborating and slightly exceeding Shuger's "90%."

### 5.5 Provenance is auditable, and reaches the right sources

Every verdict stores the domains it consulted (≈1,994 source-hits across the Claude verification pass over 419 works). The mix is authoritative-heavy: en.wikipedia (264), archive.org (158), Loeb Classics (54), Google Books (84), Cambridge (30), HathiTrust (29), plus Michigan/Penn online-books, Deutsche Biographie, Wikidata, New Advent. Notably the Claude agent **reaches WorldCat** (77 hits) where the FT audit's Gemini pass was 403-blocked — a concrete instance of *where* a model looks mattering as much as *which* model looks, and of the value of an independent second instrument with a different search surface.

### 5.6 Three readings of the same 1,000 works (#7778)

Every figure below is given under three readings of the n=1000 verdicts, because they bracket the instrument error we can measure (`scripts/analysis/gap-validation-counts.mjs`, output `eval-data/gap-validation-counts.json`; 5,000-rep bootstrap, 95% intervals):

- **paper**: the published consensus (§4, §5.4), unchanged.
- **strict**: the same consensus, with a `translated` verdict whose relationship is `partial` counted as untranslated. §4 states that a partial rendering does not count, but the scorer (`gap-validation-score.mjs` `toBinary`) counts it. This matters most where it should not: 11 of the 32 Renaissance-composed works the matcher missed rest on a single Gemini `translated / partial` (Lauder's 1623 *Order of the Friers* for Capilupi's cento; Waterworth's 1848 Trent canons for the 1581 *Index*).
- **sonnet**: Claude Sonnet alone on all 1,000 (#7691). It finds fewer priors than the consensus (36 missed against 7 extra), so it reads as an upper bound on the gap and a lower bound on everything translated.

The paper's headline numbers are unchanged by this section. Of the three readings, *strict* is the one that applies the paper's own rule.

### 5.7 Absolute counts

The rates in §5.4 are over the 1480–1620 window (165,481 clusters), where the sample was drawn. To give counts for the whole 366,205-cluster corpus (print 1400–1700), we apply the window's per-stratum rates and era shares to the full pools (9,830 matched, 356,375 unmatched). **This is an extrapolation:** before 1480 there are more medieval incunabula, after 1620 more early-modern works, and neither tail was sampled.

| clusters, print 1400–1700 (extrapolated) | paper | strict | sonnet |
|---|---|---|---|
| (a) Renaissance-composed denominator D | 316,550 [307,089–325,373] (86.4%) | 318,854 [309,657–327,619] | 311,933 [302,520–321,022] |
| (b) translated, all print | 51,859 [43,101–61,476] (14.2%) | 41,774 [33,914–50,212] (11.4%) | 37,118 [29,831–44,712] (10.1%) |
| (b) translated, Renaissance-composed | 20,241 [14,356–26,827] (6.4%) | 13,789 [9,024–19,206] (4.3%) | 9,218 [5,524–13,425] (3.0%) |
| untranslated, Renaissance-composed | 296,309 [285,470–306,491] | 305,065 [294,790–314,635] | 302,715 [292,512–312,331] |

In the window alone (no extrapolation) the paper reading gives D = 141,896 [137,677–145,869], 24,961 [21,059–29,305] translated all-print and 9,530 [6,886–12,429] translated Renaissance-composed.

These are **cluster** counts. §5.10 shows a cluster is not a work, and that the difference is large on exactly the translated side. The work-level counts are in §5.10.

### 5.8 Source Library against the validated prior

**(c) Share.** #7751 counts 6,420 clusters readable on Source Library (≥90% of pages translated) and 5,766 of them with no catalogued prior. Against the validated count of everything translated before us, in the same cluster unit and denominator, the 6,420 are **12.4% [10.4–14.9]** of the prior total (paper), 15.4% [12.8–18.9] (strict) and 17.3% [14.4–21.5] (sonnet). In work units (phase 11's 5,234 readable works against the work-level translated count of §5.10) the share is 25.9% [20.6–33.5] (paper) to 36.6% [28.1–50.7] (sonnet). The units are not perfectly aligned: phase 11 groups works more loosely than the §5.10 judge, so the work-unit share leans high. Either way, **two-thirds is outside every interval**. The catalogue alone (9,830) made it look that way, and the catalogue sees roughly one Renaissance translation in five to ten (§5.9).

**(d) How many of SL's "no external prior" clusters have a translation anyway.** The n=1000 gap stratum puts the rate at which a matcher-unmatched cluster turns out translated at 12.4% [10.0–15.1] (paper; 9.7% strict, 8.4% sonnet). Applied to the 5,766, that is **714 [577–869]** (483 [369–606] under sonnet). The FT audit gives a second, independent estimate on our own books: 18.0% [14.7–21.7] of badged first translations have a real complete prior (§5.1 of `ft-first-translation-paper.md`, n=462), or **1,036 [850–1,253]**. The two populations differ (the FT pool was already filtered by a catalogue and search check, all languages), so we read them as a lower and an upper bound: of the 5,766, roughly **500–1,250 have an uncatalogued English translation**, leaving about **4,500–5,300** first translations in cluster units. This is before #7751's own correction for SL-side match errors (~85% precision on title-only links), which brings the cluster figure to about 5,000 and the work figure to about 4,300–4,800.

### 5.9 Pace, with catalogue capture

The pace figures in circulation ("about 40 Renaissance first translations a year at the 2000s peak", "seven thousand years") come from catalogue records counted by publication year (`/articles/translation-rate`). They assume the catalogue sees most translations. It does not.

**Capture.** We dated the first English translation cited for each of the 79 Renaissance-composed works the validation found translated (47 matched by the pipeline, 32 missed; by hand from the cited priors, `eval-data/gap-validation-translation-years.json`). Weighting each to its stratum, the matcher finds **15.4% [10.8–22.3]** of translated Renaissance-composed works in the window (paper; 19.9% strict, 24.8% sonnet). By period of first translation it shows no trend within its noise (paper reading): before 1700 16%, 1700–1899 9%, 1900–1979 18%, 1980–2025 16.3% [6.9–39.8], on 41, 9, 11 and 18 works. Matcher capture is a floor on catalogue capture (a catalogue row the matcher failed to link still counts in a by-year tally), but the order of magnitude is clear: **a catalogue tally sees roughly one translation in five to ten.**

**Pace, measured directly.** The sample needs no catalogue to date a translation. Works whose first English translation appeared 1980–2025, weighted to the population and divided by 46 years:

| first English translations a year, Renaissance-composed Latin (print 1400–1700, extrapolated) | paper | strict | sonnet |
|---|---|---|---|
| in clusters | 97 [38–168] | 83 [31–148] | 44 [9–90] |
| in works (§5.10: a work over k clusters counts once) | 52 [19–94] | 39 [14–71] | 23 [2–53] |
| years to translate the rest, in works | 4,568 [2,508–12,288] | 6,118 [3,307–17,781] | 10,127 [4,436–100,512] |
| years to translate the rest, in clusters | 3,056 [1,755–7,811] | 3,680 [2,029–9,980] | 6,886 [3,338–35,694] |

So the "about 40 a year" survives, but as a measured few dozen *works* a year (23–52 across readings), not as a catalogue count. The "seven thousand years" does not survive as a floor. The central estimates run 3,000–10,000 years and the 95% lower ends are 1,800–4,400. **"Thousands of years" is safe; any single figure above about 2,000 is not.**

**The sample is thin here.** The recent-translation estimate rests on 18 works (11 matched, 7 missed; 12 under sonnet). The missed ones carry eight times the weight of the matched ones, and 6 of the 7 rest on Gemini alone. One (G637) cites a German monograph, not an English translation. A supplementary sample sized to put about 50 recent first translations in the gap stratum would need roughly 3,900 more gap-stratum works adjudicated (the recent-translation rate there is 7/553, 1.3%), plus a second instrument on every prior found. On the subscription CLIs at the #7691 rate (26 s a work, 4 at a time) that is about 7 hours of one account's allowance and $0 marginal spend. We did not run it. The donor-safe wording does not depend on it, and a one-instrument run would inherit Sonnet's known bias on exactly this quantity. Run it if a single years-to-finish figure is ever wanted.

### 5.10 Is the denominator our clustering? Two checks

`work_cluster_id` is our own grouping (surname + first six title words, `scripts/catalog-coverage/build.mjs`), so we tested it on the 1,000 sampled clusters (`gap-validation-cluster-audit.mjs`).

**(a) Over-merge and split.** For each sampled cluster a judge saw its member editions' titles and up to 30 other clusters under the same author key: those sharing rare title words, plus those the phase-11 work graph already joins. It answered how many works the cluster holds and which others are the same work. The judge was `gemini-3.1-flash-lite` on all 1,000 (about $0.16 on the paid API, through `gemini-script-client.mjs`). Claude Sonnet judged the first 131 before the box's Claude account hit its weekly pace guard. On those 131 the two agree on split versus no split for 124 (95%), and their same-work sets overlap with Jaccard 0.70. Flash-lite flags over-merge more readily (13 against Sonnet's 2).

- **Over-merge is rare:** 1.9% [1.0–3.0] of clusters hold more than one work (flash-lite; about 1.5% by Sonnet on the overlap).
- **Splitting is common:** 43.6% [39.8–47.4] of clusters share their work with at least one other cluster. That is a floor, since splits across author-name forms (Cicerón / Cicero) were not searched and a famous work can have more same-work clusters than the 30 shown.
- **Splits track translation.** A translated cluster's work spans 5.8 [4.8–7.0] clusters on average, an untranslated cluster's 2.1 [1.9–2.4]. Famous works are reprinted under more title wordings, and famous works are the translated ones.

Counting each cluster as m/k works (m works inside it, its work spread over k clusters):

| print 1400–1700, extrapolated | clusters | **works (corrected)** |
|---|---|---|
| denominator | 366,205 | **266,593 [256,193–277,699]** (259,833 with no over-merge) |
| translated, all print (paper) | 51,859 (14.2%) | **20,176 [15,636–25,374] (7.6% [5.8–9.6])** |
| translated, Renaissance-composed (paper) | 20,241 (6.4%) | **9,348 [6,197–12,941] (3.8% [2.5–5.3])** |
| same, strict / sonnet | 13,789 / 9,218 | 6,988 [4,108–10,254] (2.8%) / 5,725 [3,046–8,880] (2.4%) |

Because k is a floor, these work counts are upper bounds. The phase-11 work graph (306,253 works with a USTC edition, #7751) groups more loosely and lands above them.

**(b) Edition level.** Weighting each sampled cluster by its edition count gives the share of USTC Latin *editions* whose work has an English translation, which does not depend on how editions were grouped. The model's implied edition total (232,884 [219,220–247,734] in the window) matches the 238,696 counted, a check on the weighting. Window, paper reading: **17.8% [14.8–21.2]** of editions are of a translated work, and **10.1% [7.2–13.2]** of Renaissance-composed editions (13.8% / 6.7% strict; 13.6% / 5.3% sonnet).

**Do the units agree?** No, and they should not. Translated works are reprinted more and split more, so the translated share climbs from works (Renaissance 4.0% [2.7–5.4], window) to clusters (6.7% [4.9–8.8]) to editions (10.1% [7.2–13.2]). Each answers a different question: of the *texts* composed in the Renaissance, about one in twenty-five has an English translation; of the *printed editions* of those texts, about one in ten is of a translated work. The headline "fewer than one in ten Renaissance-composed works" holds in every unit that counts works, under every reading.

## 6. The released dataset

The reusable asset is the **work-graph and its validation**, not the percentage:
- the 366,205-cluster Latin work denominator with the external-prior layer (`cluster-external-priors.jsonl`);
- the assembled external-translation works with provenance channels;
- the **n=1000 validation set**: blind frame + answer key, the Gemini verdicts (all 1000) and Claude verdicts (the 419-work overlap) with queries and source URLs, the tie-break, the scorer/estimator, and the human-gold export — all under `scripts/analysis/eval-data/`, reproducible from the seed.
- **the matcher's misses and false matches (#7778):** the 78 works the validation found translated and the matcher missed, each with its verdicts, cited prior and a live link check (`gap-validation-catalog-rows.json`). The 42 that pass the staging gate (two instruments agree, and a cited link loads and names the work) are staged in the #7769 shape as `gap-validation-staged.jsonl` (source `gap_validation`; copy for `01-build-external-works.mjs --staging` at `scripts/output/translation-staging/gap_validation.jsonl`). They are **not** in `translation_catalogs`, which feeds the public badges and /census, and merging them is a separate decision. The 36 held are held for evidence, not judged untranslated. Gemini's Google Books links were often invented: the id cited for Bolton's 1618 Florus resolves to Merivale's *Lectures on Colonization*. The same file flags the 46 matcher false positives at cluster level;
- **the clustering audit** (`gap-validation-cluster-audit-flash-lite.jsonl`, all 1,000; `gap-validation-cluster-audit.jsonl`, Sonnet on 131) and the first-translation years (`gap-validation-translation-years.json`).
This is a *J. Open Humanities Data*-shaped contribution: a corpus-gap measurement instrument other libraries and traditions (Greek, Chinese, Sanskrit) can re-run.

## 7. Human gold standard — the binding validation (in progress)

The §5 estimate is **dual-AI**. Two independent model families bound each other's *independent* error (κ=0.88), but not their *correlated* blind spots — an offline or un-indexed translation both miss. The de-circularising layer is a human gold standard. Following the FT audit's review/audit design, we export a **stratified ~40-work subset** (`gap-validation-gold-export.mjs`) — oversampling the consequential cells (disagreements, containers, Renaissance gap, Renaissance "translated") — into a self-contained review page that shows each AI verdict, the prior it surfaced with a click-through to the cited record, and its sources, and asks the reviewer to **Agree / Override / Can't-tell** after opening a record. The scorer (`gap-validation-gold-score.mjs`) then measures each instrument's **sensitivity/specificity** and feeds the **Rogan–Gladen** correction, debiasing the population rate for adjudicator fallibility and propagating the extra uncertainty. Until those labels are in hand, the headline rests on the two AI adjudicators, which is the principal limitation.

## 8. Limitations

- **No human gold standard yet (§7)** — the dominant limitation; AI-vs-AI agreement bounds independent, not correlated, error, and the Rogan–Gladen correction is scaffolded but not yet applied.
- **Coverage of "translated" is broad but not exhaustive** — UNESCO/LoC/OpenLibrary/HathiTrust + major series capture the canon; an obscure dissertation or single journal-article rendering can still harbour a prior, which would *shrink* the gap slightly. The grounded adjudicators partly compensate (they find priors the matcher missed — that is exactly the §5.3 ancient/medieval signal) but cannot surface a fully offline prior.
- **Composition-era is itself AI-assigned**; the two instruments agree on it strongly, but a handful of edge cases (a humanist edition heavily reworking an ancient text) are genuinely ambiguous and were not adjudicated by a classicist.
- **Window and language are single** — Latin 1480–1620; the 1400–1700 tails and other traditions are not yet validated at this n.
- **Counts outside 1480–1620 are extrapolated** (§5.7); the clustering correction uses a floor on splits (§5.10), so work counts are upper bounds; the recent-pace estimate rests on 18 works (§5.9).
- **The scorer counts `partial` priors as translated** against the rule in §4 (§5.6); the strict reading corrects it, and the headline has not been re-issued on it.
- **Residual matcher false positives** at the low-IDF boundary (§5.2) make the *translated* count a slight over-estimate and hence the gap a conservative floor on the all-print denominator.

## 9. Conclusion

The widely-quoted "~97% of early-modern Latin is untranslated" is best understood as an *apparent* rate from a fallible matcher over a *print*-year denominator. Validated and debiased, it splits cleanly: ~85% [82–87] for all printed Latin (the raw figure overstates this, because translated classics hide in the "gap"), and **~93% [91–95] for genuinely Renaissance-composed Latin** (§5.6–5.9 test this against a third instrument, a stricter reading of the completeness rule, and our own clustering; the work-level figure is higher still, ~96%) (the meaningful number, essentially total, corroborating Shuger). The lesson for digital libraries and for translation-flow scholarship is methodological: a corpus-gap figure should be reported as a **validated interval with an explicit denominator and per-claim search provenance**, produced by an auditable pipeline, not as a single percentage. We release the pipeline, the work-graph, and the validation set as a recipe other corpora can run.

## 10. Quotable figures (for donor and public copy)

Each figure below is safe under all three readings of §5.6 and at their 95% intervals, unless marked. "Renaissance" means Latin works *composed* 1400–1700 and printed by 1700 (USTC). Counts outside print years 1480–1620 are extrapolated (§5.7). Dated 2026-10-30, n=1,000, AI-adjudicated (no human gold standard yet, §7).

| # | Figure | Wording to use | Interval behind it | Source |
|---|---|---|---|---|
| 1 | Untranslated share | "More than nine in ten Latin works written in the Renaissance have never been translated into English." | untranslated, by work: 96.2% [94.7–97.5] (paper), 97.6% [96.4–98.7] (sonnet); by cluster: 93.6% [91.6–95.5] | §5.4, §5.10 |
| 2 | How many are translated (replaces "~2,000 Renaissance works ever translated") | "Of the roughly 250,000 Latin works written in the Renaissance and printed before 1700, only a few thousand have ever been translated into English." | translated works 9,348 [6,197–12,941] (paper), 6,988 [4,108–10,254] (strict), 5,725 [3,046–8,880] (sonnet); denominator 246,043 [234,363–258,042] works, an upper bound. "~2,000" is below every interval | §5.10 |
| 3 | Catalogues miss most translations | "Most English translations of Renaissance Latin are missing from the standard catalogues, which list perhaps one in four to one in ten of them." | matcher capture 10.6% [7.3–15.7] to 24.8% [16.0–39.4] across readings and denominators; every upper bound is below 50% | §5.9 |
| 4 | Source Library against everyone before (replaces "two-thirds as much as every earlier translator") | "Source Library has made about 6,400 early-modern Latin works readable in English: already more than a tenth as many as all earlier English translators combined, counting every earlier translation we can find, not only catalogued ones." | 12.4% [10.4–14.9] in clusters (paper, the reading most generous to earlier translators) up to 36.6% [28.1–50.7] in works (sonnet). Two-thirds is outside every interval | §5.8 (c) |
| 5 | First translations among them (optional) | "About 4,000 of them had no earlier English translation that we could find." | 4,500–5,300 clusters after the uncatalogued-prior correction; about 4,300–5,000 after #7751's SL-side match correction; lower in work units. "About 4,000" sits at or below all of these | §5.8 (d), #7751 |
| 6 | Pace (replaces "about 40 a year … more than 7,000 years") | "In recent decades, scholars have published first English translations of a few dozen Renaissance Latin works a year. At that pace, translating the rest would take thousands of years." | 23–52 works a year (1980–2025; 95% from 2 to 94); years to finish, central 3,056–10,127, 95% lower ends 1,755–4,436. 7,000 lies inside several intervals, but every lower end is below it, so it cannot be quoted as a minimum | §5.9 |

**Retired:** "two-thirds as much as every earlier translator" (it compares us with the 9,830 catalogued clusters, not with the translations that exist), "about 40 a year … more than 7,000 years" (a catalogue tally, plus a single figure the intervals do not support as a floor), "about 2,000 Renaissance works ever translated" (below every interval), and the bare "97% untranslated" (an apparent rate, §5.4).

**Wording rules.** Say "written in the Renaissance" or "composed", never "printed", for figures 1–2. The print corpus includes reprinted classics, and for those the translated share is far higher (§5.3). Give a range or "a few thousand", never a bare percentage. If a sentence needs a single years-to-finish figure, run the §5.9 supplementary sample first.

## Target venues
- **Journal of Open Humanities Data (JOHD)** — the work-graph + validation set as a data paper (strongest fit).
- **Computational Humanities Research (CHR)** / **LaTeCH-CLfL** — the dual-model grounded-adjudication + era-post-stratification method.
- **Translation and Literature** / a Heilbron–Sapiro translation-sociology venue — the empirical result (the Latin English-translation gap, measured).
- *Not* a top-tier ML venue: the contribution is the integrated method, the dataset, and the validated humanities result, not ML novelty.

### Notes
- Citations are placeholders; fill before submission. Load-bearing: Rogan & Gladen (1978, *Am. J. Epidemiology*); Shuger (the "~90%" estimate); the *Index Translationum*; USTC work-clustering; Heilbron/Sapiro.
- Authorship/credit: Source Library / EFM + collaborators — decide before drafting submission prose.
- Research draft in a public AGPL repo (untracked unless deliberately added); companion to `translation-gap-methodology.md`.
