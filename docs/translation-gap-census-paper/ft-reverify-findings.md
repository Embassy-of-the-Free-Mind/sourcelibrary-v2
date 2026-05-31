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

## Honest limitation — why this is NOT an auto-flip

FIRST_LIKELY rests on the model's *from-memory* "no English translation exists"
claim — an unverified absence assertion that can be wrong (hallucinated absence).
So the strict prompt resolves the *conflation* (cleanly separates NOT_FIRST from
candidate-first) but FIRST_LIKELY is a **"needs catalog-grounded confirmation +
human review"** bucket, not a signal to set is_first_translation=true. Flipping
flags off it would risk re-introducing false public "first translation" badges —
the very failure mode #1974 is about. No flag was written.

## Recommended pipeline (for whoever does the remediation)
1. Run the strict re-verify over all 437 contested + 1,323 unverified
   (Google-Books-quota-gated — spread over days, use OpenLibrary fallback).
2. NOT_FIRST → safe to confirm is_first_translation=false.
3. FIRST_LIKELY → re-ground each against live catalog search (not memory); only
   then surface for human approval before setting true.
4. NEEDS_HUMAN → manual.

This converts "unreliable boolean" into "evidence-backed, review-gated" — but it's
a multi-day grounded run + human pass, not a one-shot script.
