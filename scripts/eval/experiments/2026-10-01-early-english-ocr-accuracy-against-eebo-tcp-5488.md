---
stage: ocr
measure: accuracy
languages: [en]
scripts: [Latn]
canons: []
n_books: 52
n_pages: 52
verdict: "English 1600-1699 vs same-edition EEBO-TCP: flash-lite median CER 0.053, 0/52 catastrophic; flash 0.038 but 5/52 RECITATION refusals."
status: informational
decision: null
superseded_by: null
issue: 5488
---
## 2026-10-01 — How accurate is production OCR on English print of the 1600s? 5.3% median CER against same-edition EEBO-TCP; flash reads better but refuses more (#5488)

PRIOR ART: 2026-09-28-is-flash-lite-adequate-on-modern-english-print-or-5216.md — modern (1800s+) English against Wikisource/Gutenberg, not early print; 2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md — same TCP references, but it tests a prompt line, not engine accuracy per cell.

**Question.** What is production OCR's accuracy on English 1600s print, measured against a human transcription of the same edition rather than against another engine? And does flash beat production flash-lite there?
**Design.** `measure: accuracy`. Stratum `eebo-tcp-5488`: 73 pages, one per book, from our EEBO-microfilm (`bim_`) and other scans. Each page's reference is the CC0 EEBO-TCP transcription of the same edition, matched by STC/Wing number (69 books) or title + author + year to one Wing number (4 books). The reference window was cut by `build-edition-refs.mjs` and leaf-checked by eye against the scan (`leaf_check.by: model-eye`). A page was kept only if the stored window was byte-identical to the checked one. 16 of 87 checked pages were refused: wrong window, edge, unusable image, or a table (`results/edition-refs/leaf-check-eebo-tcp-2026-10-01.json`). Engines: `gemini-3.1-flash-lite` and `gemini-3-flash-preview` via `benchmark-run-api.mjs` (generic transcription prompt, thinking 0, temperature 0, no recitation retry). Scored by `benchmark-score.mjs`. Cells come from `benchmark-dashboard-data.mjs`, catalogue year × language.
**Result.** **English · 1600–1699, decision grade (n = 52):** flash-lite median CER **0.053** [0.042, 0.058], catastrophic 0/52. Flash **0.038** [0.028, 0.047], catastrophic **5/52**, all of them RECITATION refusals. Paired, flash better 35 / worse 11 / tie 6, directional (46 untied pairs, 50 needed). Across the whole stratum, flash refused 7/73 pages and flash-lite 2/73. One page both engines refused (A45747 p94) is excluded by the scorer as "textless", although it is a leaf-checked text page. English 1500s (n = 5) and Latin 1600s (n = 26 pooled with earlier strata) remain exploratory. TCP keys at about 99.99%, but its `<gap>` spans count against the engines, so the CERs are slight overestimates.
**Implication.** On early English print, flash's accuracy edge is real but small (about 1.5 pp), and its refusal rate is several times higher without a retry tier. The production choice turns on the recitation retry (#5521, PR #5526), not on raw CER. The scorer's textless rule can hide a page that every engine refused. Count such pages as refusals, not blanks, before a refusal-sensitive comparison.
**Replicated?** No. One run per engine, temperature 0. **Artifact:** `benchmark/eebo-tcp-5488.json` (registry), `results/benchmark/eebo-tcp-5488-2026-10-01.json`, references `benchmark/refs/ed-*` (text public, CC0). Cost $0.20.
