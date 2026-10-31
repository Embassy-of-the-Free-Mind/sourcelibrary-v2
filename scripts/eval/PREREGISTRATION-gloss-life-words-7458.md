# Pre-registration: life-words in the translation prompt (v21 vs v13), #7458

Written 2026-10-31, after the draw and before any arm ran. Runner: `scripts/eval/gloss-life-words-7458/run.mjs`.

## Question
Does a block telling the translator to render 氣, prāṇa, āyus, 命, pneuma/spiritus/srog by what they say, and to write
"life force" / "vital force" / "vital energy" only where the source names such a force, remove those phrases from the
model's own `<gloss>`/`<note>`/`<term>` apparatus without making the page translation worse?

## Arms
- **v13a, v13b**: the live default (v13, hash 51651014), exactly as production sends it (`buildTranslationPrompt` +
  `PAGE_BREAK_SCOPED` + the agy `TRANSLATE_SUFFIX`, previous page's stored English and neighbouring OCR as context).
  v13b is v13a again: the noise floor.
- **v21**: v13 + the `LIFE_WORDS` block (`scripts/maintenance/translation-prompt-v21-life-words.mjs`), nothing else.
- Engine: agy `gemini-3.8-flash-low`, one page per call (the production agy lane). $0.

## Units (pinned in `results/gloss-life-words-7458/units.json`, seed 7458)
One page per work, live books only, not held, not stale, OCR 300–5,000 characters, page image present.
- **Target, 35 pages**: the stored translation has a life phrase inside its apparatus and the OCR does not name a
  vital force. Chinese 12 (OCR contains 氣/气), Sanskrit 9, Latin 7, German 7.
- **Control, 5 pages**: the OCR names a vital force itself (Lebenskraft, vis vitalis, force vitale); "life force"
  or "vital force" is right there.

## Measures
1. **Mechanical (primary)**: target pages whose new translation has an unlicensed life phrase in its apparatus
   (`lifeWordFindings`, `scripts/lib/life-word-gloss.mjs`).
2. **Judge**: blind Opus subagents, one packet of 8 pages each. For each page they see the page image, the OCR, the
   book, and the three translations under shuffled letters. Per translation they give:
   - fidelity 1–5 against the source;
   - counts of life-word renderings that are correct and that are wrong against the source (gloss, note, term or
     body);
   - a list of serious errors (omission, invention, mistranslation that changes the sense).

## Decision rule (all must hold to flip the default)
- **P1 (effect)**: v21 has an unlicensed phrase on at most half as many target pages as v13a. The discordant pairs
  favour v21 at a two-sided exact binomial p < 0.05.
- **P2 (gloss accuracy)**: on target pages, the judge's life-word accuracy for v21 is at least v13a's.
- **P3 (no regression)**: judge fidelity, mean v21 − v13a, has a 95% bootstrap lower bound ≥ −0.15 (the #7499
  non-inferiority margin). Pages with a serious error: v21 is no more than v13a + 2.
- **P4 (controls)**: on the 5 control pages, v21 keeps a life phrase wherever v13a has one, allowing at most one miss.

If P1–P4 hold, the PR seeds v21 and flips `is_default` from v13 to v21. If any fails, v21 is seeded non-default and the
experiment file says which rule failed. v13b − v13a is reported beside every comparison; if the floor is wider than the
effect, the result is "not established".

Out of scope: rewriting the 17,696 stored pages; other engines (lite, Opus); stacking on the #7499 v20 candidate.
