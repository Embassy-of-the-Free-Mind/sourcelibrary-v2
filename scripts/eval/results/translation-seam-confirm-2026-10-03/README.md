# The seam family alone (v13 + #5305 items 1, 1b) vs live v13: confirmatory (#5305)

Run 2026-10-03 by Hetzner job seam-confirm-5305.
- Pre-registration: `../../PREREGISTRATION-translation-seam-confirm.md`, committed before the draw; amendments 1–2
  are dated.
- Harness: `../../translation-prompt-v14-ab.mjs --study seam`. This is the v14 runner with one extra arm config;
  the door, packets, judge text and scorer are the same.
- **Nothing was written to `pages` or `prompts`. Nothing was flipped.**

## What ran

- **Arms:**
  - v13a: the live default, md5 `516510147237b6a79d9d3f6e797bba7f`.
  - v13b: v13 again, the noise floor.
  - seam: v13 plus v14's item 1 (the "This page only" section) and item 1b (the bare continuity marker), worded
    byte for byte as in the v14 arm. Saved as `prompts/translation/standard-translation-seam-candidate.md`, md5
    `9d9794376f5d09211ca95509e44bef57`.
- **Door:** the chained Batch lane's. Every unit is a two-page block (N + N+1), seeded with the stored translation
  of N−1, with adjacent OCR and `PAGE_BREAK_SCOPED`, on **gemini-3.1-flash-lite** with `thinkingBudget 0`.
- **Units:** 125 new pages, one per book; no book from the v14 sample is included.
  - Drawn from the chained-lane frame: pages the lane wrote with a seed.
  - 100 page breaks: the source ends open.
  - 25 controls: the source ends closed.
  - Languages: 97 Latin, 10 Chinese, and a few each of German, Hebrew, Arabic, Greek and others (`draw-log.json`).
- **Spend:** 375 Batch requests, **$0.531** (estimate $0.944). Metered in `gemini_usage` as
  `eval/translation-seam-confirm-5305`.
- **Judging:** 24 blind Opus subagent packets, using `JUDGE-PROMPT-v14ab.md` unchanged: 392 items, including 20
  repeats. The judges agreed with themselves on the 20 repeats as follows: invention flag 18/20, fidelity 17/20,
  omission 20/20.

## Result

| | v13a | v13b (noise) | seam | seam vs v13a (discordant) | noise (v13b vs v13a) |
|---|---|---|---|---|---|
| **Page-boundary invention, page breaks (P), pages of 100** | 19 | 19 | **19** | 8 vs 8, one-sided p 0.60 | 8 vs 8 |
| Invention flag, page breaks | 32 % | 33 % | 34 % | 13 vs 11 | 13 vs 12 |
| Omission, page breaks | 21 % | 18 % | 18 % | 11 vs 14 | 8 vs 11 |
| Fidelity ≥ 4, page breaks | 81 % | 81 % | 84 % | | |
| Unmarked open end (`openEnd`), page breaks | 25 % | 31 % | 29 % | 11 vs 7 | |
| **Control invention (G1), pages of 25** | 4 | 5 | 3 | 2 vs 3 | 2 vs 1 |
| Control omission, pages | 3 | 4 | 3 | | |
| **Omission pooled (G2), pages of 125** | 24 | 22 | 21 | 13 vs 16 | 12 vs 14 |
| **Payload inside `<meta>continues from previous page…`, pages of 125** | 6 | 5 | **0** | 0 vs 6, p 0.031 | |
| Block lost page N (parsed short) | 1 | 0 | 2 | | |

**Verdict under the pre-registered rule: FAIL.**
- The primary clause fails: the seam lines do not change page-boundary invention on the chained lane's page breaks.
  All three arms import from a neighbouring page on 19 of 100 pages, and the seam arm's discordant pages are split
  8 and 8.
- Both guards hold.
- The one measurable effect is item 1b's: no text inside the continuity meta (6 → 0 pages). On this door the
  payload is rare.

## Why this differs from the v14 run

In v14, page-boundary invention fell from 20 to 8 pages. That drop came from the **single-page-door** strata, not
from the block door:

| v14 run (2026-10-02) | door | meta payload v13a / v13b / v14 | page-boundary v13a / v13b / v14 |
|---|---|---|---|
| audit-flagged (45) | single | 22 / 18 / 0 | 8 / 11 / 2 |
| page breaks (25) | block | 1 / 1 / 0 | 7 / 4 / 3 |
| controls (25) | single | 7 / 8 / 0 | 2 / 1 / 3 |

On the single-page door (`buildTranslationPrompt`), v13 often writes the previous page's words into the continuity
meta, and the judge counts that as page-boundary invention. The bare marker stops it. On the block door, the one the
chained lane sends and the one this study pre-registered, v13 rarely writes a meta payload. The bridging that remains
is the model finishing a sentence or a hyphenated word from page N+1, and the "This page only" lines do not stop it.
Whether the effect holds on the single-page door is untested: v14's finding there was exploratory.

## Examples

1. **The seam lines stop an import here; the noise arm stops it too.** *Melethema de foro cogitationis*,
   https://sourcelibrary.org/book/6a4cc0847687f036b4454794?page=13
   - The page ends "…legibus apertè contrarium est, per quas".
   - v13a carries on with the next page's argument ("and attempts sometimes enjoy impunity… How I would wish, if it
     were permitted…"). The judge calls this a major import.
   - v13b and seam both stop at "…contrary to the laws, through which".
2. **The seam lines don't stop it, and here v13a was clean.** *De fideiussoribus conclusiones*,
   https://sourcelibrary.org/book/6a4a40386720cfc23da44543?page=12
   - The page ends mid-word: "ne ad hoc quidem ut liberetur, a nisi al-".
   - v13a stops at "unless otherwise", which is correct.
   - The seam arm completes the clause from page 13 and adds page 13's footnote block a–f (major).
   - v13b also imports. This is the sampler, not the prompt.
3. **What item 1b does.** *Conclusiones de iure emphyteutico*,
   https://sourcelibrary.org/book/6a4e4d90d6b40547a16a0d6e?page=15
   - Both v13 draws open with `<meta>continues from previous page: the Emphyteuta can clearly perceive no fruits from
     it:</meta>`, which is the previous page's sentence.
   - The seam arm writes the bare `<meta>continues from previous page</meta>` and starts with this page's "tum quia…".

## Read against the source (the pre-registered check)

The five seam pages judged worst:
- Three are opaque or garbled sources rendered as fluent prose under every arm: Chinese commentary columns from a
  Siku Quanshu Yijing, a Jawi charm, and an Arabic charm.
- One is a Latin polemic with a misread *furor*.
- One is a Latin disputation that completes a hyphenated word from the next page.
- None is a harm that only the seam lines cause.

## Files

- `sample.jsonl`: the pinned units.
- `draw-log.json`: the frame, skips, languages and estimate.
- `arms.json`: arm texts and hashes.
- `batch.json`: the job, its cost and the generation settings.
- `outputs.jsonl`: every response.
- `packets/` and `packet-key.json`.
- `verdicts/`: the Opus verdicts. `packet-17.jsonl.as-written` is the original before the id-swap fix (Amendment 2).
- `JUDGE-PROMPT-v14ab.md`: a copy of the v14 judge text.
- `report.json`: the output of `--score`, with `decision` holding the rule's output.
