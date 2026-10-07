# Pre-registration, Amendment 2: translation prompt v16 vs v13

_Written 2026-10-03, **before any paid call** for this study. Issue #3825, sequenced by
#5698 step 1. It amends `PREREGISTRATION-translation-prompt-v15.md`, which stays
the binding text. Every rule that is not named below is unchanged._

PRIOR ART: `PREREGISTRATION-translation-prompt-v15.md`, its "As executed" note and
Amendment 1. Those are the study this repeats. This file records only what differs and why.

## The decision this changes

Flip the default translation prompt from v13 to **v16**, or leave it. v16 is v15 plus one
sentence, inserted directly after v15's OMIT bullet
(`scripts/maintenance/translation-prompt-v16-scope-omit.mjs`). The sentence:

> - This omit rule applies only to the quoted phrase in a `<note>original: "…"</note>`;
>   interpretive and clarifying notes (identifying a person, a place or a cited text,
>   explaining wordplay, a technical term or an allusion) are still wanted wherever a reader
>   would need them.

Rows: v13 `51651014` (default), v15 `f60c6810`, v16 `0ce1f483`. All are `Standard Translation`,
type `translation`. v16 was inserted with `is_default:false`; the v13 and v15 rows were not
touched.

## Held fixed from the 2026-09-12 run (#4767)

- **Harness:** `translation-prompt-ab.mjs`, with the same door (`buildTranslationPrompt`),
  `thinkingBudget: 0`, safety settings, `maxOutputTokens` rule, no previous-page context and
  concurrency 4.
- **Sample:** the same pinned 320 pages from 320 books, 8 strata × 40
  (`results/translation-prompt-v15-sample.json`). There is no re-draw.
- **Model routing:** flat **`gemini-3.1-flash-lite`** on every page in both arms, as
  executed on 2026-09-12. _Note:_ production has since moved bph-mss and tibetan-mss back to
  full flash (`getTranslateModelForBook`, #4742). Those two strata are therefore measured on
  lite, not on the model they ship on. Their rows are reported, not gated, as before.
- **Bootstrap seed:** `0x5eed`. Since #5373 the generator is mulberry32, so CIs are not
  bit-comparable with the 2026-09-12 report. Both arms here use the same generator.
- **Criteria 1–3, 5 and 6, their thresholds, and the 30-pair blind judge.**

## What differs, and why

1. **Both arms are re-run.** The 2026-09-12 v13 outputs are not reused. Three weeks of
   model-side drift would otherwise confound the arm effect. Cost: 640 calls, estimate $1.47.
2. **Criterion 4 (body length) is computed on pages where neither arm looped**
   (`finishReason: MAX_TOKENS`). This is Amendment 1's prospective change, applied now as it
   said it would be. The loop rate per arm is reported as its own outcome. The all-pages
   figure is printed beside it.
3. **New criterion 7: interpretive notes per page under v16 are not more than 15% below
   v13.** An interpretive note is every `<note>…</note>` whose content does not begin with
   `original:`. Image-description notes count, as they did in the 09-12 report's 1.27 → 0.81
   (that figure reproduces exactly under this definition). The −15% floor is the figure the
   09-12 report proposed. The outcome also carries a paired page-resampled CI, which is
   reported, not gated.
4. **Judge brief excludes the header class.** The new last sentence reads: _"Do NOT count a
   running header, printed page number, signature mark or catchword that one side reproduces
   and the other omits: those belong to the transcription by design."_ On 09-12, 4 of the 8
   "v15 worse" verdicts were this class (#3825 item 4 removes headers on purpose). The judge
   sees **the same 30 pages** as the 09-12 judge (`--pairs-from
   results/translation-prompt-v15-judge-key.json`). Left/right is re-randomised from the
   seeded stream. Judges are blind Claude subagents, one batch of 5 pairs each. Criterion 6
   is unchanged: v16 worse ≤ 1.5 × v13 worse, ties excluded.
5. **Per-stratum Δ carries a PAIRED CI.** Pages are resampled with both arms attached, for
   the verified-note rate, emission and interpretive notes. This is reported, not gated, as
   before. Hebrew and Arabic are read separately.
6. **Spend cap:** `--cap-usd 3` is a hard stop inside the harness. No `allow_scopes` envelope
   was opened. A scope is a permission for pipeline workers to translate the books it names.
   Opening one over 320 sampled books would have let the pipeline spend on them. The eval
   calls Gemini directly and is not metered by scopes. The cap is enforced by the harness and
   the actual spend is reported from token counts.

## Known before the run: the verifier moved

`page-terms-parse.mjs` changed on 2026-09-13 (#4777/#4778/#4788): orthographic variants
and romanisations are no longer counted as fabrication. Re-scoring the **unchanged**
2026-09-12 outputs with today's verifier gives v13 **76.3%** (was 66.7%) and v15 97.6% (was
96.3%). Hebrew v13 is 25.0% (was 8.3%) and Arabic v13 42.9% (was 28.6%). The note
denominators are the same (135 and 246). So the 09-12 headline overstated v13's
fabrication, most of all on Hebrew. This study scores both arms with today's verifier. Its
numbers are comparable with each other, not with the 09-12 report.

## Decision rule for v16

Recommend the flip iff criteria **1–7** all pass and **criterion 6** (judge) passes.
Otherwise do not flip, and name the criterion that failed. As in the 09-12 study, partial
credit is "not established". Derek decides in any case. #5497 (the Tengyur run) and the
#5695 measurements are calibrated on v13.
