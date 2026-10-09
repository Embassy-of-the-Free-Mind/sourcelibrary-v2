<!-- PRIOR ART: 2026-10-03-translation-vs-reference-harness-smoke-5695.md (the harness's instrument check, 6 Pali pages) and the #5274 paired lite-vs-flash arm (reference-free judge, 304 pages). This is the first run of the harness on German, French, Italian, Dutch and Spanish against published human English. -->
## 2026-10-03 · Against published human translations, how faithful is the served English for German, French, Italian, Dutch and Spanish, and which lever helps? (#5695 T3)

- **Question.** For vernacular early-modern and 19th-century print, how does the English readers see compare with a published human translation of the same page; what causes the low pages; does Flash, thinking, or neighbour-page context change it?
- **Design.**
  - 59 pages from 59 books (German 22, French 14, Italian 10, Dutch 7, Spanish 6), each span-aligned to a **public-domain** English translation (1560–1922). Pages were pre-drawn with a fixed seed; cutters aligned on the source OCR and never saw our English. No canonical text in the set.
  - Harness `scripts/eval/translation-vs-reference/` (PR #5702): two blind Opus judges, gate first. `measure`: judged against a human reference.
  - Arms on the same pages, prompt v13: served; Lite twice (noise floor); Flash thinking off; Flash thinking budget 8192; Lite without neighbour context; Opus on 20 pages (ceiling); Lite and Flash on a by-eye corrected transcription (6 pages).
  - Page images opened for the 10 lowest pages and 10 random others. A separate one-judge pass scored six dimensions for ours and for the reference.
- **Controls.** Gate passed for both judges: wrong page 3/3, planted change 3/3 caught and located, duplicates 3/3 tied. Exact agreement 84.8% of 374 cells, within one point 100%, weighted κ 0.81.
- **Results.**
  - Served: fidelity **4.39 (4.22–4.55)**, 92% of pages ≥ 4, omission 8.5%, reversal 0.8%. German 4.43 (n 22), French 4.54 (n 14), Italian 4.25 (n 10).
  - Noise floor (Lite again − Lite): −0.03 (−0.15 to 0.09); reversals ±7 per 100 pages.
  - **Flash − Lite: +0.21 (0.07 to 0.36)**, omissions 3.4 → 0 per 100. German +0.39 (0.18–0.59); French −0.18 (−0.36 to −0.04).
  - Flash with thinking − Flash: +0.07 (−0.07 to 0.20), inside the floor; reversals 5.1 → 1.7 per 100, also inside the floor; cost ×3.4; neighbour-page text 25% → 44% of pages. `thinkingBudget: 2048` bought zero thinking tokens on 59/59 pages.
  - No neighbour context − Lite: **−0.21 (−0.36 to −0.07)**.
  - Lite on prompt v13 − served: −0.03 (−0.21 to 0.17).
  - Opus ceiling (20 pages): 4.98; +0.50 (0.23–0.83) over Lite, +0.43 (0.18–0.73) over Flash.
  - Cause of the 10 lowest pages, by eye against the scan: translation on a correct transcription 7 (Wilson 40–89%), page seam 2 (6–51%), OCR misread 1 (2–40%, black-letter Dutch), reading order 0, language label 0. Of 10 random pages, 7 had no real defect.
  - Corrected transcription, 6 pages: Flash +0.92 (0.42–1.42), Lite +0.17 (−0.33 to 0.67).
  - Six dimensions, ours vs reference (n 59): readability 3.76 vs 4.27, register 3.68 vs 4.75, terminology 4.17 vs 3.76, ambiguity 4.63 vs 4.17, transparency 4.24 vs 2.58. Stance: ours literal 39, balanced 20; references free 29, balanced 27, literal 3. The judge found ours right and the reference wrong somewhere on 42 pages, the reverse on 22.
- **Limits.** n = 59; Dutch and Spanish are below 10. References exist for known authors, so the corpus mean is probably lower. One model family judges. The corrected-OCR arm is 6 pages. Span cuts were made by a model and checked by the judges, with no separate human leaf-check. API spend $1.36 (envelope `xlref-t3`).
- **Decisions proposed** (Derek's, on #5695): Flash for new German pages (and, on weaker evidence, Italian, Dutch, Spanish), no backlog sweep; no thinking; pilot Flash OCR on black-letter Dutch only.
- **Files.** `scripts/eval/results/xlref-t3-2026-10/` (README, `pages.jsonl` one row per page × arm with licences, raw arm outputs, verdicts, image check, dimension verdicts); scripts in `scripts/eval/xlref-t3/`.
- *Replicated?* No. The Flash-over-Lite direction agrees with #5274's paired arm (+3.6 pp on pages ≥ 4, interval touching zero).
