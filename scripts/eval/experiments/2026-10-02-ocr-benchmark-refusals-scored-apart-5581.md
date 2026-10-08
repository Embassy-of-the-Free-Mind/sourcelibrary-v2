## 2026-10-02 · OCR benchmark: what changes in the headline numbers when a refused page is counted as a refusal, not a blank read? (#5581)
<!-- PRIOR ART: en-ocr-reference-5124.mjs:694 tests finishReason inline for one runner's label; ocr-error-classes.py (#5572) calls any output under 30 folded characters a "refusal" (wrong on the Greek strata and on genuinely empty Japanese STOP outputs). Neither is shared by benchmark-score.mjs and benchmark-dashboard-data.mjs, so this adds scripts/eval/lib/refusals.mjs. -->

**Question.** `benchmark-score.mjs` scored a page Gemini declined (finishReason RECITATION and similar) the same as a blank page or a misread. Does keeping refusals apart change any headline CER or paired verdict?

**Design.** No new OCR and $0. A refusal is read from the run's own record: `<engine>/_meter.jsonl` from `benchmark-run-api.mjs`, last row per slug, a refusal finishReason, and an empty output. Where an API engine has no meter, it is *inferred* from a zero-byte output on a page with ≥ 200 reference characters, and labelled as inferred. Short outputs are never inferred to be refusals. `benchmark-score.mjs --refusals-only` read every stratum on Hetzner (`/root/ocr-bench/images/*/out/*`) into `results/benchmark/refusals/refusals-2026-10-02.json`. Re-scoring was deliberately avoided, because Hetzner holds only some engines' outputs and a full re-score would silently drop the others from the committed results. `benchmark-dashboard-data.mjs` reads that record (or a result file's own `refused`) and rebuilds `src/data/ocr-benchmark-evidence.json`. CER is reported twice: with a refusal at 1.0 (sealed strata) or unplaced (reference tiers), as before, and over answered pages only. The paired sign test now runs only on pages both engines answered, and it reports how many pages refusals removed.

**Result.** 26 meter-recorded refusals across 10 strata (25 RECITATION, 1 PROHIBITED_CONTENT), plus 7 inferred on EEBO-TCP, whose outputs are not on Hetzner. 0 for every local engine.

| stratum | engine | refused | median CER, refusal = 1.0 (n) | median CER, answered (n) | paired vs production: n (refusals excluded) |
|---|---|---:|---|---|---|
| eebo-tcp-5488 | gemini-3-flash-preview | 6 (inferred) | 0.045 (72) | 0.042 (66) | 65 (7) — was 72 |
| eebo-tcp-5488 | gemini-3.1-flash-lite | 1 (inferred) | 0.057 (72) | 0.056 (71) | production |
| ref-ws | gemini-3-flash-preview | 5 | 0.004 (108) | 0.004 (108) | 102 (0) |
| ref-ws | gemini-3.1-flash-lite | 5 | 0.007 (102) | 0.007 (102) | production |
| ref-pinned | gemini-3-flash-preview | 2 | 0.007 (47) | 0.007 (47) | 46 (0) |
| armenian | flash / flash-lite | 1 / 2 | proxy only | proxy only | — |
| latin-1700s | flash / flash-lite | 1 / 1 | proxy only | proxy only | — |
| japanese-ext | gemini-3.1-flash-lite | 2 | proxy only | proxy only | — |
| chinese-cohort-5547 | gemini-3.1-flash-lite | 1 in the result file (2 in the meter) | 0.262 (441) | 0.261 (440) | production |
| german-fraktur, japanese, longs-en-fr, syriac-gt | flash-lite (and flash on fraktur) | 1 each | not in the dashboard's latest result file | — | — |

- **EEBO-TCP is the only headline that moves.** All 6 of flash's catastrophic pages (CER > 0.5) are refusals. On answered pages flash has 0 catastrophic pages, and its mean CER falls from 0.133 to 0.054. Lite's mean falls from 0.079 to 0.066. The paired verdict holds and gets stronger: flash beats lite 51/8/6 (n = 65, p < 0.001, median Δ 0.005 [0.002, 0.021]), against 52/14/6 (n = 72) before. Six of the old 14 losses were refusals scored as misreads.
- **Medians barely move** (≤ 0.003), because refusals are a small minority of each stratum. Means and catastrophic rates are where refusals did the damage.
- **Reference tiers (ref-ws, ref-pinned): no change in CER.** A refused page was already unaligned, so it counted as coverage rather than CER. What changes is the reason, which is now stated: the 5 "unplaced" flash pages on ref-ws are RECITATION on canonical texts (Tacitus' *Agricola*, Apollonius' *Argonautica*, the *Corpus iuris civilis*), not alignment failures.

**What this does not cover.** EEBO's 7 are inferred, because its outputs and meter are not on Hetzner. A re-score on the machine that holds them would make them finishReason-sourced. Strata where a refusing engine is scored by proxy only get a refusal count but no CER effect.

*Grade.* EEBO paired comparison: decision-grade (59 untied pairs). Everything else is a count. *Decision.* None. This is a scoring fix. The fix for refusals themselves is the recitation retry (#5521), and these counts are its baseline. *Replicated?* No; the record is deterministic given the meters. *Cost* $0. *Artifacts:* `results/benchmark/refusals/refusals-2026-10-02.json`, `src/data/ocr-benchmark-evidence.json`, `scripts/eval/lib/refusals.mjs`, `tests/unit/benchmark-refusals.test.ts`.
