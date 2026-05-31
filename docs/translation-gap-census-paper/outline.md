# Measuring the Translation Gap: A Reproducible Bibliographic-Census Method for Premodern Corpora, with Estimates for Renaissance Latin and the Chinese Imperial Canon

**Status:** outline + draft abstract (v0, 2026-05-31). Target: venue-quality (JCDL / *Digital Scholarship in the Humanities* / LaTeCH-CLfL workshop), with an arXiv preprint (cs.DL, cross-list cs.CL).

**Authors (tentative):** J. D. Lomas (TU Delft / Source Library), + collaborators TBD.

---

## Draft abstract (~210 words)

It is widely asserted that the overwhelming majority of the premodern scholarly
record has never been translated into a modern language, yet the claim has
remained qualitative — historians describe the untranslated share as
"overwhelming" and the exact figure as "unknowable." We argue it is in fact
measurable, and present a reproducible method for estimating the translation
coverage of a bounded historical corpus: pair a *bibliographic denominator*
(a catalogue enumerating the works of a tradition) with a *translation
numerator* recovered by combining bibliographic catalogues and full-text search,
adjudicated for precision by a large language model that judges whether a
candidate edition is a genuine translation of a specific work rather than a
keyword collision or an excerpt. We apply the method to two independent corpora
that share no language, script, or century: Renaissance-era Latin print, via the
Universal Short Title Catalogue (~444K Latin works), and the Chinese imperial
canon, via the Siku Quanshu (四庫全書, ~3,418 works). We estimate that roughly
**2% of the Latin corpus** and **on the order of 1% (measured 0.3%, 95% CI
0.1–1.3%; upper bound ~2%) of the Chinese canon** have been translated into
English. The convergence of two unrelated traditions on the same
order of magnitude suggests the "translation gap" is a structural feature of
scholarly transmission, not an artifact of any single catalogue. We release all
code, intermediate data, and per-work judgments.

---

## Contributions (enumerated for the intro)

1. **A method** for corpus-level translation-coverage estimation that is
   language- and script-agnostic, separates *recall* (catalogue + search) from
   *precision* (LLM adjudication of work-identity), and uses explicit
   error-state accounting so rate-limit/lookup failures are never silently
   scored as negatives.
2. **Two empirical estimates**, the first quantitative figures for either
   corpus: Renaissance Latin ≈ 2%; Siku Quanshu ≈ 1% (measured 0.3%, CI
   0.1–1.3%, upper bound ~2%).
3. **A cross-traditional convergence result** — same order of magnitude across
   unrelated corpora — and a discussion of why (the bulk of both corpora is
   commentary, collected works, and minor genres, not the famous canon).
4. **Open artifacts**: denominators, per-work translation judgments, and the
   pipeline, for replication and extension to other traditions.

---

## Section outline

1. **Introduction** — the qualitative consensus ("overwhelming/unknowable");
   our claim that it is measurable; contributions; the convergence headline.
2. **Related work** — Neo-Latin studies (IJsewijn; the "post-classical Latin is
   >99.99% of extant Latin" framing); USTC and book-history bibliometrics;
   Index Translationum and its limits; Siku Quanshu scholarship; computational
   approaches to bibliographic matching and LLM-assisted record linkage.
3. **Problem definition** — what "translated" means (we fix: ≥1 published
   English translation/substantial edition of the *work*; sensitivity to
   "any modern language" and "available to a non-specialist" reported);
   denominator choice; the numerator's recall/precision decomposition.
4. **Method** —
   4.1 Denominator construction (catalogue selection; work vs edition
       granularity; coverage/selection bias).
   4.2 Numerator recall (catalogue cross-reference + full-text/book search).
   4.3 Numerator precision (LLM adjudication of work-identity; prompt; the
       "reject excerpts/keyword-collisions" rule).
   4.4 Error-state accounting (TRANSLATED | UNTRANSLATED | ERROR; errors
       excluded, not scored negative) — with the fake-0/100 incident as
       motivation.
   4.5 Estimation (stratification, Wilson intervals, size-weighting).
5. **Case study I: Renaissance Latin (USTC)** — denominator (~444K Latin
   works); 4-matcher robustness ladder (naïve → incipit/bigram → authority
   reconciliation); ~2% with bounds; the catalogue-not-aligned caveat and how
   we address it.
6. **Case study II: the Chinese imperial canon (Siku Quanshu)** — Wikidata
   denominator (3,418 ≈ full); recall via grounded Gemini name-resolution
   (pinyin + established English title) → book search → LLM precision; the
   commentary/edition granularity finding (5/3,418 have an English Wikipedia
   article; 58/3,418 any English name); measured ~0.3% (CI 0.1–1.3%), upper
   bound ~2%; the name-resolution recall fix (validated: 孫子→Art of War,
   commentaries→null) and the residual Google-Books-quota constraint.
7. **Cross-corpus discussion** — convergence; structural explanation (genre
   composition: commentary, collected works, gazetteers, disputations dominate
   both); what the gap means for access and for digitization priorities.
8. **Threats to validity** — denominator coverage/selection bias; metric
   choice; LLM adjudication error (false pos/neg, audited sample);
   English-only vs multilingual targets; survivorship.
9. **Reproducibility & data release** — code, denominators, per-work judgments,
   model + prompts + temperature.
10. **Conclusion & future work** — third tradition (Sanskrit/Arabic);
    target-language generalization; tracking the gap over time as corpora are
    digitized and translated.

---

## Figures & tables (planned)

- **Fig 1.** The method as a pipeline (denominator × [recall→precision] →
  stratified estimate).
- **Fig 2.** Per-corpus translation rate with 95% intervals; the two corpora
  side by side (the convergence visual).
- **Table 1.** Corpus descriptors (denominator size, granularity, source,
  date range, script).
- **Table 2.** Latin robustness ladder (matcher → distinct translated works →
  implied rate → bound).
- **Table 3.** Siku Quanshu strata (English-named vs Chinese-only; counts,
  sampled, translated, CI).
- **Table 4.** LLM-adjudication audit: human-checked sample, precision/recall
  of the adjudicator vs manual verdicts.

---

## Work-to-close checklist (maps to the chosen venue-quality pipeline)

1. ~~**Chinese recall fix** *(critical path)* — resolve Chinese-only-titled
   works to a searchable form, re-run, report the corrected rate.~~ **DONE**
   (grounded Gemini name-resolution; corrected estimate ~0.3%, CI 0.1–1.3%).
   *Remaining:* full-tail census is capped by the Google Books ~1000/day quota
   — add OpenLibrary fallback + spread over multiple days; and improve the
   58-work labeled stratum's recall (it still misses e.g. Libbrecht's
   *Mathematical Treatise* translation — consider hand-verification at n=58).
2. **Latin alignment + error bars** — materialize (or rigorously sample-audit)
   the translation-catalogue↔USTC alignment; replace the 4-matcher heuristic
   bound with a measured error estimate.
3. **Metric definition + sensitivity** — fix the primary metric (English,
   work-level, ≥1 published translation) and report sensitivity to
   "any modern language" and denominator choice.
4. **Adjudicator audit** — hand-verify a stratified sample of LLM verdicts
   (both corpora) to quote adjudication precision/recall (Table 4).
5. **Write + release** — draft, internal review, open data/code, arXiv + venue
   submission.

---

## Open decisions for the authors

- Primary target language: English only (cleanest, defensible) vs "any modern
  language" (bigger numerator, harder to verify). Recommend: English primary,
  multilingual as sensitivity.
- Third tradition before submission? (Strengthens the convergence claim; adds
  time.) Current plan: ship two, frame third as future work.
- Authorship / domain-expert co-author (a Sinologist and a Neo-Latinist would
  materially strengthen review credibility and the related-work section).
