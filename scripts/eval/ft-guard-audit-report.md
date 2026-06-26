# First-Translation Prior Evidence-Quality Guard: Audit Report

**Date:** 2026-06-19  
**Module:** `src/lib/ft-prior-guard.ts`  
**Tests:** `tests/unit/ft-prior-guard.test.ts`

---

## Background

The `is_first_translation` flag is derived from `translation_verification.disposition`. A reconcile run trusted `disposition: translation_found` as evidence a book is not a first translation. That disposition is fallible: the cited prior may be fake evidence. This guard module evaluates whether a cited prior is *trustworthy evidence* before accepting a demotion.

---

## Guard Logic

`evaluatePrior(book, citedPrior) → { trustworthy, failedGuards, confidence }`

Four guards, applied to `book { title, author, language }` and `citedPrior { english_title, translator, pub_year, completeness, publisher, series, notes }`:

### SELF_MATCH (definitive, high confidence)
Fires when the cited prior is the same publication as the book itself. Logic:
- Computes *book-title coverage* (fraction of book title tokens present in prior title) and Jaccard similarity
- Fires when `(coverage ≥ 0.80 AND author-translator overlap) OR (coverage ≥ 0.60 AND author tokens match translator tokens) OR (Jaccard ≥ 0.75 AND author-translator overlap)`
- Author-translator overlap is REQUIRED to prevent false positives on genuine prior translations of the same work by a different person (Erasmus's Paraphrases translated by Udall does not self-match)
- Handles variant spellings ("Bhagavatam" / "Bhagawatam") via the lower coverage threshold when translator names match exactly

### ANTHOLOGY (definitive, high confidence)
Fires when the cited prior contains anthology/study keywords in its title or series — indicating it is a collected-works or scholarly study, not a translation of the specific work. Keywords include: `anthology`, `collected works`, `theatre of the world`, `reader`, `companion`, `works of`, `sourcebook`, `complete works`, etc.
- Suppressed when book-title tokens are well-represented in the prior title (`Jaccard ≥ 0.45 OR coverage ≥ 0.80`) — prevents firing when the prior title IS an expanded version of the specific work

### PARTIAL (definitive, high confidence)
Fires when `completeness === 'partial' | 'excerpts'`, or when partial-signal keywords appear in the title/notes and completeness is not explicitly `complete`. Partial citations do not defeat a "first complete translation" claim.

### LOW_CONFIDENCE (heuristic, low confidence)
Fires when no token from the book author appears anywhere in the cited prior's text fields. This is a weak heuristic flagging possible namesakes or misattributions. LOW_CONFIDENCE alone does NOT set `trustworthy: false`.

**`trustworthy: false` requires at least one definitive guard (SELF_MATCH, ANTHOLOGY, or PARTIAL) to fire.**

---

## Unit Test Results

**24/24 tests passing.** Run: `npx vitest run tests/unit/ft-prior-guard.test.ts`

| Test case | Book | Expected guard | Result |
|-----------|------|----------------|--------|
| Arithmologia (id=69af0a0a...) | Kircher Arithmologia | ANTHOLOGY fires | ✓ PASS |
| Arithmologia | Kircher | SELF_MATCH does not fire | ✓ PASS |
| Arithmologia | Kircher | PARTIAL does not fire | ✓ PASS |
| Arithmologia | Kircher | confidence=high | ✓ PASS |
| Vijnanananda (id=69925911...) | Devi Bhagavatam | SELF_MATCH fires | ✓ PASS |
| Vijnanananda | Devi Bhagavatam | confidence=high | ✓ PASS |
| Boas (id=6992598b...) | Bella Coola Indians | SELF_MATCH fires | ✓ PASS |
| Boas | Bella Coola Indians | confidence=high | ✓ PASS |
| Naladiyar (id=69946ec1...) | Kural of Tiruvalluvar | SELF_MATCH fires | ✓ PASS |
| Naladiyar | Kural | confidence=high | ✓ PASS |
| Avicenna (id=69b3e5fb...) | Canon of Medicine / Gruner | PARTIAL fires | ✓ PASS |
| Avicenna | Gruner cited | SELF_MATCH does not fire | ✓ PASS |
| Avicenna | Gruner cited | ANTHOLOGY does not fire | ✓ PASS |
| Avicenna | Gruner cited | confidence=high | ✓ PASS |
| Avicenna Limits test | Bakhtiar 1999 synthetic | trustworthy=true (guard-pass) | ✓ PASS |
| Erasmus (id=69b2ffe2...) | Paraphrases / Udall | trustworthy=true | ✓ PASS |
| Erasmus | Paraphrases / Udall | SELF_MATCH does not fire | ✓ PASS |
| Erasmus | Paraphrases / Udall | ANTHOLOGY does not fire | ✓ PASS |
| Erasmus | Paraphrases / Udall | PARTIAL does not fire | ✓ PASS |
| Edge: excerpts → PARTIAL | Paracelsus | PARTIAL fires | ✓ PASS |
| Edge: anthology series keyword | Agrippa | ANTHOLOGY fires | ✓ PASS |
| Edge: high overlap suppresses ANTHOLOGY | Arithmologia edge | ANTHOLOGY does not fire | ✓ PASS |
| Edge: empty prior | any book | result is defined | ✓ PASS |

---

## Population Audit

Query: `is_first_translation:false AND visible:true AND pages_translated>0 AND translation_verification.disposition:'translation_found'`

| Metric | Count |
|--------|-------|
| **Total books in query** | **3,934** |
| Any definitive guard fired | **536** (13.6%) |
| SELF_MATCH guard | **251** (6.4%) |
| ANTHOLOGY guard | **190** (4.8%) |
| PARTIAL guard | **109** (2.8%) |
| Multiple guards on same book | 14 |

### High-confidence false-match sample (SELF_MATCH)

The following books have `is_first_translation: false` demoted via a cited prior that is the same publication as the book itself:

| Book ID | Title (truncated) | Author | Prior Translator |
|---------|-------------------|--------|-----------------|
| `69ef217fb3e2d3a0927f3054` | Charaka-Samhita | Charaka; Avinash Chandra Kaviratna (trans.) | Avinash Chandra Kaviratna |
| `69ee4f206dd925d126f42ff8` | Barddas | Iolo Morganwg; J. Williams ab Ithel (ed.) | J. Williams ab Ithel |
| `69e961c22beefe2f6f72cce6` | Ancient India as Described by Megasthenes and Arrian | Megasthenes (ed. McCrindle) | John Watson McCrindle |
| `69e75deacc48e59ad74eb6e9` | Kinjeketile | Ebrahim Hussein | Ebrahim Hussein |
| `69e72b98a409200ea79f2eac` | Georgian Folk Tales | Marjory Wardrop | Marjory Scott Wardrop |

Pattern: books originally written in English (or where the editor/translator IS the author) were incorrectly assigned `is_first_translation: false` because the system cited the book itself as its own "prior translation."

### High-confidence false-match sample (ANTHOLOGY)

| Book ID | Title (truncated) | Prior Title (cited as "translation") |
|---------|-------------------|--------------------------------------|
| `69ee941af2c6312502f6ab06` | Cuatro Libros... Francisco Hernández | The Mexican Treasury: The Writings of Dr. Francisco Hernández |
| `69e747ae85f786e884a49391` | Bucolica, Georgica, et Aeneis (Virgil) | The Works of Virgil |
| `69e3ff6bb142e5dd9d6b0167` | Luciani Samosatensis Opera (Vol. 4) | The Works of Lucian of Samosata |
| `69de100b5cedf736edb84e84` | Loukianou Hapanta / Luciani Opera | The Works of Lucian of Samosata |
| `69e012e94e6773d060856934` | Contes Populaires des Bassoutos | The Treasury of Ba-Suto Lore: Being Original Selections... |

Pattern: collected-works ("Works of Virgil", "Works of Lucian") cited to demote a specific volume. Being in the Works of Lucian does not mean a specific Latin edition of a single Lucian text has been translated.

### Partial guard sample

| Book ID | Title | Prior Title | Completeness |
|---------|-------|-------------|--------------|
| `69ef2f4d55d5fee247f6cc53` | Kitab al-Qanun fi al-Tibb | The Canon of Medicine of Avicenna | unknown |
| `69ef2cb085daccce30f2ee22` | Aristoxenus, Nicomachus, Alypius | Greek Musical Writings: Vol. 2 | partial |
| `69e792ea80b52390feb17135` | Hor gling g.yul 'gyed (Gesar Epic) | The Epic of Gesar of Ling | partial |
| `69e534bfd48480a386967015` | Diwan of Abu Nuwas | O Tribe That Loves Boys: The Poetry of Abu Nuwas | partial |

---

## Limits

**This module evaluates the *cited evidence* only, not the full bibliographic record.**

1. **Guard-pass ≠ "book is a first translation."** The Avicenna al-Qanun case (id=69b3e5fb...) demonstrates this clearly: the PARTIAL guard fires on the Gruner 1930 citation (partial, only Book 1), which means that citation doesn't justify the demotion. However, a complete prior translation by Laleh Bakhtiar (1999) exists and is simply *uncited* in the verification record. The guard-pass on Gruner does not change the correct answer. Guards can only reject bad evidence; they cannot certify first-translation status. A guard-fired book still needs fresh verification to confirm.

2. **Guard-fail ≠ "demotion is wrong."** A SELF_MATCH or ANTHOLOGY guard firing means "this specific evidence doesn't support the demotion." There may be other (uncited) complete translations that do.

3. **Heuristic limits:** The anthology keyword list is not exhaustive. A "Complete Works" of Virgil cited for a specific Virgil MS will correctly fire the ANTHOLOGY guard, but a cleverly titled anthology without common keywords will not. The self-match detection relies on title token overlap + author-translator name matching; it will miss cases where the book author has a very short name (<4 chars) or where the translator name is written in a very different form.

4. **`completeness: 'unknown'` is treated as partial when partial-signal keywords appear in the text.** This is conservative (will fire more on unknowns) but appropriate — "unknown completeness" should not justify a demotion.

5. **Population numbers are lower-bounds.** Books with no `translations_found` field (no cited prior at all) are counted but not evaluated (they were already excluded from the 536 count). Additionally, the query `pages_translated > 0` may miss books with pipeline issues.

---

## Files

- Guard module: `src/lib/ft-prior-guard.ts`
- Unit tests: `tests/unit/ft-prior-guard.test.ts`
- This report: `scripts/eval/ft-guard-audit-report.md`
