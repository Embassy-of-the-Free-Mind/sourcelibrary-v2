## 2026-10-01 · Does one long-s line in the OCR prompt fix early-modern English print? Measured against EEBO-TCP same-edition references (#5488)
<!-- PRIOR ART: en-ocr-reference-5124 (#5124/#5182) scored lite vs flash on 1800s+ English, which has no long s; lesson "reference reads get refused on clean print" measured RECITATION on clean print but tried no prompt fix. -->

**Headline: yes, and the bigger effect is not long s. The line cuts RECITATION refusals by about 70% on both engines.** Flash went from 28 to 9 refusals of 142 pages; flash-lite (production's OCR engine under `OCR_LITE_ONLY`) went from 24 to 7. Accuracy does not get worse on the pages that return text. Long-s misreads fall (flash 52 → 18, lite 138 → 85).

**References.** 72 EEBO-TCP texts (CC0). Each is keyed from the same EEBO microfilm as one of our `bim_` IA scans, matched by the STC/Wing number the scan stores, so the edition and images are the same. The window is cut by `build-edition-refs.mjs` / `lib/edition-window.mjs`. TCP flattening matters: `<g ref="char:EOLhyphen"/>` joins words with no space, entities are decoded, and `〈…〉` gap notes are dropped. The first flattener got this wrong, and 482 phantom `amp` deletions plus split words made production look 1 pp worse.

**Production baseline, before any call** (494 pages, 72 books, production text as stored). Median windowed char accuracy is 95.9% once OCR-side artefacts are removed. Those artefacts are image-description attributes, `&nbsp;`, and `<lang>` text leaking into `normalizeForScript`, which is a scorer bug that needs its own fix. ſ read as f is the largest single class of misreading: 486 word substitutions, 12%. Live prompt v16 has no rule on long s.

**Design** (preregistered in `long-s-tcp-ab.mjs`). 142 pages, 2 per book, seed 5488. The TCP window is fixed per page. Temperature 0, thinking budget 0. Arms: A = live v16 on flash, A2 = A repeated (noise floor), B = v16 + `LONG_S_LINE` at the abbreviation anchor, LA/LB = A/B on flash-lite. Cost $1.78 actual, realtime.

| pair | refusals (first only / second only / both) | p | accuracy, text pages (better / worse / tied) | p | long-s misreads |
|---|---|---|---|---|---|
| A vs A2 (noise) | 6 / 4 / 22 | 0.75 | 17 / 18 / 75 | 1.0 | 51 → 50 |
| A vs B (flash) | **24 / 5** / 4 | **0.0006** | 35 / 30 / 44 | 0.62 | 52 → 18 |
| LA vs LB (lite) | **23 / 6** / 1 | **0.002** | 47 / 28 / 37 | 0.04 | 138 → 85 |
| A vs LA (engine) | 10 / 6 / 18 | 0.45 | 39 / 50 / 19 | 0.29 | 53 → 127 (pages 4 better / 34 worse, p < 0.001) |

**Readings.**
- Refusals: pages where only the baseline refused outnumber pages where only the long-s arm refused by 4–5 to 1, on both models, while the noise floor is even. The likely mechanism is that EEBO-TCP texts are in the training data and the recitation filter fires on output that matches them. Asking for the printed ſ makes the output differ from the normalised web copy. That is untested, and it is why the effect should be confined to pre-1800 print that actually has ſ.
- Long s: on flash nearly all errors sit on one page read entirely in "f mode" (36 → 0). Elsewhere it is about one per page, at noise level. Lite misreads long s 2–3× as often as flash on the same pages. The line removes about 40% of lite's misreads, but the per-page sign test is not significant (21 / 19).
- Accuracy: no harm on flash. A small gain on lite (p = 0.04, one test of several, so not a headline).

**Not measured.** How many production pages are recitation-refused: `ocr.recitation_count` is unindexed and a count timed out after 180 s. Whether the line changes anything on post-1800 print or non-English scripts. The generalisation beyond EEBO books, which are the most memorised English print there is.

**Proposed.** OCR prompt v17 = v16 + `LONG_S_LINE` (the text is in `long-s-tcp-ab.mjs`). This is a production prompt change and Derek's call. Before it ships: an A/B of one post-1800 English stratum and one non-English stratum (Latin 1500s), to show the line is inert there.
