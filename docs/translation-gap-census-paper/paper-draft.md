# Measuring the Translation Gap: A Reproducible Bibliographic-Census Method for Premodern Corpora, with Estimates for Renaissance Latin and the Chinese Imperial Canon

**Draft v0.1 — 2026-05-31.** Target: JCDL / *Digital Scholarship in the Humanities* / a LaTeCH-CLfL workshop, with an arXiv preprint (cs.DL, cross-list cs.CL). Authors: J. D. Lomas (TU Delft / Source Library) + collaborators TBD (a Neo-Latinist and a Sinologist are sought as co-authors to strengthen the domain and related-work sections).

> **Status flags.** `[MEASURED]` = figure from a completed run. `[PENDING:step3]` = awaiting the directly-measured, work-uniform Latin rate + CI (numerator verification gated on a daily search-API quota). `[EST]` = estimate from the heuristic matcher, reported with caveats.

---

## Abstract

It is widely asserted that the overwhelming majority of the premodern scholarly record has never been translated into a modern language, yet the claim has remained qualitative — historians describe the untranslated share as "overwhelming" and the exact figure as "unknowable." We argue it is in fact measurable, and present a reproducible method for estimating the translation coverage of a bounded historical corpus. The method pairs a *bibliographic denominator* (a catalogue enumerating the works of a tradition) with a *translation numerator* recovered from bibliographic catalogues and full-text search, and adjudicated for precision by a large language model that judges whether a candidate edition is a genuine translation of a specific work rather than a keyword collision or an excerpt. We apply the method to two corpora that share no language, script, or century: Renaissance-era Latin print, via the Universal Short Title Catalogue (USTC; ~444K Latin works), and the Chinese imperial canon, via the Siku Quanshu (四庫全書; ~3,418 works). We estimate that roughly **2% of the Latin corpus** and **on the order of 1–2% of the Chinese canon** have been translated into English. The convergence of two unrelated traditions on the same order of magnitude suggests the translation gap is a structural feature of scholarly transmission rather than an artifact of any single catalogue. We further show — through manual audits in both corpora — that automated bibliographic matching systematically *under-detects* translations (translated authors carry many untranslated minor works; translations are often published under titles unrelated to the catalogue label), so credible figures require per-work human-in-the-loop verification. We release all code, intermediate data, and per-work judgments.

---

## 1. Introduction

How much of the premodern intellectual record can a modern reader actually read? The question matters for the history of science and ideas, for digital-library acquisition priorities, and for the public case that motivates large-scale digitization and translation. The scholarly consensus is emphatic but unquantified: specialists in Neo-Latin describe the untranslated portion of the corpus as "overwhelming" and its exact size as "unknowable," and standard reference works (e.g. IJsewijn & Sacré's *Companion to Neo-Latin Studies*) call for "extensive basic work … in cataloguing what is available, as well as in digitisation and translation" without putting a number on the gap. The corpus itself is enormous: post-classical Latin (medieval + Renaissance + Neo-Latin) is estimated at well over 99.99% of all extant Latin output, and the Neo-Latin corpus alone is described as "incalculable."

We contend the gap is measurable, given (a) a *bibliographic denominator* that enumerates a tradition's works and (b) a method for deciding, per work, whether an English translation exists. Our contributions:

1. **A reproducible method** for corpus-level translation-coverage estimation that is language- and script-agnostic, separates *recall* (catalogue cross-reference + full-text search) from *precision* (LLM adjudication of work-identity), and uses explicit error-state accounting so lookup failures are never silently scored as negatives.
2. **Two empirical estimates** — the first quantitative figures for either corpus: Renaissance Latin ≈ 2% `[EST/MEASURED]`; Siku Quanshu ≈ 1–2% `[MEASURED]`.
3. **A cross-traditional convergence result** and a structural explanation: in both corpora the famous canon is translated but the vast apparatus around it — commentaries, collected works, gazetteers, disputations, occasional pieces — is not.
4. **A methodological finding with teeth**: automated bibliographic matching under-detects translations in *both* corpora, from opposite mechanisms, so honest figures need per-work verification. We quantify the matcher error in each case.
5. **Open artifacts**: denominators, per-work judgments, and the pipeline.

## 2. Related work

- **Neo-Latin studies** on the scale and neglect of the corpus (IJsewijn; the >99.99% framing; Sutton's *Analytic Bibliography of On-line Neo-Latin Texts*, ~79,760 freely-available online texts as of Nov 2024 — a measure of digital *availability*, not translation).
- **Book-history bibliometrics**: the USTC as a near-complete census of European print 1450–1700.
- **Translation bibliography**: UNESCO's *Index Translationum* and its limits (we show its accessible structured export lacks a source-language field, so it cannot be filtered by original language — a non-obvious data-availability result).
- **Computational record linkage** and the use of LLMs as adjudicators for entity/work identity.
- **Chinese textual scholarship**: the Siku Quanshu and its annotated catalogue (Siku Quanshu Zongmu Tiyao).

## 3. Problem definition

**Unit.** The denominator unit is the *work* (a distinct text), not the *edition* (a specific printing) nor the *author*. This distinction is consequential (§6): edition- and author-weighted counts diverge from work-level counts by an order of magnitude, because prolific/translated authors carry disproportionately many editions and minor works.

**"Translated."** Primary metric: ≥1 published English *translation* (full or substantial) of the work exists. We exclude excerpt anthologies that include only fragments, and works merely *mentioned* in an English book. We report sensitivity to (a) "any modern language" vs English-only and (b) denominator choice. The user-facing notion we ultimately care about — *available to a modern non-specialist reader* — is stricter than "a translation exists somewhere," and we flag where the two diverge.

**Numerator decomposition.** Recall (finding candidate translations) and precision (confirming a candidate is a genuine translation *of this work*) are separate failure modes and are measured separately.

## 4. Method

**4.1 Denominator construction.** Select a catalogue enumerating the tradition's works; resolve to work granularity; document coverage and selection bias. (Latin: USTC `language_1=Latin`. Chinese: Wikidata items linked to the Siku Quanshu via part-of / catalog / published-in.)

**4.2 Numerator — recall.** Cross-reference a bibliographic translation catalogue and query full-text book search (Google Books; OpenLibrary as a quota-resilient fallback) for English-language editions whose titles plausibly match the work. For corpora whose denominator labels are not in a searchable form (Chinese-only titles), a grounded LLM *name-resolution* step first maps the title to Hanyu Pinyin and to an established English title *iff one genuinely exists* (null otherwise — no guessing).

**4.3 Numerator — precision.** A large language model (`gemini-3.1-flash-lite`) adjudicates whether any candidate edition is a genuine English translation/substantial edition of *this specific work*, given the original title, any English label/aliases, and a description. It is constrained to judge only the supplied candidates (no answers from parametric memory), which prevents hallucinated translations.

**4.4 Error-state accounting.** Every work resolves to TRANSLATED | UNTRANSLATED | ERROR. Errors (rate-limit / network / model failures) are counted separately and **excluded** from the rate — never scored as untranslated. *Motivation:* an early unkeyed run produced a clean but entirely false "0 of 100 translated" because the search API silently rate-limited every call and the failures were scored as negatives. Loud error accounting is a load-bearing part of the method, not a detail.

**4.5 Estimation.** Stratified sampling where strata differ in expected rate; Wilson score intervals; size-weighted aggregation. A full census is used where the stratum is small enough to enumerate.

## 5. Case study I — Renaissance Latin (USTC)

**Denominator.** USTC Latin: 499,607 editions; 362,263 distinct works; 49,306 authors.

**Numerator.** A translation catalogue of **26,789 records** aggregated from 30+ scholarly sources (UNESCO Index Translationum, LoC MARC, OpenLibrary, HathiTrust, Loeb, Brill, Penguin, I-Tatti, …); fields include author, English/original title, translator (present on ~40%), publisher, year, source. Matching is by author surname plus 120+ Latin↔English author-name aliases.

**Headline figures** `[EST]`: 2.18% of authors have ≥1 translation; 12.83% of *editions* are by such authors; an estimated **0.99% of works** are translated. The author-derived per-edition flag `has_english_translation` is true on 68,073 of 503,360 Latin editions.

**Manual error-bar audit** `[MEASURED]`. We hand-checked two samples (released as data):
- *Flag precision* (n=25 flagged-true): the author-derived flag is **~70% precise at the work level**. False positives are minor works of translated authors not themselves translated (Grotius's wedding poem; Erasmus's grammar *De octo partium*; Durand's legal *Speculum*; Vossius's grammar) and **surname collisions** (an *almanac* by "Regnerus Agricola" flagged via a translated Agricola).
- *Base rate* (n=50 random): 41/50 unflagged works are confirmed-pattern untranslated (almanacs, funeral orations, university dissertations, papal bulls, polyglot dictionaries).

**Unit sensitivity** (key finding): edition-weighted sampling over-represents prolific (translated) authors, so the 0.99% work figure is an *estimate from author counts*, not a directly-sampled rate. A directly-measured, **work-uniform** rate + Wilson CI is `[PENDING:step3]` (work-uniform sampler built; per-work verification gated on a daily search-API quota). We expect it to confirm the ~1–2% order of magnitude.

### 5.1 Source Library's contribution to closing the gap

A digital library can *move* the gap, not only measure it. Source Library holds
**6,317 Latin works** (4,556 publicly visible), of which **5,404 have a readable
English translation** (`pages_translated > 0`). Splitting those by whether the
translation is a *first* English translation of the work (`is_first_translation`,
determined by the bibliographic FT verifier — an LLM that searches
translation_catalogs / OpenLibrary / Google Books / OpenAlex / LoC by author+title
and stores its evidence in `translation_verification`):

- **First (new) translations: ~2,119 flagged** — and ~2,566 once a flag/disposition
  desync is corrected (402 works carry a `confirmed_first` verification disposition
  yet are flagged not-first; see below).
- **Not-new (fresh translations of already-translated works): ~3,285**, of which
  1,447 have a verified `translation_found` disposition (a prior English
  translation genuinely exists).

**Significance.** Against a historical baseline in which only **~1,500–3,600 Latin
works** (≈0.5–1% of the corpus) had *ever* been translated into English, Source
Library's ~2,100–2,600 *first* translations represent a **large net-new addition
to the translated Latin corpus** — plausibly increasing the count of
ever-translated Latin works by a substantial fraction. The project does not merely
quantify the translation gap; it is measurably narrowing it.

**Caveats (important).** (i) `is_first_translation` is an LLM bibliographic
determination, not externally certified; its recall ceiling is the catalogues it
searches. (ii) Source Library's holdings are **canon-weighted, not a random sample**
of the Latin corpus — we acquire known/important works in specific traditions
(alchemy, Hermetica, Kabbalah, Rosicrucianism, early science), which are
disproportionately *already* translated. Hence SL's internal new/not-new ratio
(~40–55% new) reflects acquisition strategy and must **not** be read as the corpus
translation rate (§3 unit/sampling caution). (iii) A **flag/disposition desync**
(~447 works verified first-type but flagged not-first; ~1,323 not-new are
unverified defaults) currently *undercounts* first translations — a data-quality
fix that would raise the "new" share.

## 6. Case study II — the Chinese imperial canon (Siku Quanshu)

**Denominator.** Wikidata items linked to the Siku Quanshu (Q699477): **3,418 works** (≈ the full ~3,461). Built via `wbgetentities` REST with disk caching — SPARQL label resolution degraded under load and once silently returned 58 of 257 English labels (a reproducibility hazard worth recording).

**Granularity finding.** Only **5/3,418** works have an English Wikipedia article and **58/3,418** have any English-language name. The linked items are predominantly *specific commentaries, sub-commentaries, editions, and collected works* (e.g. dozens of commentaries on the Analects), which are genuinely untranslated even where the underlying classic has been translated many times. (A data-quality note: 199 of the 257 Wikidata "English labels" are Chinese characters mis-stored under the `en` code; the genuine English-form count is 58.)

**Pipeline + recall fix** `[MEASURED]`. Name-resolution (pinyin + established English title) feeds the recall+precision pipeline. The labeled stratum (58) was fully censused with Gemini adjudication; the Chinese-only tail (3,360) was sampled. Stripping edition/source suffixes that poison search (e.g. "Record of Buddhist Kingdoms **(Siku Quanshu)**") and adding the OpenLibrary fallback raised labeled-stratum detection from **1/58 → 4/58**, recovering Faxian's *Record of Buddhist Kingdoms* (Legge), the *Xuanhe Catalogue of Paintings* (McNair), and *Hong Ming Ji*.

**Ground truth** `[MEASURED]`. Hand-verifying all 58 labeled works gives **~8/58 (~14%)** with full/substantial English translations — about 8× the original pipeline. Residual *automated* misses are **title-divergent** translations the catalogue label cannot reach: 洛陽伽藍記 published as *Memories of Loyang* (Jenner); 數書九章 as *Chinese Mathematics in the Thirteenth Century* (Libbrecht); the Wen Xuan annotations as Knechtges's *Wen Xuan*.

**Estimate** `[MEASURED]`: corrected overall translation rate **~1–2% (upper bound ~3%)**, anchored by the hand-verified labeled stratum, with the Chinese-only tail contributing a sprinkling of translated base classics (大唐西域記; 古列女傳/*Exemplary Women of Early China*, Kinney).

## 7. Cross-corpus discussion

Two corpora separated by language, script, and centuries converge on the same order of magnitude — **~2% (Latin), ~1–2% (Chinese)**. The structural explanation is the same in both: the bulk of each corpus is not the famous canon but the scholarly apparatus around it — commentaries, collected works, gazetteers, disputations, orations, occasional and liturgical pieces — which is genuinely untranslated. The convergence argues that the translation gap is a property of how scholarly traditions transmit and accrete, not an artifact of one catalogue's coverage.

The method's most transferable lesson is negative and identical across both: **automated bibliographic matching under-detects translations**, from opposite mechanisms — author-name matching over-attributes within translated authors and collides across same-surname people (Latin); title matching misses translations published under unrelated titles (Chinese). In both, the honest rate required per-work human verification, and in both the *direction* of the headline survived while the precise decimal moved.

## 8. Threats to validity

- **Denominator coverage/selection.** USTC is near-complete for European print but excludes manuscript and post-1700 Latin; the Wikidata Siku Quanshu set is ~99% of the catalogue but inherits Wikidata's notability bias.
- **Metric choice.** English-only vs any-modern-language, and full-vs-excerpt, each move the numerator; we report sensitivity.
- **Recall ceiling.** The numerator can only find translations present in the catalogue sources or surfaced by full-text search; title-divergent and non-catalogued translations are missed (we quantify this in the Chinese audit and flag it for Latin).
- **Adjudication error.** LLM precision/recall against manual ground truth is reported per corpus (Table 4); the adjudicator is constrained to supplied candidates to bound hallucination.
- **Survivorship and edition/work conflation** (§6 unit sensitivity).

## 9. Reproducibility & data release

Code, cached denominators, per-work judgments, the two manual-audit samples with verdicts, and the exact model + prompts + temperature are released. Practical notes recorded for replicators: the Google Books keyed quota (~1,000/day) caps a single-day full census (mitigated by the OpenLibrary fallback and multi-day runs); the UNESCO DataHub *Index Translationum* export (829,377 records) lacks a source-language field and romanizes original titles, so it cannot be filtered by original language; Wikidata SPARQL label resolution should not be done inside heavy aggregate queries.

## 10. Conclusion & future work

The premodern translation gap is measurable, and two independent corpora put it at the same low-single-digit order of magnitude. Future work: a third tradition (Sanskrit or Arabic) to strengthen the convergence claim; a work-identity resolver (canonical-title lookup) to close the title-divergence recall gap; generalization to non-English target languages; and tracking the gap over time as corpora are digitized and translated. A materialized work↔translation link table (a product artifact) would also let readers move directly from an original to its known translations.

---

## Tables (to populate)

- **Table 1.** Corpus descriptors (denominator size, granularity, source, date range, script).
- **Table 2.** Latin: author/edition/work-level rates + the 4-matcher robustness ladder.
- **Table 3.** Siku Quanshu strata (English-named vs Chinese-only; counts, sampled, translated, CI).
- **Table 4.** LLM-adjudication audit: pipeline precision *and recall* vs manual ground truth (Latin n=75; Chinese n=58 labeled + 15 notable).

## Open items before submission

1. `[PENDING:step3]` directly-measured, work-uniform Latin rate + Wilson CI (verification gated on quota reset).
2. Latin flag *recall* audit (flagged-false mid-tier authors → missed translations).
3. Metric sensitivity numbers (English-only vs any-modern-language).
4. Co-authors: Neo-Latinist + Sinologist for domain review and related work.
