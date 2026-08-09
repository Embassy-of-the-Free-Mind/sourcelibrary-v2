# How Many First Translations? A Census of Texts Entering English in an AI-Translated Library

## Abstract

Here is a question no institution on earth can answer: *has this book ever been translated into English?* There is no registry of translations. UNESCO's *Index Translationum* — the closest thing ever attempted — has been moribund for a decade, and absence from every catalogue that does exist is not evidence of absence: a prior translation may survive as a Victorian periodical chapter, a dissertation appendix, or a privately printed pamphlet no union catalogue indexes. While translation was slow and scarce, the unanswerable question was tolerable. It no longer is. An AI-assisted library can now translate thousands of historical texts a year, and in doing so performs *first translations* — texts entering the English record for the first time in their existence — at a rate with no historical precedent. Every one of those events is a claim about a universal negative that the pipeline asserting it cannot verify by reading the book. We present a framework for making such claims honest at scale, applied to Source Library, a digital library of ~31,000 historical primary sources whose pipeline badges ~5,700 works as first English translations. The framework treats a "first" as a measurable event rather than a marketing flag: **two-sided stratified sampling** over both the claimed pool and the never-assessed pool, so false firsts and missed firsts are measured symmetrically; **multi-model grounded adjudication** under an eight-verdict taxonomy that grades evidence of absence instead of asserting it; **prevalence correction** treating each AI adjudicator as an imperfect diagnostic test (Rogan–Gladen); a **human gold standard** that breaks the AI-vs-AI circularity; and publication of the full search-provenance ledger — 63,000+ documented attempts — as a citable dataset, so any claim can be re-checked without being re-done. The census finds the corpus holds ≈5,500 genuine first English translations (~40% of translation-eligible books) — but that the badge set is mis-aimed in both directions in near-equal measure: ≈1,900 over-claims (dominated not by missed priors but by *ill-posed* claims, chiefly multi-work volumes on which "first" has no clean meaning) against ≈1,770 genuine firsts sitting unbadged in the never-assessed pool. Error tracks a work's fame and catalogue density, not its language: the false firsts are the famous works, in every tradition. Where the sibling question "has this book been scanned?" is answerable by building a shared list, "has this been translated?" is not — absence from the list is where the question *starts*. The durable fix is architectural: a library should not assert that no prior translation exists; it should publish the search.

---

## 1. Introduction

A first translation is an event in the life of a text. For some fifteen hundred years the *Corpus Hermeticum* could be read only by those who read Greek or, after Ficino, Latin; from John Everard's English of 1650 it could be read by anyone with English. Such crossings are among the most consequential events in the transmission of knowledge — they mark the moment a text stops belonging to the philologists and enters a language's general bloodstream — and they were, historically, rare. A major text might wait centuries for its translator; a minor one might wait forever. The overwhelming majority of the written record has, in fact, waited forever: most of what survives in Latin, German, Chinese, Arabic, or Tibetan has never been translated into English at all.

That rarity is ending. AI-assisted translation has collapsed the cost of the crossing: a single modest digital library can now translate more historical texts in a year than a scholarly generation once managed, and in doing so it unavoidably performs first translations in bulk. Source Library — the deployed system studied in this paper, a digital library of ~31,000 publicly visible historical primary sources (early-modern science, alchemy, Hermetica, Kabbalah, and a substantial non-Western tail — Tibetan, Chinese, Sanskrit, Hebrew, Arabic) — asserts that ~5,700 of its books are first English translations. If even roughly right, that is a measurable expansion of the Anglophone historical record, executed in under two years. Whether it *is* roughly right is the subject of this paper — and answering that turns out to require building an instrument that, as far as we can tell, has never existed.

The obstacle is that "first translation" is a claim about a **negative** — that no prior English translation exists anywhere, in any form — and there is nowhere to look such a thing up. No registry of translations exists. UNESCO's *Index Translationum*, the closest thing ever attempted, has been moribund for a decade and was always thinnest exactly where translation history is hardest. This is one instance of a general infrastructural hole we have described elsewhere for the sibling question "has this book been *scanned*?" (Lomas 2026): the bibliographic questions that matter most for allocating scarce scholarly effort — has this been digitized, has this been translated — are answerable by no institution on earth, so effort is duplicated and genuine gaps go unseen. But the translation question is strictly harder than the scanning question. Scanning can be solved by a shared list, because a scan is a discoverable artifact held by an institution. A prior translation may survive only as a Victorian periodical chapter, a dissertation appendix, or a privately printed pamphlet no union catalogue indexes — so absence from every list is where the question *starts*, not where it ends. Negatives cannot be confirmed by lookup; they can only be supported by documented, graded search.

The claim is also newly *machine-made*, which changes its epistemic status. Increasingly the "first translation" assertion is produced not by a cataloguer but by an AI pipeline that reads the scanned pages and writes interpretive metadata. This is a category shift: where catalogue metadata was once a *transcription* of the object (title, date, subject heading), an asserted "first translation" is an *inference about the entire historical record* — and one the originating pipeline cannot, even in principle, verify, because reading a book's own pages tells you nothing about whether someone else translated it a century earlier. A claim of this kind degrades in two opposite ways:

- **False first (precision error):** the badge is shown, but a prior translation exists. These concentrate around *famous* works — important enough that a scholar already translated them — especially in traditions where Western bibliographic databases are blind.
- **Missed first (recall error):** a genuine first carries no badge, because the book was never assessed at all.

Counting only badged books measures precision and is structurally blind to recall. An honest census must sample **both** the books a system claims and the books it never examined. This paper does so, and in the process builds the instrument the question lacked: not a registry of translations (which cannot settle a negative) but a **published, per-book ledger of graded evidence of absence** — who searched, where, with what queries, and what they found — released as a citable dataset alongside the estimates.

Our contribution is therefore methodological as much as empirical: a reusable audit pipeline for AI-generated negative-existence claims — sampling design → multi-model grounded adjudication → bias correction → human verification → documented search-provenance as graded evidence-of-absence — run end-to-end on a deployed system, reporting not just an accuracy number but the failure modes, the cost/quality trade-off across models, and the methodological traps we fell into and corrected. The census result matters to one library; the instrument, and the finding that error tracks fame rather than language, should transfer to any institution that lets a machine assert what has never been done before.

## 2. Related work

Our work sits at the intersection of four literatures.

**Metadata quality in digital libraries.** Library and information science treats catalogue metadata as a measurable artifact with error rates, completeness gaps, and provenance concerns (the accuracy/completeness/consistency dimensions of the metadata-quality literature; aggregation-era audits in Europeana and the DPLA). What is new here is that the metadata under audit is *machine-generated and interpretive* rather than human-keyed and descriptive, which moves the quality question from "does this field match the object?" to "is this assertion about the world true?" *(To cite: Bruce & Hillmann; Park; Europeana/DPLA aggregation-quality studies.)* Adjacent to this literature sits the missing-infrastructure problem the present paper instantiates: the bibliographic negatives that govern effort allocation — has this been digitized, has this been translated — have no answering institution. We documented the digitization half, with a 3.5-million-record registry prototype harvested across 19 sources, in a companion piece (Lomas 2026); the present paper takes on the harder, translation half, where a shared list is necessary but cannot suffice.

**LLM factuality, abstention, and grounding.** The claim is a factual assertion an LLM gets wrong in a specific way: confident fabrication of, or failure to recall, an obscure prior. Calibration, selective prediction / abstention ("knowing what you don't know"), and retrieval grounding as a hallucination mitigant are directly relevant; our `unverifiable` verdict is an engineered abstention path, and our finding that grounded adjudication still fails systematically where the index is sparse is a concrete instance of grounding's limits. *(To cite: hallucination surveys; selective-prediction work; retrieval-grounded factuality.)*

**Translation-studies bibliography.** The object of the claim — which works have been translated, when, by whom — is the domain of translation bibliography (UNESCO's *Index Translationum*; series authorities Loeb, Sacred Books of the East, the Ante-/Post-Nicene Fathers; tradition corpora 84000/BDRC, CTEXT/CBETA, GRETIL, Sefaria). We use these both as grounding sources and as a seed catalogue for deterministic checks; their known incompleteness for non-Western and pre-modern vernacular translation is why a first claim must be bounded, not absolute. *(To cite: Index Translationum; the digital tradition-corpora.)*

**Evidence of absence and prevalence under an imperfect test.** Framing a "first" as a systematic-review-style gap claim — whose strength is the documented breadth and independence of the search, not a single lookup — comes from evidence-synthesis methodology. Correcting an observed rate for the fallibility of the measuring instrument is the **Rogan–Gladen** estimator from epidemiology, which recovers true prevalence from an apparent rate given a test's sensitivity and specificity; treating each LLM adjudicator as an imperfect diagnostic test with measurable operating characteristics is, to our knowledge, a novel transfer of that idea to bibliographic auditing. *(To cite: Rogan & Gladen 1978; prevalence-under-misclassification literature; systematic-review search-completeness methods.)*

## 3. Population and denominators

All counts are live against the production catalogue, 19 June 2026. **The catalogue has since grown; Appendix B carries the reconciled August 2026 denominators and the v2 system state — reconcile §3/§5 scale-ups to those before submission.**

| Population | Count |
|---|---|
| Publicly visible books | 30,868 |
| Translated to English (`pages_translated > 0`) | 15,707 |
| — English-language originals (not eligible) | 1,737 |
| **First-translation-eligible (translated, non-English)** | **13,970** |
| Currently badged as first translations | 5,696 |
| **Eligible but never assessed** | **8,306** |

The eligible population is the natural denominator: a first *English* translation presupposes a non-English source text we have rendered into English. The badged (5,696) and never-assessed (8,306) books partition the eligible pool (modulo a small assessed-and-rejected remainder).

## 4. Method

### 4.1 Verdict taxonomy

Each book is adjudicated to one of eight mutually exclusive verdicts, replacing a prior boolean flag:

- `first_no_prior` — no English translation of this text in any form.
- `first_from_source` — English of the work exists from a *different* source language, but not from this text.
- `first_complete` — only partial/excerpt English exists; ours is the first complete one (gated on our item being complete).
- `first_modern` — only antiquated (pre-~1900) English exists.
- `not_first` — a complete modern English translation of this text exists.
- `not_applicable` — not a single translatable text: visual art, scripture-manuscript copy, a non-English edition, or a multi-work container/anthology where the claim is ill-defined.
- `unverifiable` — competent tradition sources are catalogue-blind and the search cannot be bounded.
- `needs_review` — conflicting or inconclusive evidence; unresolved work identity.

The first four constitute the **first-family** (a genuine first claim). Orthogonal qualifiers are recorded per verdict: evidence strength (`strong`/`moderate`/`weak`), our-item completeness, the match key used (`work_id`/`author_title`/`transliteration`), and the prior-relationship when a candidate is found (`same_text`, `same_work_diff_edition`, `different_source_language`, `related_distinct_work`, `partial`, `adaptation`). The relationship qualifier encodes the **source-language rule** (a translation of the same work from another original language still defeats "first") and the **related-work rule** (a translation of a parent/sibling/derivative work does not).

### 4.2 Per-book adjudication (two independent instruments)

For each sampled book, a tool-using agent runs a focused investigation: it identifies the work precisely and separates it from look-alike relatives and other editions; searches **tradition-appropriate** sources rather than Western catalogues alone (84000/BDRC for Tibetan; CTEXT/CBETA for Chinese; GRETIL/SuttaCentral for Indic; Sefaria for Hebrew; Google Books, Internet Archive, HathiTrust, OpenAlex, EEBO and scholarship for European works); applies the source-language and completeness rules; and returns a structured verdict plus a full evidence trail (sources checked, the prior found if any, free-text rationale). Each adjudication is an append-only provenance entry — the "evidence of absence" record.

We run **two independent model instruments** on the identical prompt and taxonomy: a Claude tool-using agent (careful, hand-spot-checked, used for the badged-precision sample and hard strata) and a **Gemini grounded-search call** (~$0.01/book, the scalable engine for the never-assessed pool and full enumeration). Agreement between independent models is treated as confidence; disagreement as an uncertainty band.

### 4.3 Sampling, estimation, and bias correction

We draw random samples and scale up. The badged set is stratified by catalogue density × language family × prior disposition; the never-assessed pool uses simple random sampling. Each stratum's rate is computed with a **Wilson 95% confidence interval**; stratum estimates are scaled to population size and summed, with a finite-population correction on the variance. The reported corpus figure is `N ± M`, not a point claim.

Because the adjudicator is itself a fallible instrument, the headline AI-only estimate is a *biased* read of the truth. Once the human gold standard (§6) yields each adjudicator's sensitivity and specificity, we apply the **Rogan–Gladen** correction, `p_true = (p_obs + spec − 1)/(sens + spec − 1)`, to debias the population rate and propagate the additional uncertainty. Until then, the AI-only numbers below are reported as such, with the AI-vs-AI ceiling stated explicitly.

## 5. Results (AI-only estimate)

### 5.1 Precision: are badged firsts real? (n = 462 of 5,696, Claude)

| Verdict class | Share | Interpretation |
|---|---|---|
| first-family | ~46% | genuine first claims |
| not_first | ~18% | a real prior exists → demote |
| not_applicable | ~30% | ill-defined claim (mostly multi-work containers; also non-English editions, scripture fragments, visual art) |
| needs_review / unverifiable | ~6% | unresolved |

Scaled: **≈3,774 genuine firsts among badged books (95% CI [3,259–4,289]).** The largest error category is not "a translation exists" (18%) but "the claim is ill-posed" (30%) — dominated by ~16% of the sample being multi-work containers (an *Opera Omnia*, a *Patrologia* volume, a Tibetan "miscellaneous writings" bundle) for which a single badge has no clean meaning.

### 5.2 Recall: how many firsts are unclaimed? (n = 1,000 of 8,306, Gemini)

A **grounded** random sample (n=300, drawn with web-search grounding actually enabled — see the caution below) puts the **strict** `first_no_prior` rate at **21.3%** (Wilson 95% [17.1–26.3%]) → **≈1,772 unclaimed genuine firsts ([1,418–2,186])**, and the *graded* first-family rate (incl. first-complete / first-modern) at **32.3%** ([27.3–37.8%]) → ≈2,686. The strict figure is the one to lean on.

**Caution — grounding is load-bearing and an earlier estimate over-stated recall.** An initial n=1,000 run reported strict 25.5% / graded ~38–41%; it was run with a `thinkingConfig: {thinkingBudget:-1}` setting that, we later found, *suppresses Google-Search grounding entirely*. That run answered "no prior found" from the model's parametric memory rather than from search, systematically **over-claiming firsts** (a false-negative-on-priors). With grounding restored, the model surfaces priors it had missed and the genuine-first rate falls ~4 points. The lesson generalises: for a negative-existence claim, an un-grounded LLM verdict is not evidence of absence — and a configuration flag that silently disables search can masquerade as a higher "first" rate.

A higher-yield recall sub-stratum exists and is worth acting on directly: of the **323** books the system itself dispositions `confirmed_first` while the badge is off (the no-setter contradiction pool), a stratified n=18 adjudication found **~47% genuine missed firsts** (Wilson [26–69%], ≈152 of 323) — but also that `disposition: confirmed_first` is itself **~53% wrong** here (containers, English-originals, already-translated texts). Two consequences: the 323 are the cheapest, best-catalogued books to re-badge, **and** a derived flag must not be promoted from disposition unfiltered, or it would inject ~170 new false positives while fixing ~150 false negatives.

### 5.3 Corpus estimate

Combining the two estimates (strict definition):

> **≈ 5,550 genuine first English translations** (≈3,774 badged-genuine + ≈1,772 grounded-missed), band ≈ **5,200–5,950**; ≈ **40%** of the 13,970 eligible books. Under the graded definition, ≈ **6,460** (~46% of eligible). (The precision term is Claude-grounded and unchanged; only the recall term is revised to the grounded estimate.)

### 5.4 The errors nearly cancel

The badged set over-claims by ≈1,900; the never-assessed pool under-claims by ≈1,770 (grounded strict). The two are **near-equal, with over-claiming marginally the larger error** — so the true total lands close to (a touch below) the current badge count of 5,696, but the membership differs substantially. The system is not predominantly over-claiming *or* under-claiming; it is **mis-aimed in both directions at once**, and the corrective action is **re-balancing** (demote ≈1,900, badge ≈1,770), which keeps the count roughly flat while making every claim evidence-backed. (An earlier un-grounded recall run put the missed-firsts term at ≈2,100, which would have made under-claiming the larger error; grounding corrects that — see §5.2.)

### 5.5 Fame, not language

A natural hypothesis is that non-Western claims (Western-catalogue-blind) are systematically unreliable. The data contradict this: obscure Tibetan terma and obscure Latin pamphlets are *both* usually genuine firsts. The false firsts are the **famous** works in any tradition. Worked examples: Kircher's *Arithmologia* (1665) and Fludd's treatises are famous and genuinely untranslated (badges retained — Kircher's was restored after an automated pass wrongly removed it); Tsongkhapa's *Essence of True Eloquence* is famous and was translated by Thurman in 1984 (badge removed). The discriminating axis is catalogue density, not language.

## 6. Human gold standard — the binding validation (in progress)

The §5 estimate is **AI-only**. Two independent models catch each other's *independent* errors, but not their *correlated* ones — shared blind spots, offline or un-indexed priors both models miss. Only an external human authority removes that residual, and it is what turns an AI-vs-AI agreement number into a defensible accuracy claim. This is the binding step before submission, and it is the project's de-circularising layer.

**Review, not re-search.** No human will independently re-hunt for the original of hundreds of obscure texts; that is the expensive search the AI agents already did. The realistic instrument is the systematic-review division of labour — one reviewer searches, a second *audits the search*. So the gold-standard tool runs in **review/audit mode**: for each book it presents the AI's verdict, the prior it surfaced (with a click-through "verify the cited record" link), the sources checked, and the rationale, and asks the reviewer to **Agree / Override / Can't-tell**. A discipline is built in — the reviewer must open the cited record before agreeing, because the model's prose describing a prior is not the prior. The export feeds a scorer that reports the **override rate** (the headline result: expert confirmed X%, overrode Y%), AI-accuracy-as-judged, the *cited-record-opened* rate (a rubber-stamping guard), and the human-corrected stratified first-rate with Wilson CIs and each model's sensitivity/specificity for the Rogan–Gladen correction of §4.3.

**The anchoring tax.** Review mode lets the reviewer see the AI's answer, which inflates agreement. A random **blind-calibration subset** therefore hides the AI until the reviewer commits an independent verdict, then reveals it; the gap between blind agreement and review-mode agreement estimates the anchoring inflation and keeps the de-circularisation claim honest. Annotation is **hybrid**: well-catalogued Western cells are audited in-house; the catalogue-blind non-Western cells (Tibetan/CJK/Indic/Semitic) — where error is worst and where the *correlated* AI blind spot is most dangerous — are routed to tradition specialists, whose domain knowledge is the only thing that can surface an offline prior both models missed.

**What review mode does and does not remove.** Auditing the AI's match cleanly catches **false positives** (a surfaced prior that is wrong or mis-matched — the dominant precision error) and **category errors** (containers, English-originals) at a glance. It is weaker on the **false-negative absence claim**: a reviewer who does not independently re-search can audit whether the AI's "no prior found" search was *competent*, but cannot, alone, surface a prior that both models and the reviewer all miss. This is precisely the *correlated-error* residual (§7, §10): the human layer reduces it only insofar as the reviewer (a specialist) brings knowledge the models lacked. Honest framing, then: the human pass converts the inter-model agreement number into a defensible accuracy claim and removes the *independent* and *match-quality* error, but the correlated offline-prior bias is bounded, not eliminated, short of an exhaustive external-authority pass.

As a seed and feasibility check, AI Tier-2 adjudications of two trap-loaded pilots (12 badged + 18 recall, web-grounded) correctly caught all data-hygiene category errors, a famous prior (the *Ars Notoria*, Englished by Turner 1657), a model hallucination (a non-existent "complete 2009 translation" of the *Yingzao Fashi*), and applied the source-language rule on hard cases (a Greek recension of the Augsburg Confession → `first_from_source`). These seed the review tool directly. Until the human reviews are in hand, accuracy rests on the AI adjudicators, which is the principal limitation (§10).

## 7. Instrument validation

**Ground truth (n = 33).** Against a human-vetted set independently checked against five external catalogues, the Gemini instrument agreed with the catalogue-cron labels on ~77% of binary-comparable cases; every disagreement, on inspection, favoured the adjudicator (it caught prior English translations of Euclid, Dürer's fortification treatise, and Gaffarel's *Curiositez* that the deterministic cron had wrongly badged "first"). The set is two noisy automated signals, not a gold human label, so this understates accuracy.

**Inter-instrument reliability (n = 150).** The same 150 never-assessed books were adjudicated independently by the Claude agent and the Gemini call. Exact-verdict agreement was ~71% (collapsed three-class ~75%, Cohen's κ ≈ 0.57, "moderate"). The decomposition is the key result: **on the evidence question — does any prior English translation exist — the two instruments agreed ~90%**, and the strict `first_no_prior` count was near-identical (32 vs 31). The residual disagreement is **taxonomy-grading variance** (`not_first` vs `first_from_source`; `first_modern` when the only English is pre-1900; `first_complete` when the prior is partial), not search failure. Hence the *strict* count is reproducible across independent models; the *graded* breakdown is instrument-sensitive and must be pinned by sharpening the rules before reporting at the work level. The cheaper Gemini instrument (~$0.01/book) is the appropriate engine for full-corpus enumeration.

**Source quality is a measurable, uneven axis — and it is auditable.** The adjudicator does not query catalogue APIs; it performs *grounded open-web search* (Google Search), steered toward tradition-appropriate catalogues by the prompt. Because every verdict stores the domains it actually consulted, we can measure where the evidence comes from. Across the live full-corpus enumeration (≈1,400 books, ≈4,150 source-hits) the consulted sources are a **mix of authoritative and low-authority**: archive.org, HathiTrust, Brill, Cambridge/OUP, university presses, OpenEdition/OAPEN, Gutenberg, Wikisource and the tradition catalogues — but *also* file-sharing and forum/AI-mirror sites (Scribd, dokumen.pub, blogspot, reddit, grokipedia, ebay, goodreads), which together accounted for a non-trivial fraction of hits. Crucially, **WorldCat — the most authoritative union catalogue — returns 403 to automated agents**, so the cheap Gemini pass under-uses exactly the source a librarian would reach for first. Two consequences. (1) The independent Claude verification pass (Stage 2) sources *better*: when WorldCat blocks it, it pivots to ESTC, VD16/VD17, the Stanford Encyclopedia, and discipline-specific scholarship — part of why the second pass is not merely a different model but a higher-quality search. (2) We hardened the Stage-1 prompt to **down-weight low-authority aggregators and to mark a "no prior" that rests only on weak sources as `evidence_strength: weak`** — so source quality feeds the graded evidence-of-absence directly. The general point: per-source provenance turns "trust the search" into an auditable property of each claim, and reveals that *where* a model looked is as consequential as *which* model looked.

## 8. Two methodological hazards, disclosed

**A prompt-specification bug, caught by internal inconsistency.** The first full run mis-classified ~42% of one category. The cause was a specification error in *our* adjudication prompt: it instructed the agent to mark any book whose text was in the original language as `not_applicable` — but holding the source-language original *and* translating it is precisely the library's model, so those are valid first-translation candidates, not category errors. The error surfaced through the sample's own internal inconsistency (one Latin oration correctly called a first; a near-identical one wrongly disqualified). We corrected the instruction and re-ran the affected subset.

**A small benchmark inverted a model ranking.** An early 10-item "anchor" set ranked a cheap model (Gemini Flash-Lite) *above* a frontier model; expanding to a 42-item clean set reversed the ranking. Separately, an initial heuristic/LLM-consensus ground truth was ~21% mislabelled on inspection. Both are cautions about benchmark-composition risk and about trusting automated ground truth — and both are why §6's human gold standard, not a cleverer prompt, is the linchpin.

**A config flag misattributed to a model.** We initially recorded Gemini 3 Flash-Preview as "unusable" (~62% structured-output failure under grounding) and nearly abandoned it. The true cause was a single config flag — `thinkingConfig: {thinkingBudget: -1}` — which silently *suppressed grounding* and truncated the JSON; with grounding off the model answered from memory, producing both the parse failures *and* fabricated "no prior" verdicts. Removing the flag fixed it, and Flash-Preview (which grounds aggressively) became the primary engine. The lesson: a pipeline failure that looks like a model deficiency can be a configuration artefact — verify the *plumbing* before condemning the model, especially when "the model can't do X" would change the whole tooling choice.

We report these because an auditable method must catch its own mistakes, including the auditor's, and because evidence-of-absence pipelines are unusually sensitive to definitional framing.

## 9. Discussion

**Evidence of absence must be graded, not binary.** A "no prior translation" claim is only as strong as the best documented search behind it. An absence confirmed in competent tradition sources (84000 for a Tibetan text) is `strong`; an absence inferred from a blind Western-catalogue miss is `weak` and is excluded from the headline. Recording the search — sources, match key, rationale — turns a marketing claim into a falsifiable, sourced assertion, and is a scholarly-credibility artifact no competitor offers.

**Containers break one-book-one-claim.** ~16% of badged firsts are multi-work volumes; a first-translation claim is well-posed only at the level of a single work, which requires a work-identity layer (~12% of eligible books carried a `work_id` at the June audit; by August 2026 the identity-stack build had raised this to 98.6% — see Appendix B.6).

**Single-writer derivation prevents drift, but must be gated.** The badge is now a derived read of the graded verdict, written by one reconciliation job, eliminating the historical flag↔disposition drift. As §5.2 shows, that derivation must apply the same data-hygiene gates (container / visual-art / English-original / already-translated) in *both* directions, or it re-introduces false positives while fixing false negatives.

**Transparency as practice.** A library that publicly measures and reports that roughly a third of its headline claims are over-claims (mostly ill-posed) and a comparable number of genuine firsts sit unbadged is doing something rare and credibility-positive: turning a marketing assertion into an auditable one and publishing the method to check it. The honest number is smaller-feeling but more defensible than the round figure it replaces.

### 9.x What generalizes (reflections)

Six observations that we believe transfer beyond first-translation badges to any pipeline that writes AI-generated *factual* or *negative-existence* claims to a durable, public surface:

1. **The evidence trail is the product, not the verdict.** The reusable asset is not "the AI's answer" but the per-claim record of *what was searched, where, and what was found*. This reframes the task from "can a model judge X?" to "is each claim accompanied by an auditable, falsifiable search?" — and it is the property that lets a third party (or a future model) re-check the claim without re-doing the work. Most LLM-evaluation reports *which model*; the durable contribution here is that *where it looked* is recorded and is as consequential as *which model looked*.

2. **Verify-before-write is the binding architecture, and the economics make it tractable.** Single-pass generation cannot touch a public surface (we measured ~63% fabricated priors on the demote direction). The pattern that works is **cheap-wide generation → independent-skeptical verification, with verification applied only to the *flips***. Because the consequential set (the proposed changes) is a small fraction of the corpus, you can afford a *better, different* instrument exactly where it matters — Stage 1 at ~$0.01/book over everything, Stage 2 on hundreds, not thousands.

3. **Correlated error is the structural ceiling — and the human layer is load-bearing, not polish.** Two passes of the *same model family* catch each other's *random* slips but share *knowledge* blind spots (an old scholarly edition neither was trained on, an un-indexed offline translation). Independence must be real (a different model family; ultimately a domain specialist). The human/specialist pass is reserved for precisely the *famous-adjacent* cases where models are most likely to share a gap — it is the only thing that removes correlated error, so it belongs in the architecture, not the acknowledgements.

4. **Claim well-posedness is upstream of accuracy.** A large share of apparent "errors" were not wrong searches but *ill-posed claims*: multi-work containers, manuscript miscellanies, scripture-manuscript copies, works already in the target language. "Is there a prior translation?" presupposes a single, identifiable work — so a **work-identity layer is a prerequisite**, not an add-on, and "not_applicable / needs_review" verdicts carry as much signal as the binary.

5. **A failure that looks like a model deficiency can be a configuration artefact.** We nearly discarded the right engine over a "62% structured-output failure" that was actually a single flag (`thinkingBudget: -1`) silently suppressing grounding. Auditing pipelines must *verify the plumbing before condemning the model* — the cost of misattribution is choosing the wrong tool for the whole project.

6. **The method must catch its own mistakes.** Its credibility rests on reflexivity: the source-language prompt bug surfaced through the sample's *internal inconsistency* (a near-identical pair verdicted differently); an independent verifier *self-corrected* its own coding mid-answer; the grounding bug was found by noticing the evidence trail was empty. An auditor that cannot detect the auditor's errors should not be trusted to audit anyone else's — and provenance is what makes that self-detection possible.

## 10. Limitations

- **No human gold standard yet (§6).** Accuracy rests on AI adjudicators whose own sensitivity/specificity are not yet measured against human labels; the AI-vs-AI agreement bounds independent error, not correlated error. This is the dominant limitation and the next step.
- The combined ±~750 interval is dominated by recall uncertainty; the badged-precision sample (n=462) is tighter than the recall estimate even at n=1,000.
- "No prior translation found" is bounded by what online and tradition sources index; un-catalogued dissertations, single journal-article renderings, and offline scholarship can still harbour a prior. Verdicts grade this but cannot eliminate it.
- Single library, esoterica-skewed domain; generalisability is unproven. A replication on a second collection would strengthen external validity.
- Simple random sampling of the never-assessed pool is unbiased but not minimum-variance; post-stratification could tighten the recall interval.

## 11. Conclusion

A widely-quoted "~6,000 first translations" turns out to be roughly defensible as a *count* but wrong in *composition*: about a third of badged books are over-claims (mostly ill-posed container claims), and a comparable-or-larger number of genuine firsts sit unbadged in the never-assessed tail. The fix is not to shrink the claim but to **re-balance** it, and to attach to each badge the graded evidence of absence that makes it checkable — validated, finally, against a human gold standard that removes the AI-vs-AI circularity. The broader lesson for digital libraries: novelty claims at scale should be reported as sampled estimates with confidence intervals and per-item provenance, not as exact counts from an unaudited flag. We release the verdict taxonomy, prompts, sampling frame, adjudication code, and (forthcoming) gold-standard labels as a recipe other libraries can run.

## Target venues

- **Computational Humanities Research (CHR)** — strongest fit (methods + cultural-heritage data).
- **Journal of Open Humanities Data (JOHD)** / **Digital Scholarship in the Humanities (DSH)** — data/methods paper.
- **LaTeCH-CLfL** (NLP for cultural heritage) or an **LREC** track — for the evaluation / LLM-failure-mode angle.
- *Not* a top-tier ML venue: ML novelty is thin; the contribution is the audit methodology + the deployed-system case study + the human-validated census.

---

### Appendix A. Figures and provenance

- Denominators: production catalogue, 19 June 2026 (30,868 visible · 15,707 translated · 13,970 eligible · 5,696 badged · 8,306 never-assessed).
- Precision sample: 462 books, stratified (catalogue-density × language-family × disposition), Claude tool-agent.
- Recall sample: 1,000 books, simple random from the 8,306 never-assessed eligible pool, Gemini grounded-search; rate stable across 40/73/150/1,000.
- High-yield recall sub-stratum: 323 disposition-contradiction books, n=18 adjudicated.
- All intervals are 95% Wilson; corpus interval uses stratified variance with finite-population correction; Rogan–Gladen correction applied once human sens/spec is available.
- Human gold standard: 150-book stratified sample, hybrid in-house + specialist annotation, anti-anchoring tool, double-annotated κ subset (PR #2614).
- Per-book verdicts, evidence trails, and analysis code in the repository (issue #2564, PR #2573); each adjudication is an append-only provenance record.

### Appendix B. System-state addendum — v2 architecture and August 2026 numbers (added 2026-08-09)

The June draft describes the audit as run against the v1 system. Between June and August the production system changed in ways the paper must reflect; this appendix records the deltas and the reconciled counts, all measured live on 2026-08-09.

**B.1 Reconciled denominators (2026-08-09, same definitions as §3).** The catalogue grew substantially after June (large acquisitions plus continued processing):

| Population | 19 Jun | 9 Aug |
|---|---|---|
| Publicly visible books | 30,868 | 36,799 |
| Translated to English (`pages_translated > 0`) | 15,707 | 18,211 |
| — English-language originals | 1,737 | 1,976 |
| First-translation-eligible | 13,970 | 16,235 |
| Badged as first translations (visible) | 5,696 | 5,925 |
| Eligible with a graded verdict (visible) | — | 10,122 |
| Eligible, never assessed | 8,306 | 6,894 |

§5's scaled estimates use the June population sizes; re-scaling to the August pool is mechanical (the stratum rates are the finding, the scale-up is arithmetic) but must be done before submission, and the recall-side population has *shrunk* relative to growth because the v2 pipeline assessed ~3,900 of the June backlog.

**B.2 Single-writer derivation shipped.** The badge is no longer a mutable flag: `book.first_translation` (graded verdict + qualifiers, `src/lib/first-translation/types.ts`) is the single source, and one reconciliation job derives the public flag from it. Measured 2026-08-09: **99.95% of rendered badges (5,810 of 5,813 visible, translated, badged books) carry a graded verdict** with a `best_attempt_id` pointer into the append-only attempt ledger. The flag↔disposition drift that §9 warned about is structurally closed. The unattended reconcile loop is deliberately demote-only (`--only-demotions`): a valve that only removes claims can never silently mint one, and every promotion passes through the verified evidence path.

**B.3 The escalation ladder (August 2026).** Tier-2 adjudication is now organised as an explicit ladder (`scripts/eval/ft-ladder.ts`): cheap grounded search → independent skeptic verification → (on disagreement or weak evidence) escalation to a stronger instrument, with every rung appending to `first_translation_attempts` under a recorded `prompt_version` (#3778) and, where persisted, a `transcript_ref` into a full-transcript store. The ledger held **64,834 attempts on 2026-08-09** (63,173 after takedown exclusions in the published snapshot), spanning 29,938 distinct books — this is the dataset described in B.5.

**B.4 The 2026-08-09 stratified spot audit (independent replication of §5.1).** An 18-book stratified audit with full citation capture, run by independent verification subagents (2 badged `first_no_prior` per tradition, n=12; plus 6 unbadged "prior found" books): first-family precision 5/12 with Wilson 95% CI [19%, 68%] — consistent with §5.1's 46% (n=462) — and the failure *composition* replicated the headline finding: ill-posedness dominates (6/12: container fascicles, standard liturgy copies, a unique archival document, one volume of a reference work), with exactly one hard false first (Clüver, a 1657 English prior, Wing C4740). On the unbadged side 6/6 verdict directions were correct while 3/6 evidence trails were imperfect (one fabricated-shaped citation, one overstated prior, one muddled work-identity chain) — the verdict-right/evidence-flawed asymmetry §7 predicts. Full report: `scripts/output/ft-spot-audit-2026-08-09/report.md`; the six follow-up corrections were routed through the verified-evidence path, not applied directly.

**B.5 The dataset is now a deliverable (#3798).** `scripts/eval/export-ft-dataset.mjs` produces a versioned, deterministic, PII-swept snapshot of the corpus — attempts, per-book verdicts, screening decisions, the taxonomy codebook, and reference-set composition — with a Datasheet (`scripts/eval/ft-dataset-datasheet.md`) and a Zenodo deposit script (`deposit-ft-dataset.mjs`; draft-only by default, DOI minting is a human action). Books removed by takedown or owner request are excluded from the snapshot entirely. This unbundles the venue strategy: the **JOHD data paper** can go first on the dataset alone (no Rogan–Gladen correction required), while the CHR methods paper waits on the §6 human gold standard, which remains the binding step and remains not yet run (0 annotations).

**B.6 The identity prerequisite has been built (June ~12% → August 98.6%).** §9.4 argued a work-identity layer is a *prerequisite* for well-posed novelty claims, and at audit time only ~12% of eligible books carried a `work_id`. Between June and August the four-layer identity stack shipped as a pipeline property (author/work/edition/duplicate; an identity worker stamps every import and backfills on a 2-hourly cron, and the import-time dedup tier now matches on the materialized edition key). Measured 2026-08-09: **98.6% of FT-eligible books carry a `work_id`, 99.9% an `edition_key`, 79.7% an `author_id`** (98.9% / 99.9% / 89.0% on badged firsts; the all-visible corpus sits lower — 59.5% / 59.9% / 53.4% — because the tail is artworks and unprocessed imports where the claim does not arise). The layer immediately began falsifying its neighbours, as predicted: materializing edition keys enumerated ~200 clusters where one edition carried two `work_id`s (since merged mechanically down to a 71-cluster human queue), and 315 both-visible same-edition duplicate clusters (670 books) remain in a human keeper-choice queue, 37 of them flagged as FT-relevant. Remaining well-posedness gaps are therefore no longer coverage but *quality*: container splitting, the ~20% of eligible books without a resolved author identity, and 471 unreviewed LLM cross-language work-merge proposals. Verdicts in the published dataset carry `work_id` where present, so this coverage is directly measurable from the deposit.

### Notes
- *Provenance: unified working paper — Source Library / EFM, June 2026, opening reframed August 2026. Supersedes the two prior drafts `ft-census-paper.md` (census/results lane) and `ft-audit-paper-draft.md` (audit-method lane). Methodology, code, and data: GitHub issue #2564, PR #2573; dataset export #3798. The human-gold-standard layer (§6) is in progress and is the binding step before the full methods paper is submitted.*
- **Citations are placeholders** (the *(To cite: …)* markers in §2) — fill before submission; Rogan & Gladen (1978, *Am. J. Epidemiology*) and the *Index Translationum* are load-bearing.
- **Lomas 2026** = "Nobody Knows What Has Been Scanned," Source Library blog, https://sourcelibrary.org/blog/nobody-knows-what-has-been-scanned — the digitization-side companion argument (registry prototype: 3.5M records, 19 sources). Cited in §1 and §2.
- **Authorship/credit:** Source Library / EFM + collaborators; decide before drafting submission prose.
- This draft is tracked in the public AGPL repo (an earlier note claimed it was untracked — it is not, and nothing in it is sensitive); it supersedes `ft-census-paper.md` and `ft-audit-paper-draft.md`.
