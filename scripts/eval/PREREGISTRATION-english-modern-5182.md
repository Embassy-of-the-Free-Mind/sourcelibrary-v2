# Preregistration — modern English OCR: lite vs flash on the #5216 reference pages (#5182)

PRIOR ART: `PREREGISTRATION-greek-ext-4925.md` and `PREREGISTRATION-chinese-ext-4925.md` (the
lite-vs-preview routing question with a lite-vs-lite floor, per language) — neither covers English;
`en-ocr-reference-5124.mjs` / PR #5216 built the English references and scored lite and the Archive
text only, with no flash arm and no noise floor. This adds exactly those two arms on its pages.

Committed 2026-09-28, **before any model call of this study**. Nothing below changes after the runs;
a deviation is reported as a deviation in the result, not edited in here.

## Question

Is `gemini-3.1-flash-lite` (production for English: `LATIN_SCRIPT_LANGUAGES` → lite) adequate on
modern English print, or should those pages go to `gemini-3-flash-preview`?

## Deviation from #5182's body, stated up front

#5182 planned to build its own references in two catalogue strata (`english-1800s`, `english-1900s`,
50 books each). PR #5216 (#5124, merged) has since built 122 English reference pages (en.wikisource
`Page:` of the same IA scan, and Project Gutenberg cut at its page markers; leaf checked; §4.1
records in `benchmark/refs/en-*.json`). This study reuses them and builds **no new references**.
So the strata are #5216's, decided by print date and by the page, not the catalogue:

| stratum | definition (#5216) | referenced books | grade (eval-design §3.3) |
|---|---|---|---|
| S1 | pre-1880 prose | 25 | exploratory |
| S2 | pre-1880 date-dense (reference body ≥ 6 numeric tokens) | 22 | exploratory |
| S3 | 1880–1930 prose | 41 | directional |
| S4 | 1880–1930 date-dense | 34 | directional |
| pre-1880 (S1+S2) | | 47 | directional |
| 1880–1930 (S3+S4) | | 75 | **decision** (≥ 50) |
| ALL | | 122 | decision |

There is no post-1930 stratum; the 1900+ question of #5182 is answered only for 1900–1930 print.
The pool is books en.wikisource / Gutenberg volunteers chose to transcribe — a selection toward
legible, canonical works — and every rate is quoted with that.

## Sample

The 122 pages of `benchmark/english-ia-5124.json` whose `leaf_check` is `ok` and which pass the
interior rule (the same set #5216's report scores): one page per book, the page image #5216 read
(rescued pages use the rescued image), the reference unchanged.

## Arms

All arms use the **live production OCR prompt** loaded by `lib/production-prompt.mjs`; the study
asserts its `prompt_hash` equals `360c5a076090bf07` (the hash on the #5216 lite rows) and stops if
it does not. Params identical across arms: `thinkingBudget 0`, temperature 0, `maxOutputTokens
8000`, realtime (not batch), no context. A refusal (RECITATION / PROHIBITED / SAFETY / BLOCKLIST)
is retried once, exactly as #5216 did for lite.

1. **A-vs-A noise floor (reported FIRST).** `gemini-3.1-flash-lite` a second time on 20 pages drawn
   from the 122 by Mulberry32 seeded **5182** (slugs sorted, Fisher–Yates, first 20). Rows carry
   `repeat_of: "en-ocr-ref-5124-2026-09"`. Floor = the paired lite(run 1) − lite(run 2) CER Δ:
   median and the median |Δ|, and the outcome flips (text ↔ refusal).
2. **Flash.** `gemini-3-flash-preview` on all 122 pages.
3. **Lite (existing).** The #5216 lite rows, `run_id en-ocr-ref-5124-2026-09`, not re-run.

Store rows (§5.1) go to `store/outputs/<model>/2026-09.jsonl` with `run_id`, `prompt_hash`,
`params`, `outcome`, `finish_reason`, `cost_usd`, `issue: 5182`. A run with zero `outcome: text`
rows is a failed run.

## Metric

`measure: accuracy`. The #5216 scorer **unchanged** — `en-ocr-ref-scorer@1`, normaliser
`en-ocr-ref-normalise@3` — applied identically to every engine: letters+digits CER after
trimming the engine's words that lie wholly before the first / after the last aligned word
(running head, page number). **`<note>` handling:** the normaliser moves `<note>` content to the
end of the page (where printed footnotes stand) rather than dropping it, for every engine; lite
files printed footnotes in `<note>`, so dropping it would charge lite for an omission it did not
make.

- **Failed read** = outcome `refusal` (after the one retry), `truncated`, `loop`, `empty` or `error`.
- **Catastrophic** = a failed read, OR a text read with CER > 0.5. Catastrophic rate = catastrophic
  pages / pages attempted. Reported alongside it, separately: the refusal rate, and CER > 0.5 among
  text reads, so a refusal-driven failure is visible as such.
- **Paired** comparison only on pages where both engines have a scorable text read (§7); the count
  excluded for a failed read on either side is printed next to every paired row.

## Paired statistics (per stratum, per period, pooled)

wins / losses / ties in books (tie: |ΔCER| < 0.2 pp, the #5216 tie band), median Δ CER
(lite − flash) with a 95% bootstrap CI over pages-as-books (10,000 resamples, seed 5182), sign-test
p on untied pairs (`lib/paired-stats.mjs` `binomTwoSided`), catastrophic and refusal rate per
engine, and the A-vs-A floor.

## Decision rule (fixed now)

For each stratum (and each period), **lite is adequate** if all three hold:

1. lite median CER ≤ 2 % (on its text reads), AND
2. lite catastrophic rate ≤ 2 % (definition above, refusals included), AND
3. paired median Δ CER (lite − flash) ≤ 1 pp, shown against the A-vs-A floor.

Otherwise #5182 **proposes** flash for that stratum; the result names which condition failed. It is
Derek's call; this PR changes no routing constant, allowlist or lane. A stratum below 30 referenced
books is quoted with its grade and cannot carry a proposal on its own.

## Spot-check (by eye)

The image is opened for the five worst pages per engine and for every page where the engines
disagree by > 5 pp CER. Each gets an error kind — misread / omission / invention / layout /
reference-defect — labelled *read from image*. A wrong reference is marked `leaf_check: shifted`
or `reference_error` in its `refs/en-*.json` and the tables re-scored without it, with the count.

## Budget

Expected ≈ $1.5 (122 flash pages ≈ $1.2; 20 lite pages ≈ $0.05). Hard stop at **$5** of Gemini
across this study; reaching it is BLOCKED, reported with what ran.
