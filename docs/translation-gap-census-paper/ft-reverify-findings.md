# FT re-verification with a strict prompt (issue #1974), 2026-05-31

Built `scripts/analysis/ft-reverify-strict.mjs` — a re-verifier whose prompt
forces ordered gates before any first-claim, fixing the root cause that made the
old data unreliable (it conflated "first English translation ever" with "catalog
search found nothing" and stamped first-claims on non-translations):

1. NOT_A_TRANSLATION — English original, not a translation
2. NOT_FIRST — a prior English translation exists (recorded OR known)
3. FIRST_LIKELY — non-English-source work with no known prior translation
4. NEEDS_HUMAN — uncertain

## Dry-run result (30-sample of the now-437 contested)

tally: FIRST_LIKELY 16, NOT_FIRST 14, NOT_A_TRANSLATION 0, errors 0.

- **Correctly demoted** works the old `confirmed_first` got wrong: Alhazen
  *Opticae thesaurus* (Smith 2001), Iamblichus *De Mysteriis* (Taylor 1821),
  Galen *Opera*, Valla, Kircher *Arca Noë* (1667 "Noah's Ark"), Malpighi
  *Anatome Plantarum* (Adelmann), Bellarmine, Piccolomini.
- **Plausible FIRST_LIKELY** for genuinely obscure works: Clavius *In Sphaeram*,
  Clusius *Rariorum Stirpium*, Mersenne *Cogitata Physico-Mathematica*, Rondelet
  *Libri de Piscibus Marinis*, Assemani *Bibliotheca Orientalis*.
- **0 NOT_A_TRANSLATION** — the language mis-tag fix (#2184) already removed the
  English originals, so the contested set fell 447→437 and is now cleaner.

## NOT_FIRST spot-check (2026-05-31) — memory-based demotions are ~12–29% wrong

Ran the verifier over a 70-book sample (24 NOT_FIRST) and fact-checked the
verdicts. The error rate is entirely concentrated in one half:

| Subset | n | Confirmed wrong | + unsupported |
|---|---|---|---|
| Catalog-recorded (`translations_found` named a prior tr.) | 8 | **0** | 0 |
| Memory-based (`recorded: none`, asserted from model knowledge) | 16 | **3 (19%)** | 7 (44%) |
| **All NOT_FIRST** | **24** | **3 (12.5%)** | **7 (29%)** |

Three confirmed hallucinations — all memory-based, all genuine first-translation
candidates that NOT_FIRST would wrongly bury:

- **Kircher, *Arca Noë*** → claimed a "1667 English edition 'Noah's Ark'." No such
  translation exists (1675 Latin; no full English translation ever published).
- **Nicephorus Gregoras, *Byzantina Historia*** → claimed translated by "Van
  Dieten." Van Dieten's translation is **German**; no complete English exists.
- **Malpighi, *Anatome Plantarum*** → claimed "Adelmann, 1960s." Adelmann wrote
  *about* it and called the plant material "beyond the competence of the present
  writer." No English translation.

(Note: the "correctly demoted" examples in the dry-run section above include
*Arca Noë* and *Malpighi/Adelmann* — i.e. the earlier write-up trusted two of
these hallucinated groundings. They are demotion **errors**, not successes.)
Plus 4 on hand-wave reasoning with no named translation: Galen *Opera* vol 18 pt
2, *Poemata Omnia* (model guesses the author), Bellarmine *De Sacramento
Eucharistiae*, *Sophiae cum Moria Certamen*. The 8 catalog-recorded verdicts were
100% correct.

## Honest limitation — why this is NOT an auto-flip (in EITHER direction)

The failure mode is symmetric, and it is the same root cause both ways: **a model's
training memory cannot settle a bibliographic fact.**

- **FIRST_LIKELY** rests on a from-memory *absence* claim ("no English translation
  exists") — an unverified absence assertion (hallucinated absence).
- **NOT_FIRST**, when not backed by a recorded catalog hit, rests on a from-memory
  *presence* claim ("a prior translation exists") — an unverified presence
  assertion (hallucinated presence), as the spot-check above demonstrates.

So the strict prompt resolves the *conflation* (cleanly separates the buckets) but
neither a memory-based NOT_FIRST nor any FIRST_LIKELY may write a flag. Doing so
would re-introduce false public "first translation" badges (or wrongly bury real
firsts) — the very failure mode #1974 is about. No flag was written.

**Methodological rule:** catalog identification is the only valid basis for a
NOT_FIRST determination. A prior translation is a positive bibliographic fact —
it lives in catalogs, not in model memory. Memory may only *surface candidates to
look up*; a catalog hit is the only thing that can *settle* NOT_FIRST. (And a
catalog miss still can't settle FIRST — absence of evidence — so FIRST always
needs human sign-off.)

## Recommended pipeline (for whoever does the remediation)
1. Run the strict re-verify over all 437 contested + 1,323 unverified
   (Google-Books-quota-gated — spread over days, use OpenLibrary fallback).
2. **NOT_FIRST with a recorded `translations_found` entry** → safe to confirm
   is_first_translation=false. **NOT_FIRST with `recorded: none` (memory-only)**
   → NOT safe; re-ground against live catalog search and route to human review,
   same as FIRST_LIKELY (~12–29% of memory-based NOT_FIRST verdicts are wrong).
3. FIRST_LIKELY → re-ground each against live catalog search (not memory); only
   then surface for human approval before setting true.
4. NEEDS_HUMAN → manual.

Implementation note: the strict prompt currently invites memory-based NOT_FIRST
("from the recorded list OR your knowledge"). The grounded remediation run should
either drop the "OR your knowledge" license for NOT_FIRST, or tag each NOT_FIRST
with whether a recorded hit backs it so the gate in step 2 can be applied
automatically.

This converts "unreliable boolean" into "evidence-backed, review-gated" — but it's
a multi-day grounded run + human pass, not a one-shot script.
