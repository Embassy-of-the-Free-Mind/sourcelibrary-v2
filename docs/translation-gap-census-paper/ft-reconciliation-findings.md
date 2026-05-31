# FT reconciliation — diagnosis (issue #2234 #2), 2026-05-31

Goal: reconcile the ~447 Latin works where the catalog-search verifier
(`translation_verification`) gives a "first"-type disposition but a later
content-based enrichment set `is_first_translation = false`.

## Finding: the set is NOT auto-reconcilable — no safe automated flip

Auditing the 447 shows the data is too noisy to flip or even confidently
auto-propose. Three contaminants:

1. **Language mis-tagging.** English *originals* are tagged `language: 'Latin'`
   and stamped `confirmed_first` — Jefferson's *Notes on the State of Virginia*,
   Spenser's *Faerie Queene*, *Washington's Farewell Address*, Reid's *Inquiry
   into the Human Mind*. These are not translations at all. (Also inflates the
   Latin corpus count itself — a separate cleanup.)
2. **`confirmed_first` is unreliable.** It's applied to non-translations and to
   minor works (hundreds of `Disputatio`/`Theses de …`) where it effectively
   means "catalog search found nothing," not "we produced the first translation."
3. **Qualified-first dispositions are not "first ever."** `first_from_source` /
   `first_complete_translation` / `first_modern_translation` explicitly allow
   prior translations to exist, so a `false` flag on them is often correct.

## Honest worklist (no flag written)

`scripts/analysis/ft-reconciliation-candidates.json` (447 rows):

| Action | n | Meaning |
|---|---|---|
| KEEP_FALSE | 45 | prior translation found, or a qualified-first disposition — flag is correct |
| LANG_MISTAG_SUSPECT | 11 | English-looking title tagged Latin — likely not a translation |
| REVIEW_REFERENCE | 18 | reference/catalogue work — gray area |
| NEEDS_REVIEW | 373 | `confirmed_first` + nothing found — disposition unreliable; per-work human check |

## Recommendations (none auto-applied)

1. **Fix the language mis-tags** (English works tagged Latin) — a distinct
   corpus-integrity bug that also affects the Latin holdings count.
2. **Re-verify with a stricter prompt** that distinguishes "first English
   translation ever" from "no translation found in catalogs," and that refuses a
   first-claim on works the system can't confirm are translations.
3. **Per-work human review** of the 373 — not automatable.
4. The **~1,323 unverified** Latin translations need a fresh catalog-FT run
   (partly gated on the Google Books daily quota).

## Impact on the paper

The §5.1 "Source Library closes the gap" first-translation count (~2,119 flagged)
inherits this uncertainty: it can't be tightened automatically, and a slice of
the "Latin" holdings are mis-tagged non-Latin/non-translations. The paper should
state the first-translation count as a flagged figure with this caveat, not a
reconciled one.
