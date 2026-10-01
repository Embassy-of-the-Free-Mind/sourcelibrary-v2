## 2026-09-28 — Is flash-lite adequate on modern English print, or should it go to flash-preview? Paired on the #5216 references (#5182)

- **Question.** English (`LATIN_SCRIPT_LANGUAGES` → lite) was never compared with flash-preview against a
  truth. Does flash-preview read modern English print materially better than lite?
- **Design.** `measure: accuracy`. Preregistered before any call (`PREREGISTRATION-english-modern-5182.md`).
  The 122 referenced pages of #5216 (one page per book; strata S1–S4 by print date × date-dense page), the
  same page images (byte count asserted) and the same production prompt v16 (`prompt_hash 360c5a076090bf07`
  asserted), thinking 0, temperature 0, realtime, one retry on refusal. Arms: flash-preview on all 122; lite a
  second time on 20 pages (seed 5182) as the A-vs-A floor; lite's #5216 read reused. Scored with
  `en-ocr-ref-scorer@1` unchanged; `<note>` content moved to the page end for both engines. Catastrophic =
  refusal/truncated/empty/error after retry, or CER > 50%. By eye: the worst five per engine, two rounds
  (11 pages opened); **8 references were wrong** (Wikisource template/markup leaks, Gutenberg plate captions,
  renumbered or chapter-end footnotes, dropped long s, a dropped verse block) and were marked
  `reference_error` in `benchmark/refs/` and dropped, leaving **114 books**.
- **Result.**
  - **Floor first:** lite vs lite on 20 pages — the 16 pairs that both read text are **byte-identical in
    CER (Δ 0.00 pp on all 16)**, but **3 of 20 flip between text and refusal** (refusals 1 → 4). Text at
    temperature 0 is stable; RECITATION refusal is not.
  - **Paired, 114 books (decision grade), 92 pairs:** flash better 14, lite better 3, tie 75 (±0.2 pp);
    sign-test p = 0.013; **median Δ 0.00 pp [0.00, 0.00]**. 1880–1930 (70 books, decision): 7 / 3 / 46,
    p = 0.34, median Δ 0.00. pre-1880 (44, directional): 7 / 0 / 29, p = 0.016, median Δ 0.00. Flash wins
    more often than lite, by amounts too small to move the median.
  - **Each engine:** median CER lite 0.20%, flash 0.14%; pooled CER lite 1.46% vs flash 0.63%. The pooled gap
    is mostly **one page**: a two-column index that lite laid out as a table, interleaving the columns
    (62% CER, words right, order wrong, *read from image*). Flash has no read of that page (the one
    rate-limited error), so it is not in the paired set.
  - **Refusals are the failure, and flash has them too:** catastrophic lite **14.9%** (16 refusals + 1 layout
    page), flash **17.5%** (19 refusals + 1 error). **14 of lite's 16 refusals are also flash
    refusals.** The pool is Gutenberg/Wikisource books, a selection toward text the models have memorised.
  - **Rule (preregistered):** lite passes (1) median CER ≤ 2% and (3) median Δ ≤ 1 pp in every cell, and
    fails (2) catastrophic ≤ 2% in every cell, because of refusals. By the letter, the rule **proposes flash**
    for 1880–1930, pre-1880 and ALL. **Flash fails the same condition by as much or more**, so switching the
    model does not fix what the rule caught. The proposal on #5182: **keep lite**; treat RECITATION refusal as
    its own lane (a fallback read, not a different model). Derek's call; no routing change in this PR.
  - By eye, beyond the reference defects: both engines silently **modernise the print** on a 1651 page
    ("Vtter" → "Utter"; the printer's "burnetb" → "burneth"), and marginal notes land at different points in
    the text flow than the reference puts them. Neither engine does better on these.
- **Replicated?** No. The floor shows text reads are deterministic at temperature 0, but refusals are not.
- **Grade.** 114 books pooled and 70 for 1880–1930 = decision; pre-1880 44 = directional; S1/S2/S4 < 30 =
  exploratory. Pool = books Wikisource/Gutenberg volunteers chose (legible, canonical, *memorised*): the
  refusal rate here overstates the corpus rate, and the CERs understate it. No post-1930 print.
- **Cost / run_id.** `en-flash-5182-2026-09` $0.4298 (170 rows: retries and 503/429 errors included);
  `en-lite-repeat-5182-2026-09` $0.0357. Total **$0.47** of a $5 cap. One flash page
  (`en-6aa1d4-ws78`) stayed `error` (repeated 429 on one key); it is counted as a failed read.
- **Dashboard.** `benchmark-dashboard-data.mjs` does not read the store yet (#5121 open); not regenerated.
- **Artifact.** `results/en-ocr-ref-5124/flash-arm-2026-09-28.{md,json}`, `flash-arm-byeye.jsonl`,
  `store/outputs/gemini-3-flash-preview/2026-09.jsonl`, `store/scores/en-ocr-ref-scorer@1/2026-09.jsonl`;
  `en-ocr-reference-5124.mjs --stage=ocr --arm=flash|lite-repeat`, `--stage=flash-report`.
