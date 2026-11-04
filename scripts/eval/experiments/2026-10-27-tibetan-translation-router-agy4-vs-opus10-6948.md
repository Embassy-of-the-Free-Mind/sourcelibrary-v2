---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: []
n_books: 30
n_pages: 30
verdict: "On corrected Kangyur text, Opus claude -p at 10 pages a call is accepted on 27/30 (1 wrong text) against agy Flash-low at 4 a call 22/30 (4 wrong text; it finishes a leaf's broken sentence from the next page on 6/30); both judged blind against the image, planted reversals 15/15 each."
status: informational
decision: "Router table cell tibetan-tr added (rules.json): HOLD -> opus-cli; agy-flash-low@4 is outside the wrong-text gate"
superseded_by: null
issue: [6948, 6740]
---
## 2026-10-27 · Tibetan translation router test: agy Flash-low, 4 pages a call, against Opus, 10 a call (#6948, #6740)

PRIOR ART: `scripts/eval/route-judge-6740/judge.mjs` (the router tests, judge prompt and controls, reused); `scripts/eval/agy-per-call-7503/` (PR #7518: agy 1/2/4 pages a call for translation, not Tibetan and not against Opus).

**Decision it changes:** which route translates corrected Tibetan Kangyur text. This adds the router table's
`tibetan-tr` cell (`scripts/eval/estimator/router-table/rules.json`). Derek asked for it in an inbox note to job
`tib-corr-profiles-6560`, 2026-10-27 10:33Z.

**Result:** Opus at 10 pages a call **27/30** accepted, 1/30 wrong text. agy Flash-low at 4 a call **22/30**, 4/30 wrong
text. On the same 30 pages, Opus alone was accepted on 7 and agy alone on 2. The table's decision is **HOLD → opus-cli**.
- No route clears the hold bar: P(acceptance ≥ 0.8) ≥ 0.9.
- agy fails the wrong-text gate.

Nothing was written. The translations are of corrections that no page holds. `claude-translate.mjs --ocr-file` puts
the override's hash in the meta, so `cli-translate.mjs apply` refuses them.

## Set

- **Source text.** The note said to use the winning arm of the profile experiment
  (`2026-10-27-tibetan-corrector-profiles-diff-qa-6560.md`). No arm passed, so this uses **arm A**: Flash-low with
  today's prompt, unguarded, and never written.
- **Pages.** 30 pages, one per book (`translation-router/sample.json`).
  - 26 come from the profile experiment's 72-page diagnostic set (seeded, one per book). A page arm A changed by
    more than 25% was left out.
  - 4 are anchor folios of the 30-folio set where arm A caught every planted syllable.
  - The set was chosen from pages that earlier audits judged worse, so it is not the lane's frame.
- **Blocks.** Each test page is the first page of a block in its own book:
  - **agy** (`claude-translate.mjs --cli=agy --per-call=4`, #7503): the test page and the next 3 pages.
  - **Opus** (`claude-translate.mjs --per-call=10`): the test page and the next 9 pages, cut where the block reaches
    20K characters.
  - Only the test page carries the corrected text. Its neighbours carry their stored OCR (Yigdzin, or Flash where a
    volume was written).
  - The production prompt, seed and guards are unchanged. `CANDIDATE_READS=off`, `--fresh`.

## Judge

- **Prompt and setup.** One sealed Opus call per output (`replicate-6547/run-claude-arm.py`), route-judge
  `judgePrompt` (translation). The judge sees the page image and the corrected transcription, and is blind to route.
- **Planted reversals.** One per page, in alternating routes (`tengyur-characterize/plants.mjs plantReversal`).
- **Wrong-page controls.** 2 per route.
- **Page-break drift.** `block-drift.mjs` cannot see a caseless script, so drift is the judge's T4 (block shift) and
  T5 (leak / lookahead) defects.

## Results

| route | accepted | wrong text | fidelity (mean) | page-break drift (T4/T5) | planted reversals caught | controls | calls |
|---|---|---|---|---|---|---|---|
| **Opus `claude -p`, 10 a call** | **27/30** | **1/30** (O4: a Yigdzin duplicate line kept, with "again" added) | 4.3 | 2/30 | 15/15 | pass | 57 for 299 pages (3 refused for tags that do not match their pages, then re-read) |
| agy Gemini 3.8 Flash-low, 4 a call | 22/30 | 4/30 (T5 ×3, T9) | 3.9 | **6/30** | 15/15 | pass | 32 for 120 pages, 0 refused |

- **Paired, on the same 30 pages:** accepted only for Opus 7, only for agy 2. Mean fidelity agy − Opus is −0.4.
- **agy's commonest failure is lookahead (T5).** Where a leaf breaks off mid-word or mid-sentence, agy finishes the
  sentence from the next page in its block:
  - p.158 of `69e7ab06…`;
  - p.401 of `69e7ab28…`;
  - p.432 of `69e7ab34…`: three sentences from the next page.

  This is the page-break drift that block-drift cannot detect in Tibetan. Opus did it on 2 pages, once only in its
  summary.
- **agy has more O6** (a meaning-changing misreading), on 15/30 pages against Opus's 6/30. Most of these are tagged
  misleading, not wrong text.

**Cost.**
- Opus: 57 calls, 1.75 hours of call time, $22.35 at list prices for 299 pages (the CLI's figure). Nothing was billed:
  it ran on the subscription. The router table's size model puts it at about 0.00105 weekly points a page.
- agy: 32 calls for 120 pages, 0.27 calls a page.

## Router table

`rules.json` now has:
- a stage `agy-text@4`;
- a cell `tibetan-tr` with routes `opus-cli` (current) and `agy-flash-low@4`. The evidence is
  `results/tibetan-correct-6560/profiles-diffqa-6560/translation-router/score.json`.

`build.py --name 2026-10-27-tibetan-translation` gives:
- `opus-cli`: 0.87 [0.77, 0.95];
- `agy-flash-low@4`: 0.72 [0.58, 0.84], 4/30 wrong text, outside the gate;
- decision: **HOLD → opus-cli**.

The cell's `pages_waiting` is not measured here (0).
