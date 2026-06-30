# FT badge sign-off diff — #2880 pilot badged candidates (2026-06-30)

*Independent Stage-2 `ft-verify` re-check (separate `sonnet` subagents, refute-framed, directional) of the 7 BADGED demote/remove candidates the #2880 pilot surfaced (Rounds 1+2, corrected rubric). **Measure-only — NO badges were flipped.** This diff goes to Derek for sign-off; flips need explicit approval + a backup before any write. Evidence: `ft-verify/<id>.json`, consolidated `ft-verify-2026-06-30.json`.*

> **Why this step:** the pilot oracle is a single Tier-2 pass; CLAUDE.md requires an INDEPENDENT re-verify before any public bibliographic flip. Crucially, 4 of the 7 cited only **partial** or **pre-1900** priors — which do NOT justify a demote (they'd be `first_complete`/`first_modern`, badge stays). The verify confirmed completeness/modernity case-by-case.

## Result: 6 valid (1 remove + 5 demote) · **1 SAVED** (badge stands)

| # | action | book_id | work | verify basis | confirmed prior (complete + modern) |
|---|---|---|---|---|---|
| 1 | **REMOVE** | 69aec4473b6ebce5e0ee5929 | The Federalist (1788) | english_original | — (composed in English; not a translation) |
| 2 | **DEMOTE** | 69dbcbea1040d1d5e20bb356 | (ps-)Seneca, De quattuor virtutibus + Ep. ad Paulum | complete_modern_prior | Barlow 1969 (Formula vitae honestae) + M.R. James 1924 (Seneca–Paul letters) |
| 3 | **DEMOTE** | 69b4c08186a5921d5bc4418f | Ficino, Corpus Hermeticum / Pimander | complete_modern_prior | Copenhaver 1992 (CUP); Scott 1924; Mead 1906 — pre-1900 Everard ignored |
| 4 | **DEMOTE** | 69b21db694025df5d2909995 | Raleigh, Waerachtighe Beschryvinghe van Guiana (Dutch) | underlying_work_is_english_original | Raleigh's *Discoverie of Guiana* (1596) — our item is a Dutch translation FROM English |
| 5 | **DEMOTE** | 69c1baee8522835be845b7b6 | Festival prayer book (Sephardi maḥzor) | standard_liturgy_already_english | Spanish & Portuguese Prayer Book (OUP 1965); Mahzor Zihron Rahel 2007 — Pinto 1761 alone was only partial |
| 6 | **DEMOTE** | 69a5e484006a4098422176a4 | Chronicle of Zuqnin (Cod. Vat. Syr. 162) | complete_modern_prior | Harrak 2017 (Parts I–II) + Harrak 1999 (Parts III–IV) = whole — Witakowski 1996 alone was only partial |
| 7 | **KEEP — SAVED** | 69e787604a6785cfd60cb761 | Bum Tha (Śatasāhasrikā Prajñāpāramitā, vol. tha) | prior_does_not_cover_our_volume | 84000/Sparham has published only ch. 1–28 (~8 of 12 vols); **volume tha (vol. 10) is NOT yet in English** → our translation is first for this content; **badge stands** |

## Notes
- **The save (#7) is the headline of this pass:** Stage-1 cited Sparham 2024 as a prior, but 84000's own published portion stops well short of our volume — a textbook partial-prior false demote that the directional verify caught. (Confirms the lesson: never demote on an unconfirmed/partial prior.)
- **#5 and #6 flipped basis, not outcome:** the partial priors Stage-1 cited (Pinto 1761; Witakowski 1996) were insufficient, but the verify found genuinely complete+modern priors, so the demotes stand on firmer evidence.
- **No backup/flip performed.** On sign-off: back up the 6 affected `books` docs first, set `is_first_translation:false` (+ remove the public claim) only for the 6, log each to `first_translation_attempts` with this verify evidence, leave Bum Tha untouched.

## Provenance
7 independent `general-purpose`/`sonnet` subagents, real WebSearch/WebFetch, directional demote/remove prompts requiring a COMPLETE + MODERN (post-1900) prior for a demote to survive. Raw per-book JSON in `scripts/eval/results/ft-verify/`.
