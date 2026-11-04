---
stage: ocr
measure: accuracy
languages: [la, de, fr, en, grc, lzh, hy]
scripts: [Latn, Grek, Hani, Armn]
canons: []
n_books: null
n_pages: 981
verdict: "Chained routes (a draft engine's read, corrected against the image by Opus or by Gemini 3.8 Flash low) are now points on the OCR Pareto charts, scored on each panel's own pages. On the Decide-grade panels, Latin print: Flash-Lite → 3.8 Flash +2.1 points over Flash-Lite (95% interval +0.3 to +5.5, better; 0 of 44 pages worse) and Flash-Lite → Opus +1.9 (−0.1 to +5.2; 1 page worse); German, French and other Latin-script: both +0.3 (better). Greek editions panel: Gemini 3 Flash → Opus +1.0 (+0.7 to +1.4), directional. Chinese manuscript: both corrections score lower (−9.6 and −4.5), because the CJK scorer counts the text inside the correctors' metadata tags; with those tags removed as for Latin-script pages, Opus 80.2% and 3.8 Flash 79.1% against Paddle's 79.0% (491 pages; a check, not plotted)."
status: informational
decision: "Charts only: src/data/ocr-pareto.json and /quality/pareto. No routing-table edits, no writes to pages or books (#6740)"
superseded_by: null
issue: [6740, 5924, 6560, 6561, 7275, 7389]
---
## 2026-10-26 · Chained routes (draft → corrector) on the OCR Pareto charts, re-run on each panel's own pages (#6740)

PRIOR ART: the correction write-ups (#5924's Latin Opus and Flash corrections, PR #7258/#7269; #6560 Tibetan; #6561
Chinese; PR #7275, Flash-Lite as a corrector fails) and the router tests (PR #7434) measured corrections on other pages,
judged by Opus against the image. Their numbers are not on these charts. Here every correction was run again on the pages
of the panel it is drawn on, from that panel's own read by the draft engine, and scored by the panel's scorer against the
panel's reference.

**Question.** On the pages each OCR Pareto chart already measures, what does a correction step buy over its draft, and
what does it cost, beside every single-engine route?

**Method.**
- **Drafts:** each chart's engine in use (Flash-Lite for Latin, English, other Latin-script and Armenian; Gemini 3 Flash
  for Greek and Chinese print; PaddleOCR-VL 1.6 for Chinese manuscript), plus Paddle on Chinese print. 981 drafts on 7
  charts. The benchmark reads came from the scoring box (export job `pareto-drafts-6740`,
  `results/drafts.jsonl.gz`). 83 Paddle reads were not kept there. For 76 of them, the Paddle production lane's stored
  read was used (same model, a later run; `results/stored-drafts.json`). The chain is compared with that draft on those
  pages. 7 pages have no Paddle read on record, and their chains count as not read.
- **Correctors:**
  - Claude Opus 5.5 through `claude -p` (sealed folder with the image and the draft; the transcript must show both
    opened). Prompt: the live OCR prompt (Standard OCR v19.1) plus `correct.mjs` `correctInstruction(1)`, the
    production correction lane's instruction. Sent hash `0e94c1082ca6e456`.
  - Gemini 3.8 Flash low through `agy` (plan mode, tool gate, markers). Prompt: the #5924 one-page template that
    `fc-prompt.mjs` builds from the same live prompt, with its hash check passing. Template hash `0601ef30e816f7a7`.
  - One page a call (each panel page is a different work).
  - Flash-Lite is not a corrector (#7275). No Argon or Pro.
- **Images:** re-fetched and sealed as the benchmark sealed them, then checked against the scoring box's sha256 for
  each page.
  - 236 match byte for byte.
  - 650 differ in bytes at the same pixel size.
  - Where only the scale differed, the image was resized to the bench's size.
  - 4 differ by a crop or a pixel. 2 could not be fetched (HTTP 403); their chains count as not read.
- **Scoring:** `benchmark-score.mjs`, then the #6523 extractor for Latin-script strata. The reference tiers use the
  digits-dropped rule their dots were scored with (`rescore-extract.mjs` `V3_DIGITS`). The Chinese cohort's bundled
  references were unpacked into scratch.
- **Control:** every draft is re-scored and must reproduce its dot's committed CER.
  - 881 of 887 do. 8 have no image or draft here.
  - The 6 that do not (2 English pages whose dot's read is no longer on the scoring box, 4 German Wikisource pages
    whose reference changed since) are listed in `scored-chains.json`. Their chains count as not read there.
- **Failure rule** (#6523):
  - A `CONTAIN` answer (the corrector judged the draft not to be this page's text) is counted as not read, kind
    refusal.
  - Where the draft itself was not read (copy filter), the chain was not read either, for the same reason.
- **Price:**
  - The draft's price, plus the correction at the API price for the same request, $0 billed on the subscription.
  - The request is priced on the #6293 x-axis formula, extended by the draft: 3,736 input tokens, plus the draft at the
    corrector's own tokens per character, plus the reply tokens the CLI reported.
  - Gemini at its Batch price, as the CLI read points are. Opus at its realtime list price, as the Claude API points are.
  - Quota share in the detail: Opus about 0.0124 account-week points a page at one page a call (the pilot's meter, an
    upper bound); agy 4.36e-6 of the month's calls a call (`route-costs.json`).
  - Draft prices: Flash-Lite and Gemini 3 Flash at their metered Batch prices; Paddle at its GPU rental.
- **Pages made worse:** pages where the chain's CER is more than 1 point above its draft's (the charts' margin).

**Results** (primary panels; accuracy = 1 − mean CER over the pages read; difference against the engine in use, paired,
work-clustered 95% interval):

| chart (grade, pages) | route | accuracy | vs in use | worse / better of n | per 1,000 pages |
|---|---|---|---|---|---|
| Latin print (Decide, 44) | Flash-Lite (in use) | 96.2% | | | $1.28 |
| | → Gemini 3.8 Flash | 98.4% | +2.1 (+0.3 to +5.5), better | 0 / 7 of 44 | $4.62 |
| | → Claude Opus 5.5 | 98.1% | +1.9 (−0.1 to +5.2) | 1 / 6 of 44 | $51.28 |
| German, French, other Latin-script (Decide, 22) | Flash-Lite (in use) | 99.1% | | | $1.28 |
| | → Gemini 3.8 Flash | 99.4% | +0.3 (+0.1 to +0.5), better | 0 / 2 of 19 | $4.39 |
| | → Claude Opus 5.5 | 99.5% | +0.3 (+0.2 to +0.5), better | 0 / 1 of 19 | $51.72 |
| Greek, Wikisource (Decide, 24) | Gemini 3 Flash (in use) | 90.8% | | | $2.71 |
| | → Claude Opus 5.5 | 94.7% | +3.9 (−1.0 to +13.0) | 2 / 1 of 23 | $90.30 |
| | → Gemini 3.8 Flash | 94.5% | −0.4 (−1.2 to 0.0) | 2 / 0 of 22 | $7.30 |
| Chinese manuscript (Directional, 498) | Paddle (in use) | 79.0% | | | $1.04 |
| | → Gemini 3.8 Flash | 74.4% | −4.5 (−5.4 to −3.8) | 341 / 67 of 491 | $3.29 |
| | → Claude Opus 5.5 | 69.4% | −9.6 (−10.5 to −8.7) | 411 / 40 of 491 | $40.40 |

In the Greek row, the corrections' accuracy is over the pages they read, and the in-use comparison is over the pages
both read. Gemini 3 Flash did not read 2 of the 24 pages.

The not-fit panels (Early English, Chinese print, Armenian) carry their chains too, without verdicts. Early English:
Flash-Lite → Opus +0.8, → 3.8 Flash +0.5. Chinese print: all four chains lower, for the reason below. Armenian: 5
pages.

**Chinese: the scorer, not the correction.** Every corrected page is in the library's tagged format, because the live
prompt asks for it: `<vocab>` (a list of key terms), `<language>`, `<meta>`, a `<header>` running title. On a
Latin-script page, the scorer drops those tags with their text (`normAlpha`). On a CJK page it drops the tags and
keeps the text (`normCJK`), so the term list and the edition's running title (欽定四庫全書) are scored as characters
the page does not print. No other engine on these panels writes the format: the CLI arms' and the API arms' Chinese
outputs hold no `<vocab>`. With `normAlpha`'s tag list removed first, on the 491 manuscript pages all three read:
- Paddle 79.0%;
- Paddle → Claude Opus 5.5 80.2%;
- Paddle → Gemini 3.8 Flash 79.1%.

This check is in `results/cjk-tags-sensitivity.json` and is shown as a note under the chart, never plotted. The chart
keeps the panel's scorer unchanged, as this run's rule requires.

**What this does not measure.**
- The correctors' changes are scored against typed editions. A correction that fixes the page toward the image where the
  edition differs (a variant glyph, a name) can read as an error. #7434 found the opposite failure as well: a name kept
  wrong by every route.
- Time: no draft engine here was timed (they are API or GPU reads), so chains are not on the time view. Their correctors'
  medians were 16.5 s a page (Opus) and 9.7 s (agy).

**Spend.**
- Claude: 962 Opus calls on milolomas200921@'s idle quota (`JOB_CLAUDE_HOME`). The account went from 12% to 19% of its
  week during the run, which it shared with main's jobs, so at most 7%.
- agy: about 990 Gemini 3.8 Flash low calls (981 pages, 9 retries on a no-answer). The agy meter is not readable from
  gex45; no quota reply came back.
- $0 billed.

**Files.** `scripts/eval/ocr-pareto-chains-6740/`:
- `run-chains.mjs`, stages `prep | correct | collect | score | cjk-tags`;
- `results/` holds the drafts, the stored-draft record, every corrector answer (`outputs-*.jsonl.gz`), its meter row
  (`meter-*.jsonl`: prompt id and hash, image and draft sha256, tokens, seconds), the scored rows with the control, and
  the CJK sensitivity.

`build-ocr-pareto.mjs` reads `scored-chains.json`. A chain joins a panel that holds its draft and has a row for every page
of it. It is never picked by the greedy engine selection, so no existing panel's pages, engines, accuracies or paired
differences changed (checked against main). What changed:
- The frontiers are recomputed with the chains. The Greek Wikisource panel had two priced engines and so drew no
  frontier; with the chains it has four and draws one.
- Three verdict sentences name chains:
  - other Latin-script: "Also better" lists both chains;
  - Latin: one more "also better";
  - Greek editions: the evidence points toward Gemini 3 Flash → Claude Opus 5.5.
- Each panel's date is 2026-10-26.
