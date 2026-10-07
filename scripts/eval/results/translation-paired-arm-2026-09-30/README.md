# Paired lite-vs-flash re-translation of the corpus-audit pages (#5274)

PRIOR ART: `results/translation-corpus-audit-2026-09-30/README.md` (the audit whose pages, rubric and judge this run reuses; its lite and flash arms were unpaired) and `results/translation-restraint-ab-2026-09-30/` (#5305, same pages and judge, arms differ by prompt). Neither compares the two models on the same pages.

**Question.** The audit found lite omits more (20% vs 9% of pages) and flash invents more (15% vs 8%), on different books and different prompt eras. On the same pages, with the same prompt and context, does the model change judged fidelity, omission or invention?

**Answer.** One difference holds up, and it is not the one that would argue for moving off lite.

| outcome (304 books) | lite | lite again | flash | flash − lite (95% interval) | lite again − lite (floor) | flash − lite again | rule |
|---|---:|---:|---:|---|---|---|---|
| fidelity ≥ 4 | 84.9% | 84.9% | 88.5% | +3.6 pp (0.0 to 7.6) | 0.0 pp (−3.3 to 3.3) | +3.6 pp (−0.3 to 7.6) | no measurable difference |
| omission | 11.8% | 11.8% | 8.6% | −3.3 pp (−7.2 to 0.7) | 0.0 pp (−3.6 to 4.0) | −3.3 pp (−6.9 to 0.3) | no measurable difference |
| invention | 8.2% | 9.2% | 15.8% | +7.6 pp (3.0 to 12.2) | +1.0 pp (−2.6 to 4.6) | +6.6 pp (1.6 to 11.5) | **difference** |

- **Flash invents more.** 39 pages flagged on flash and not on lite, 16 the other way (exact sign test p 0.003). The audit's invention gap is a model effect.
- **Lite's omission gap mostly goes away.** The audit's 20% vs 9% becomes 11.8% vs 8.6% on the same pages, and the interval includes zero.
- **Fidelity ≥ 4 is not shown to differ.** The point estimate favours flash by 3.6 pp, the interval touches zero, and the sign test is 23 vs 12 pages, p 0.09. Flash could be up to about 7.5 pp better, or no better.
- Per-page fidelity: flash higher on 63 pages, lite higher on 44, tied on 197 (p 0.08). Lite against itself: 38 / 37 / 229.

`measure: judged` (Claude Opus, source-grounded, no human reference). Not accuracy.

## What flash's extra invention is

Read from the judges' written defect details, not from page images. On the 39 pages where flash is flagged and lite is not there are 42 invention defects, 6 of them major. A keyword match on the details finds 23 that name a `<note>`, `<meta>` or summary block, and on 19 of the 39 pages every invention defect does. The usual case is an explanatory note asserting a fact the page does not carry (who a named person was, what an abbreviation stands for). A smaller class is text from the previous page at the head of the translation. The keyword count is approximate. For comparison, the 16 pages where lite is flagged and flash is not carry 18 defects, 2 major, 8 naming a block.

Flash's outputs are also longer (median 2,488 characters against 2,310).

## By script class (exploratory)

| | n books | fidelity ≥ 4: lite / lite again / flash | flash − lite | omission flash − lite | invention flash − lite |
|---|---:|---|---|---|---|
| Latin script | 192 | 93.8 / 95.8 / 95.8% | +2.1 pp (−1.0 to 5.2) | −0.5 pp (−5.2 to 4.2) | +7.3 pp (2.1 to 12.5) |
| non-Latin script | 112 | 69.6 / 66.1 / 75.9% | +6.3 pp (−1.8 to 15.2) | −8.0 pp (−15.2 to −1.8) | +8.0 pp (−0.9 to 17.9) |

No cell passes the three-part rule. On non-Latin script every line leans toward flash (per-page fidelity 29 wins to 15, p 0.049), but the lite-vs-lite floor there is wide (omission −4.5 pp between two lite runs) and the replication against the second lite run does not hold for omission. This is the stratum the routing question is about; the interval allows anything from no difference to about 15 pp in flash's favour, and 112 books cannot narrow it.

Two per-language readings worth knowing (full table in `report.json`):
- **Latin (60 books):** flash − lite on fidelity ≥ 4 is +10.0 pp, and so is lite again − lite. One lite draw differs from another by as much as flash does.
- **Tibetan (11 books):** flash is lower (54.5% against 72.7% and 63.6%), the one language production routes to flash. Eleven books, intervals include zero.

## Instruments

- **Judge noise (30 repeat controls, same text under a second id in another packet):** same fidelity 27/30, within one point 29/30, fidelity ≥ 4 agrees 27/30, omission 29/30, invention 25/30.
- **A-vs-A floor:** the "lite again − lite" column. 27 of the 304 pages have byte-identical text in the two lite runs.
- **Blinding:** 942 items under opaque ids in 61 packets of 15–16; a page's three arms never share a packet. 61 Opus judges, one per packet.
- **Failed reads (the pre-registered sensitivity row):** one page is refused by both models in all three arms. Scoring a failed read as fidelity below 4 over all 305 books gives 84.6 / 84.6 / 88.2%, flash − lite +3.6 pp (−0.3 to 7.2). Nothing changes.
- **Packet 53:** its judge wrote the verdict file twice (the first write skipped an item and carried a made-up id). The second write is complete and in order, and the judge opened only the rubric, its packet and its verdict file.

## Correction made after the first score was read

The pre-registered statistic was the bootstrap in `scripts/eval/lib/paired-stats.mjs`. Its random generator is not uniform (100,000 draws into 304 bins: chi-square 3,105 against about 303 expected). With it, fidelity ≥ 4 read +3.6 pp (1.0 to 6.9) and the rule printed a difference. The analytic paired interval is −0.2 to 7.4 and a bootstrap on a sound generator gives 0.0 to 7.6, so the rule now reads no measurable difference. The harness carries its own bootstrap; `report.json` keeps the library interval as `ci_library` and the analytic one as `ci_analytic` beside each `ci`. Invention passes under all three. This correction was made after seeing the result and moves the conclusion away from the stronger claim.

## Method

- **Sample.** The audit's 311 `main` pages minus the 6 Internet Archive pages whose OCR text belongs to a neighbouring leaf (#5311): 305 books, one page each, 15 languages. One page is blocked as prohibited content by both models in every arm, leaving 304.
- **Arms.** `gemini-3.1-flash-lite` twice and `gemini-3-flash-preview` once. One prompt per page, byte-identical across arms: `buildTranslationPrompt` with the default `translation` v13 and `english_modernization` v2 prompts, the `books` row, `PAGE_BREAK_SCOPED`, neighbouring OCR, and the previous page's served translation as context. `thinkingBudget: 0`, production's output cap, default temperature.
- **Not production's shape:** single-page prompts; the realtime worker translates 8-page blocks.
- **Run.** Batch API from Hetzner, $1.11. The first flash job returned all 305 requests cancelled at $0 and was resubmitted once.
- **Pre-registration:** `scripts/eval/PREREGISTRATION-translation-paired-arm.md`, committed before any output was read.

## Files

`sample.jsonl` (pages, source text, prompt hash per page) · `arms.json` (prompts, settings, estimate) · `arms.jsonl` (every output, append-only; the cancelled flash rows are kept) · `batch.json` (jobs, tokens, cost) · `packet-key.json` · `verdicts/` (61 files) · `report.json`. `packets/` and `requests-*.jsonl` are rebuilt by the harness and not committed.
