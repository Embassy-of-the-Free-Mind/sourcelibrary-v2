# Pre-registration: the seam family alone (v13 + #5305 items 1 and 1b) vs live v13, confirmatory (#5305)

_Written 2026-10-03, **before the draw, before any paid call and before any arm output exists** (Hetzner job
seam-confirm-5305). Harness: `scripts/eval/translation-prompt-v14-ab.mjs --study seam` (the v14 runner, extended with
one arm config; same door, same judge packets, same scorer). The decision rule below is fixed now. Any change after
the paid submit goes under "Amendments" with its date and reason; the rule is not rewritten._

PRIOR ART: `PREREGISTRATION-translation-prompt-v14.md` and its result (PR #5669; #5305 comment of 2026-10-02 22:10Z).
That run found that v14 as a package had no measurable effect on judged invention, but that its seam edits moved
their own secondaries: continuity-meta payload 32 → 0 pages, page-boundary invention 20 → 8 pages (p 0.012). Those
were secondaries of an exploratory package test, found after looking. This study tests them as the primary, on new
pages, with the other edits removed.

## The decision this informs

Whether the live translation prompt (v13, `prompts` type `translation`, `is_default`, md5 `516510147237b6a79d9d3f6e797bba7f`)
should gain v14's items 1 and 1b and nothing else. **Nothing is flipped by this study**, and no `prompts` or `pages`
row is written. The flip is Derek's call. The candidate has no version number: `prompts` rows translation v14 and
v15 already exist as different prompts, so a number would collide.

## The candidate

`prompts/translation/standard-translation-seam-candidate.md`, prompt body md5 **`9d9794376f5d09211ca95509e44bef57`**
(7,968 chars; v13 is 7,233). It is v13 with exactly two of v14's edits, taken by reference from `V14_EDITS` in the
harness (`SEAM_EDITS = [V14_EDITS[1], V14_EDITS[3]]`), so the wording is byte-identical to the v14 arm. The draw
rebuilds it from the live v13 row and refuses to run if the md5 differs from the committed file.

1. **Item 1**, a new section after the `<unclear>` section:
   > **This page only (CRITICAL):**
   > - Render only this page's words. If a sentence continues onto the next page, stop where this page stops, mid-sentence if need be. If a sentence began on the previous page, start with this page's first word.
   > - The previous page's translation is given for names and terms only: never repeat, complete or borrow its words, the next page's words, or what you know of the work.
   > - A catchword (the next page's first word printed again at the foot of this page) is a printer's device: do not translate it. A word split by a hyphen at the page break is translated once, on the page where it begins.
2. **Item 1b (#5376)**: the bracket-replacement line `<meta>continues from previous page: ...</meta>` becomes
   `<meta>continues from previous page</meta>, the marker alone. Write nothing after it inside the tag: every word of
   this page belongs in the translation itself.`

Left out: items 3–7 and the #5137 misread line (no detectable effect in v14), item 2 (#5638's), the Tibetan lines.

## Arms

| Arm | Text | Seed |
|---|---|---|
| **A** (`v13a`) | live v13, byte for byte | stored translation of page N−1 |
| **A2** (`v13b`) | v13 again, an independent draw: the **A-vs-A noise floor** (sampler + judge) | same |
| **S** (`seam`) | the seam candidate | same |

Door, every arm: the chained Batch lane's, as in v14 — `buildBlockTranslationPrompt` with the stored translation of
N−1 as continuity seed, the adjacent pages' OCR, and `PAGE_BREAK_SCOPED` (`translate-batch-chained.mjs
buildRoundRequest`). Every unit is sent as a two-page block (N + N+1), as the lane sends a block; **page N is judged**.
Model **gemini-3.1-flash-lite**, Batch API only, `thinkingBudget: 0`, `maxOutputTokens = maxOutputTokensFor(pages)`,
default temperature, safety BLOCK_NONE (recorded in `batch.json`).

## Strata (drawn by `--draw --study seam`, seed 53055)

Frame: the frame of `translation-corpus-audit/draw-chained.mjs` — books with a `translate_batch_runs` record in mode
`chained`, pages the lane wrote (`translation.engine.call_site = scripts/lib/translate-batch-chained.mjs`) with a
continuity seed (`engine.input.context.previous_translation`), not hand-edited, not an excluded page type, model a
Gemini 3/3.1 Flash(-Lite). Books are visited in seeded order; **one random such page per book**. Excluded: every book
in the v14 sample (so no v14 page, and no v14 book, recurs); English and Tibetan books; OCR under 200 chars; page
N+1 without OCR; page N−1 without a stored translation today.

- **pagebreak (≈100)**: the picked page's source ends open (`sourceEndsOpen` — mid-sentence, mid-quotation, a hyphen
  or comma at the foot), the definition v14 used.
- **control (25)**: the picked page's source ends closed. "Clean" here means a page whose end gives the prompt no
  seam to bridge; these pages carry no prior judge verdict (they are new), unlike v14's controls.

Classification is by the page's own ending, after one page per book is picked, so neither stratum is selected on
the translation. The draw stops when both quotas are filled.

Requests: ≈125 units × 3 arms ≈ 375 Flash-Lite Batch requests, each a two-page block. **Expected ≈ $0.30–0.60;
hard cap $3.00** (the `--draw` estimate is quoted in Amendment 1 before the submit; `--submit` refuses without
`--approved-usd`). Metered in `gemini_usage` as `eval/translation-seam-confirm-5305`.

## Judging

Blind Claude Opus subagents, packets of ≈16 items, the v14 judge text verbatim
(`results/translation-prompt-v14-ab-2026-10-02/JUDGE-PROMPT-v14ab.md`: the #5274 audit rubric + the addendum with
previous/next page SOURCE shown and invention/omission kinds). Opaque ids, arms shuffled across packets, no arm,
model or prompt named. **20** (page, arm) items repeated under new ids in other packets (judge noise).

## Outcomes

- **Primary (P)**: on the **pagebreak** stratum, the number of pages whose judged defects include an invention of
  kind `page-boundary`, **S vs A**, paired by page. Test: exact **one-sided sign test** on discordant pages
  (H1: S flagged on fewer pages), **alpha 0.10**.
- **Noise floor (read FIRST)**: the same count, A2 vs A.
- **Guard 1 (G1)**: on the **control** stratum, pages with a judged invention flag (any kind), S vs A.
- **Guard 2 (G2)**: pages with a judged omission flag, both strata pooled, S vs A.
- **Secondary**: pages with text inside the continuity meta (`<meta>continues from previous page: …</meta>`,
  mechanical, the v14 `metaPayload` regex), pooled, per arm, with the paired test.
- Reported, not in the rule: invention flag and kinds per stratum, fidelity, unmarked open ends (`openEnd`), N→N+1
  drift/duplication, duplication with the seed, judge repeat agreement.

## Decision rule (fixed now; counts are pages)

**PASS** (the seam candidate is recommended) if and only if all three hold:
1. **P**: S's page-boundary count on the pagebreak stratum is below A's, **and** A − S > |A2 − A|, **and** the
   one-sided sign-test p < 0.10.
2. **G1**: S's control invention count − A's ≤ |A2 − A| on the same count (S is not worse than A by more than the
   A-vs-A2 difference).
3. **G2**: S's pooled omission count − A's ≤ |A2 − A| on the same count.

Anything else is **FAIL**, reported with which clause failed. If P passes and a guard fails, both numbers are
reported as "effect with a cost", but the verdict is still FAIL. The rule is computed by `seamDecision()` in the
harness and written to `report.json` `decision`.

Before any number is quoted, the five pages where S is judged worst (by fidelity) are read against their source.

## What this cannot say

- It measures an Opus judge's flags, not accuracy; the A2 arm and the repeats bound the noise, they do not
  validate the judge.
- Page-boundary invention and the meta payload are entangled (much boundary invention in v14 lived inside the
  meta); item 1 and item 1b are tested together and cannot be separated here.
- Flash-Lite only, two-page blocks only; production blocks are up to 8 pages, and the Flash (Tibetan) lane is not
  tested.
- With G1's tolerance at the A-vs-A2 difference, a small control stratum (25) can fail on one or two pages.
  That strictness is chosen now, knowingly.

## Amendments

1. **2026-10-03, after the draw, before submit (no arm output exists).** The draw pinned **125 units: pagebreak 100,
   control 25**, one per book, from 263 books visited (skipped: 93 English/Tibetan, 5 v14 books, 28 with no seeded
   lane page, 14 with no OCR on N+1, 8 with no stored translation on N−1, 88 closed-end pages after the control quota
   filled). Languages: Latin 97, Chinese 10, German 3, Hebrew 3, Arabic 3, Greek 2, and one each of Old Norse,
   Persian, Malay, Avestan, Italian, French and one book whose language field reads "e". The sample is mostly Latin
   because the lane's non-Tibetan, non-English frame is. Arms: v13 md5 `516510147237b6a79d9d3f6e797bba7f`, seam
   `9d9794376f5d09211ca95509e44bef57`. **375 Flash-Lite Batch requests; estimate $0.944** (the v14 run's same
   estimator over-read by ~35%: $1.05 estimated, $0.667 actual). Submit approved at $1.50, under the $3 cap.
2. **2026-10-03, after scoring (a correction of fact; the rule is unchanged).** The packet-17 judge wrote its 15
   verdicts in packet order but put two ids on the wrong lines: the verdict for item 13 (an Arabic charm page,
   seam arm) carried item 14's id and the reverse (item 14 is a Chinese page, also seam arm). Each verdict's text
   names the other item's source, so the swap is unambiguous. The ids were swapped back; the file as the judge wrote
   it is kept as `verdicts/packet-17.jsonl.as-written`. The decision is the same before and after the fix. Also: the
   packet-23 judge reports writing its file twice (the first write was partial); the file on disk is complete and
   valid. Three blocks parsed short and lost page N (v13a 1, seam 2); the scorer counts them as omissions, not
   invention, as in v14.

## Result (2026-10-03)

**Rule output: FAIL.** The primary clause fails, and both guards hold.
- **P:** page-boundary invention on the 100 page-break pages is **19 / 19 / 19 pages** (A / A2 / S). S vs A is 8 vs
  8 discordant, one-sided p 0.60. The noise pair is also 8 vs 8.
- **G1 holds:** control invention 4 / 5 / 3 pages.
- **G2 holds:** pooled omission 24 / 22 / 21 pages.
- **Secondary:** the continuity-meta payload goes 6 / 5 / **0** pages (0 vs 6, two-sided p 0.031). On this door the
  payload is rare, so there was little for item 1b to remove.

The five pages where S was judged worst:
- three are garbled or opaque scripts that v13 renders no better (Chinese commentary columns, a Jawi charm, an
  Arabic charm);
- two are Latin with one page-boundary import or a misreading, and both v13 draws have defects of the same kind on
  their own pages.

None shows a harm specific to the seam lines.

Write-up: `results/translation-seam-confirm-2026-10-03/README.md`; experiment
`experiments/2026-10-03-translation-seam-confirm-5305.md`.
