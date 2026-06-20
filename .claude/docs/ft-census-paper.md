# How Many First Translations? A Sampling-Based Census of Novel-Translation Claims in a Large Digital Library

*Working paper — Source Library, June 2026. Methodology and code: github issue #2564.*

## Abstract

Digital libraries increasingly assert that a given text is a *first English translation* — a claim about the **absence** of any prior translation. Such claims are hard to verify at scale and fail in two opposite directions: false positives (a badge where a prior translation exists) and false negatives (a genuine first that was never claimed). We present a two-sided, sampling-based census of ~14,000 translation-eligible books in Source Library. Using stratified random sampling and per-book adjudication by a tool-using language-model agent (which searches tradition-appropriate bibliographic sources and applies an explicit verdict taxonomy), we estimate both the **precision** of existing first-translation badges and the **recall** gap among never-assessed books. We find that of 5,696 badged "first translations," roughly 66% (≈3,774; 95% CI [3,259–4,289]) are genuine, with most of the remainder being multi-work containers and category errors rather than works with an existing translation. Separately, ~23% of the 8,306 never-assessed eligible books are themselves genuine firsts (≈1,883; [1,387–2,492]). The two errors nearly cancel: the corpus contains an estimated **5,657 ± 755** genuine first English translations (~40% of eligible books), close to the badge count but composed of materially different books. The dominant error is **missed firsts**, not over-claiming. Error tracks a work's *fame/catalogue-density*, not its language. We discuss the "evidence of absence" problem, an instructive prompt-specification bug caught by internal inconsistency, and the implications for how libraries should state novelty claims.

## 1. Introduction

A "first English translation" is among the strongest claims a library can attach to a book, and one of the most useful to readers and scholars: it marks a text entering the Anglophone record for the first time. But it is a claim about a **negative** — that no prior English translation exists anywhere — and negatives cannot be confirmed by lookup. The claim degrades in two opposite ways:

- **False first (precision error):** the badge is shown, but a prior translation exists. These concentrate around *famous* works in *under-catalogued* traditions, where Western bibliographic databases are blind but a scholarly translation nonetheless exists.
- **Missed first (recall error):** a genuine first translation carries no badge, because the book was never assessed at all.

Counting only badged books measures precision and is structurally blind to recall. An honest census must sample **both** the books a system claims and the books it never examined. This paper does so for Source Library, a digital library of ~31,000 publicly visible historical primary sources with AI-assisted OCR and translation.

## 2. Population and denominators

All counts are live as of 19 June 2026 against the production catalogue.

| Population | Count |
|---|---|
| Publicly visible books | 30,868 |
| Translated to English (`pages_translated > 0`) | 15,707 |
| — English-language originals (not eligible) | 1,737 |
| **First-translation-eligible (translated, non-English)** | **13,970** |
| Currently badged as first translations | 5,696 |
| **Eligible but never assessed** | **8,306** |

The eligible population is the natural denominator: a first *English* translation presupposes a non-English source text that we have rendered into English. The 5,696 badged books and the 8,306 never-assessed books partition the eligible pool (modulo a small number assessed-and-rejected).

## 3. Method

### 3.1 Verdict taxonomy

Each book is adjudicated to one of eight mutually exclusive verdicts, replacing a prior boolean flag:

- `first_no_prior` — no English translation of this text in any form.
- `first_from_source` — English of the work exists from a *different* source language, but not from this text.
- `first_complete` — only partial/excerpt English exists; ours is the first complete one (gated on our item being complete).
- `first_modern` — only antiquated (pre-~1900) English exists.
- `not_first` — a complete modern English translation of this text exists.
- `not_applicable` — not a single translatable text: visual art, scripture-manuscript copy, a non-English edition, or a multi-work container/anthology where the claim is ill-defined.
- `unverifiable` — competent tradition sources are catalogue-blind and the search cannot be bounded.
- `needs_review` — conflicting or inconclusive evidence; unresolved work identity.

The first four constitute the **first-family** (a genuine first claim). Orthogonal qualifiers are recorded per verdict: an evidence-strength grade (`strong`/`moderate`/`weak`), our-item completeness, the match key used (`work_id`/`author_title`/`transliteration`), and the prior-relationship when a candidate is found (`same_text`, `same_work_diff_edition`, `different_source_language`, `related_distinct_work`, `partial`, `adaptation`). The relationship qualifier encodes the **source-language rule** (a translation of the same work from another original language still defeats "first") and the **related-work rule** (a translation of a parent/sibling/derivative work does not).

### 3.2 Per-book adjudication

For each sampled book, a tool-using language-model agent runs a focused investigation: it identifies the work precisely and separates it from look-alike relatives and other editions; searches **tradition-appropriate** sources rather than Western catalogues alone (84000 and BDRC for Tibetan; CTEXT/CBETA for Chinese; GRETIL/SuttaCentral for Indic; Sefaria for Hebrew; Google Books, the Internet Archive, HathiTrust, OpenAlex, EEBO and scholarship for European works); applies the source-language and completeness rules; and returns a structured verdict plus a full evidence trail (sources checked, the prior found if any, and a free-text rationale). Each adjudication is recorded as an append-only provenance entry — the "evidence of absence" record.

### 3.3 Sampling and estimation

We draw random samples and scale up. For the badged set we stratify by catalogue density, language family, and prior disposition; for the never-assessed pool we use simple random sampling. Each stratum's first (or false-first) rate is computed with a **Wilson 95% confidence interval**; stratum estimates are scaled to population size and summed, with a finite-population correction on the variance. The reported corpus figure is `N ± M`, not a point claim.

## 4. Results

### 4.1 Precision: are badged firsts real? (n = 462 of 5,696)

| Verdict class | Share | Interpretation |
|---|---|---|
| first-family | 46% | genuine first claims |
| not_first | 18% | a real prior exists → demote |
| not_applicable | 30% | ill-defined claim (mostly multi-work containers; also non-English editions, scripture fragments, visual art) |
| needs_review / unverifiable | 6% | unresolved |

Scaled: **≈3,774 genuine firsts among badged books (95% CI [3,259–4,289])**. Notably, the largest error category is not "a translation exists" (18%) but "the claim is ill-posed" (30%) — dominated by ~16% of the sample being multi-work containers (e.g. an *Opera Omnia*, a *Patrologia* volume, a Tibetan "miscellaneous writings" bundle) for which a single first-translation badge has no clean meaning.

### 4.2 Recall: how many firsts are unclaimed? (n = 150 of 8,306)

The never-assessed pool was sampled at increasing depth (n = 40 → 73 → 150); the genuine-first rate converged at **22.7%** (Wilson 95% [17–30%]). Scaled: **≈1,883 unclaimed genuine firsts ([1,387–2,492])**. Of the sampled never-assessed books, 61% did have a prior translation (correctly unbadged), 23% were genuine firsts never flagged, and 16% were not-applicable.

### 4.3 Corpus estimate

Combining the two independent estimates:

> **≈ 5,657 ± 755 genuine first English translations (95% CI [4,901–6,412]).**
> ≈ **40%** of the 13,970 eligible books; ≈36% of all translated books; ≈18% of the visible library.

### 4.4 The errors nearly cancel

The badged set over-claims by ≈1,900 books; the never-assessed pool under-claims by a near-identical ≈1,880. The true total therefore lands close to the current badge count of 5,696 — but the membership differs substantially. The system is not predominantly over-claiming; it is **mis-aimed in both directions at once**, and the corrective action is re-balancing (demote ≈1,900, badge ≈1,900), not shrinking the headline.

### 4.5 Fame, not language

A natural hypothesis is that non-Western claims (which Western catalogues cannot see) are systematically unreliable. The data contradict this: obscure Tibetan terma and obscure Latin pamphlets are *both* usually genuine firsts. The false firsts are the **famous** works in any tradition — important enough that a scholar already translated them. Worked spot-check examples: Kircher's *Arithmologia* (1665) and Fludd's treatises are famous and genuinely untranslated (badges retained — Kircher's was restored after an automated pass wrongly removed it); Tsongkhapa's *Essence of True Eloquence* is famous and was translated by Thurman in 1984 (badge removed). The discriminating axis is catalogue density, not language.

## 5. Instrument validation

We validated the adjudicator two ways, and additionally compared two *independent* model instruments (a Claude tool-using agent and a Gemini grounded-search call) running the identical prompt and taxonomy.

**Ground truth (n = 33).** Against a human-vetted set whose labels were independently checked against five external catalogues, the Gemini instrument agreed with the catalogue-cron labels on 77% of binary-comparable cases. Every disagreement, on inspection, favored the adjudicator: it caught prior English translations of Euclid, Dürer's fortification treatise, and Gaffarel's *Curiositez* that the deterministic cron had wrongly badged as "first." The ground-truth set is two noisy automated signals rather than a gold human label, so this understates accuracy; it confirms the adjudicator corrects the catalogue baselines on exactly the famous-work failure mode.

**Inter-instrument reliability (n = 150).** The same 150 never-assessed books were adjudicated independently by the Claude agent (hand-spot-checked) and the Gemini grounded call. Exact-verdict agreement was 71% and collapsed three-class agreement 75% (Cohen's κ = 0.57, "moderate"). Decomposing the disagreements is the key result: **on the evidence question — does any prior English translation exist — the two instruments agreed 90%** (107/119 comparable pairs), and the strict `first_no_prior` count was near-identical (Gemini 32, Claude 31). The Gemini instrument found a prior the Claude run had missed in 7 cases, versus the reverse in 5. The residual disagreement is therefore **taxonomy-grading variance**, not search failure: when both instruments find a prior, they sometimes grade it differently (`not_first` vs `first_from_source` for a same-work different-source-language prior; `first_modern` when the only English is pre-1900; `first_complete` when the prior is partial). These graded distinctions are genuinely ambiguous at the margin and are a prompt-specification question, not an evidence question.

**Implication.** The estimate of how many books have *no prior translation in any form* is reproducible across independent models (32 vs 31 of 150); the breakdown *within* the first-family is instrument-sensitive and should be pinned by sharpening the taxonomy rules (notably the source-language rule) before it is reported at the work level. The cheaper Gemini instrument (~$0.01/book vs a subscription-metered agent) is therefore the appropriate engine for full-corpus enumeration.

## 6. A methodological hazard, disclosed

The first full run mis-classified ~42% of one category. The cause was a specification error in **our** adjudication prompt: it instructed the agent to mark any book whose text was in the original language as `not_applicable` — but holding the source-language original *and* translating it is precisely the library's model, so those are valid first-translation candidates, not category errors. The error surfaced through the sample's own internal inconsistency (one Latin oration was correctly called a first; a near-identical one was wrongly disqualified). We corrected the instruction and re-ran the affected subset. We report this because an auditable method must catch its own mistakes, including the auditor's, and because "evidence of absence" pipelines are unusually sensitive to definitional framing.

## 7. Discussion

**Evidence of absence must be graded, not binary.** A claim of "no prior translation" is only as strong as the best documented search behind it. An absence confirmed in competent tradition sources (e.g. 84000 for a Tibetan text) is `strong`; an absence inferred from a blind Western-catalogue miss is `weak` and is excluded from the headline count. Recording the search — sources, match key, rationale — turns a marketing claim into a falsifiable, sourced assertion.

**Containers break the one-book-one-claim assumption.** ~16% of badged firsts are multi-work volumes. A first-translation claim is well-posed only at the level of a single work; container claims should be resolved at constituent level, which requires a work-identity layer (only ~12% of eligible books currently carry a `work_id`).

**Single-writer derivation prevents drift.** The badge is now a derived read of the graded verdict, written by one reconciliation job, eliminating the historical disagreement between the boolean flag and the disposition field that independent scripts had produced.

## 8. Limitations

- The recall sample (n = 150) yields a ±~14% relative interval on the recall rate; the badged-precision sample (n = 462) is tighter. The combined ±755 is dominated by recall uncertainty.
- "No prior translation found" remains bounded by what online and tradition-appropriate sources index; un-catalogued dissertations, single journal-article renderings, and offline scholarship can still harbor a prior. Verdicts grade this explicitly but cannot eliminate it.
- Instrument-reliability and ground-truth-agreement figures (§5) are not yet in hand.
- Simple random sampling of the never-assessed pool is unbiased but not minimum-variance; post-stratification could tighten the recall interval.

## 9. Conclusion

A widely-quoted "~6,000 first translations" turns out to be roughly defensible as a *count*, but its *composition* is wrong: a third of the badged books are over-claims (mostly ill-posed container claims) and a comparable number of genuine firsts sit unbadged in the never-assessed tail. The fix is not to shrink the claim but to re-balance it, and — more importantly — to attach to each badge the graded evidence of absence that makes it checkable. The broader lesson for digital libraries: novelty claims at scale should be reported as sampled estimates with confidence intervals and per-item provenance, not as exact counts derived from an unaudited flag.

---

### Appendix A. Figures and provenance

- Denominators: production catalogue, 19 June 2026.
- Precision sample: 462 books, stratified (catalogue-density × language-family × disposition).
- Recall sample: 150 books, simple random from the 8,306 never-assessed eligible pool; rate converged across n = 40/73/150.
- All sampling intervals are 95% Wilson; corpus interval uses stratified variance with finite-population correction.
- Per-book verdicts, evidence trails, and the analysis code are in the project repository (issue #2564, PR #2573); each adjudication is an append-only provenance record.
