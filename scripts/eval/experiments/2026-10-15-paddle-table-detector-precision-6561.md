---
stage: ocr
measure: [judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 781
n_pages: 4445
verdict: "Holding recall on the 136 known invented pages at 136/136, a text rule cannot make paddleTableRisk much more precise. The only term that drops no risky page is a ditto term: a page flagged only by short 丨 ditto runs (< 5) on a non-table title. It takes the flagged set from 4,379 to 4,288 pages, of which 86 were prose Paddle read about right and 5 borderline. Precision moves 0.676 → 0.689 (not-false-alarm share) and 0.440 → 0.449 (non-prose share). The large false-alarm pool, 1,098 ditto-only 類書 pages, holds 3 of the 136 (each one extra 丨), so recall decides it. Prose is not a safe negative: 842 prose pages are Paddle text Opus removed ≥ 10 % of (Manchu pages read as Chinese). Shipped opt-in as T_V2; the default is unchanged (not wired)."
status: undecided
decision: null
superseded_by: null
issue: [6561, 6388, 6516]
---
## 2026-10-15 · Can paddleTableRisk flag fewer prose pages without missing an invented one? (#6561 item 3)

PRIOR ART: `2026-10-11-paddle-zh-table-detector-6388.md` (the rule, S4, and the 136 invented pages it is scored
on; its rule search ran inside the 495 strict-flagged pages, before anyone had labelled the 4,379 it flags) and the
Opus correction batch of #6561 (`scripts/eval/paddle-correct-6561/batch/`: a layout call and a corrected text for
every one of the 4,379). Code: `scripts/eval/paddle-table-precision-6561/eval.mjs`; numbers:
`results.json` next to it. Detector: `scripts/lib/paddle-table-detect.mjs`. It is **not wired anywhere new**.
Nothing was written to any database, and no model was called.

**Data (read only).**
- **Population.** The 4,379 flagged pages, dumped from staging `paddle_table_corrections_6561`. Each page has its
  Paddle text (the withhold snapshot the rule ran on), Opus's correction of that text, and Opus's layout call. The
  layout calls are table 986, mixed 769, diagram 153, prose 2,453, map 2, illustration 16. The checkpoint
  `out.jsonl` on cloudlayer was unreachable from main (the mesh key allows only fixed verbs, the xfer key only
  `/srv/xfer/in`), but the uploaded collection has the same rows.
  - Dump: `col.find({}, {projection: {provenance: 0, image_url: 0}})` written as JSONL.
- **The 136.** Job table-detect-6388 `w/labels.jsonl`, rows with `verdict: invented`, deduplicated by key. They are
  70 Opus-judged pages from the 495 strict-flagged pages plus 66 contained by eye. 70 of the 136 are in the 4,379,
  and their stored text equals the judged text on all 70. The other 66 were contained before the withhold, so
  they are scored on the text they were judged on.

**Labels.** Opus's layout call on its own is a poor negative. Opus also corrected each page, so the eval measures
**excess**: the share of Paddle's Han characters the correction did not keep, counted per character beyond its
count in the correction (the #6388 over-count, against Opus instead of Kanripo).
- **INV**: one of the 136. Must be flagged.
- **TAB**: layout table, diagram, map or illustration.
- **MIX**: layout mixed. Counted as risky: the median excess is 0.46, and Paddle's text there is mostly not on the
  page. The table-only proxy below counts MIX as negative instead.
- **FA**: the false alarm. Layout prose and excess < 5 %: prose that Paddle read about right.
- **BAD**: layout prose and excess ≥ 10 % (842 pages). These are mostly 御製增訂清文鑑 Manchu pages, where Paddle
  wrote Chinese like 東 ×8 and 雪雪雪雪雪 for Manchu script. They are prose, and they should stay flagged. **This is
  why "prose = false alarm" is wrong.**
- **UNC**: prose with excess between 5 and 10 %.

| | flagged | INV | TAB | MIX | BAD | UNC | FA | recall on 136 | non-prose share | INV+TAB share | not-FA share |
|---|---|---|---|---|---|---|---|---|---|---|---|
| #6516 rule (`T_V1`) | 4,379 | 70 | 1,107 | 754 | 842 | 188 | 1,418 | 136/136 (97–100 %) | 0.440 | 0.269 | 0.676 |
| **+ ditto term (`T_V2`, opt-in)** | **4,288** | 70 | 1,107 | 754 | 842 | 183 | 1,332 | **136/136** | 0.449 | 0.274 | 0.689 |

**Lane census.** Re-run over the #6388 dump of all 1,568,108 Paddle-written pages, the #6516 rule flags 4,379
(unchanged) and the ditto term (`T_V2`) flags 4,288. 1,228 of the 4,379 are ditto-only. The term can only remove flags,
never add them.

**The ditto term.** A page is no longer flagged if all four of these hold:
1. With every 丨 removed, it would not flag.
2. Its longest 丨 run (whitespace ignored, margin marks excluded) is under 5.
3. The title is not on the table-heavy list.
4. Distinct/total Han is ≥ 0.30.

The term drops 91 pages: 86 FA and 5 UNC, 0 risky. By work: 御定子史精華 44, 韻府羣玉 25, 佩文韻府 16, 分類字錦 4,
駢字類編 1, 韻府拾遺 1. On these 類書 and 韻書 pages, 丨 stands for the entry heading. On the spot-checked pages
Opus kept every 丨 that Paddle wrote.
- **Guards 3 and 4 are there because of a measured failure.** Without them the term dropped a 洪範皇極內篇 vol 2
  p.6 chart. That page writes counting-rod numerals 1–5 as runs of 丨, and its 丨-stripped text loses its gate.
  It is now a test fixture (`rod_chart`).
- **`ditto_only` is returned on every result.** 1,137 of the 4,288 still-flagged pages are ditto-only (runs ≥ 5):
  FA 1,098, UNC 30, BAD 6, INV 3. The 3 are 子史精華 vol 36 and vol 150 and 韻府羣玉 vol 11. Opus judged each one
  invented for one extra 丨 (runs 10, 5, 5).
  - Dropping every ditto-only page would give 3,151 pages at not-FA 0.926, with recall 133/136.
  - That is a recall decision, not a tuning one, so this PR does not take it. A caller can make it from
    `ditto_only` without changing the rule.

**No other term is free.** The eval searched gate run {5, 6, 8} × shape run {4, 5, 6} × distinct {0.30, 0.25, 0.20} ×
ditto run {0, 3, 4, 5, 6, 8, ∞}. Among configs that keep all 136:
- distinct 0.25 loses 19 risky pages to save 9 FA;
- shape run 5 loses 32 to save 62;
- gate run 8 (flagged 3,420) loses about 600 BAD and MIX pages, mostly the 清文鑑 garbage.

The top 12 configs are in `results.json` `grid_full_data`.

**Held out.** Books were split in half (seed 6561). Tuning picked the config with the fewest FA, subject to
keeping every invented page in its own half and ≥ 99.5 % of that half's risky pages.

| tuned on → reported on | config chosen | flagged before → after | recall on held-out invented | not-FA share before → after |
|---|---|---|---|---|
| A (99 invented) → B | ditto ∞ (drop every ditto-only page) | 2,058 → 1,435 | **34/37** | 0.648 → 0.909 |
| B (37 invented) → A | ditto 5 (`T_V2`) | 2,321 → 2,279 | 99/99 | 0.701 → 0.713 |

- **Over 200 more random splits:** the held-out half kept all its invented pages in 162. It missed 2 in 21 splits
  and 3 in 17.
- **Every miss is the same 3 ditto pages.** When their books land in the held-out half, the training half has no
  reason to keep ditto-only pages. So the threshold of 5 rests on those 3 pages alone (2 books of 子史精華, 1 of
  韻府羣玉). Treat it as fitted to them, not as validated.

**Caveats.**
- **Excess is not a by-eye verdict.** It counts characters Opus dropped, which includes text Opus chose not to
  transcribe. For example, Opus kept only the Chinese glosses on 清文鑑 pages. Opus also corrected Paddle's draft
  rather than reading blind, which pulls excess down (#6547 measured anchoring at 0/33). FA is "Paddle ≈ Opus's
  correction", not "verified clean".
- **The 3 invented ditto pages are ±1-mark miscounts.** They are invented by the #6388 definition, but they are not
  the loop failures the detector was built for.
- **Precision here is only among flagged pages.** Pages the rule never flags are unlabelled, and #6388 already
  records that recall outside the loop gate is unmeasured.

**Callers.** The export signature is unchanged. The result gains `ditto_only` and `features.ditto_run`, and a
`ditto_only:<n>` reason when it applies.
- **Not wired.** The default `T` is still the #6516 rule (`T_V1` is the same object), so
  `withhold-paddle-table-pages-6388.mjs`, `paddle-correct-6561/draw.mjs`, `stale-gate-6567/draw.mjs`,
  `paddle-table-pilot-6388/census.mjs` and the #6598 stale-retranslate script behave exactly as before. A caller opts
  in with `T_V2`, which unflags the 91 pages.
- The parity check in `eval.mjs` asserts that the eval's parameterised copy equals the shipped function under both
  `T_V1` and `T_V2`.

*Replicated?* No. The split and the 200 resamples are the only check.
