---
stage: ocr
measure: judged
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 40
n_pages: 40
verdict: "Kanripo aligns 36/40 SKQS pages but 28% have shifted page breaks; Paddle's English beats lite's 20-4 (both orders); Kanripo text does not improve the English over Paddle."
status: undecided
decision: "Recommends Paddle for all 7,894 books, Kanripo for 0 as page text (licence is Derek's call); rides on #5547's pending row"
superseded_by: null
issue: [5568, 5547]
---
## 2026-10-01 · Held Siku Quanshu cohort: can Kanripo's text replace OCR, does the OCR engine show in the English, and does Paddle's output fit the production writer? (#5568)

**Question.** Three follow-ups to #5547 (7,894 Chinese books held out of #4719, 97.7 % Wenyuange SKQS brush manuscript). #5547 asks which engine should read them. This entry asks: (1) Kanripo already transcribes the Wenyuange copy. Can its text stand in for OCR? (2) Does the OCR engine change the English a reader gets? (3) Would PaddleOCR-VL's raw output go through the production OCR writer and the translation lane unchanged? Prereg: `PREREGISTRATION-chinese-skqs-5568.md`, committed before any score (PR #5578). The inputs are #5547's sealed set, engine outputs and pilot texts, and nothing in them was changed.

**Design.** One sample serves tests 1 and 2: **40 held books, one page each**, drawn with seed 5568 from the 282 sealed pages that are held, eye-classified manuscript-regular, carry a Kanripo `work_id`, and have a Paddle read of ≥ 50 Han characters. The draw was not conditioned on #5547 having found a reference.
- *Test 1.* Kanripo's WYG files mark every half-leaf (`<pb:KRxxxx_WYG_jjj-NNa>`), the same unit as one scan image. Paddle's read is compared with every `<pb>` page within ±5 juan of the title (char-bigram Dice on Han characters, with a short variant fold). Aligned means Dice ≥ 0.6. The alignment was then run over every page of the 17 complete #5547 pilot volumes (2,713 pages) to measure drift. A census covered all 600 works (GitHub reads), and the licence was read from each repository.
- *Test 2.* The production translation prompt v13 (`buildTranslationPrompt`, lite, thinking 0, temperature 1 as the worker effectively runs) was fed five texts per page:
  - lite OCR (**L**);
  - Paddle (**P**);
  - the aligned Kanripo page (**K**, 36 pages);
  - Paddle after a lite 句讀 punctuation pass (**PP**; all 40 kept every Han character, max CER 0.0096);
  - Paddle translated a second time (**P2**, the sampling floor).

  The blind judge was `gemini-3-flash-preview`, given the page image and A/B translations, and asked for MATERIAL yes/no and BETTER A/B/TIE. Controls: 10 byte-identical pairs, and a 12-pair test-retest with A/B swapped.
- *Test 3.* The pure functions the OCR collector and translate-core apply were run over all 2,713 pilot pages. No writes.

**Test 1 — Kanripo instead of OCR.**
- **Coverage (census, 7,894 books / 1.19M pages):** 7,701 books (97.6 % [97.2, 97.9]) have a WYG witness, 100 only `master`, 84 no repository, 9 no `work_id`. **7,001 books (1.06M pages) have juan files covering the title's juan range.** File presence is not text completeness: 經稗 has 12 juan and Kanripo's WYG branch stops after juan 1, so that pilot volume aligned 37 %.
- **Page alignment (40):** **36/40 aligned (0.90 [0.77, 0.96])**, median Dice 0.93, median margin over the runner-up 0.77. CER against the aligned Kanripo page: Paddle 0.081, lite 0.127 (medians). Some of that is variant forms rather than misreads (幾/㡬). Diagnostic outside the prereg: searching the whole work instead of ±5 juan aligns **39/40**. The title's juan number often does not name Kanripo's file (佩文韻府 卷85之1 sits in file 688; 五禮通考 卷19 in file 30), so a lane must locate pages by text. The 40th page (萬姓統譜 卷88) is missing from Kanripo, which has 86 files for a 146-juan work.
- **Drift (17 pilot volumes, 2,713 pages, 2,587 with text):** 93.4 % of text pages aligned. Across the 15 volumes of running text, **98.1 % aligned (each volume ≥ 95.1 %), and one anchor per juan predicts the Kanripo page exactly for 2,261/2,261 later pages.** A single anchor per volume fails at juan starts (the offset steps by 1–2). The exceptions are the illustrated bronze catalogue 西清古鑑 (17 offset steps around plates; anchors predict 5/52) and 經稗 (missing text). Unaligned pages are covers, 提要 and plates.
- **Page boundaries — the finding that limits a drop-in.** On 36 aligned pages, after dropping Paddle's margin lines: **22 start and end where the scan does; 10 (28 %) have a Kanripo `<pb>` a column or more off at one or both edges.** Two were checked by eye: on 1d89bb-p120 Kanripo starts at the scan's second column and runs one column into the next page; on 493195-p54 it starts a column early. The other 4 misses are Paddle misreading the margin. Writing Kanripo `<pb>` pages as page text would put a neighbour's column on roughly one page in four, which is a wrong-leaf quote.
- **Licence.** None of the 600 repositories carries its own licence: no GitHub licence field (0/600), no LICENSE file (0/600), no licence line in `Readme.org` (0/600); the text-file headers carry only title, date and juan. The only statement is the organisation profile: "Licensed as CC BY SA 4.0" (https://github.com/kanripo). kanripo.org/about sits behind a Cloudflare challenge and was not read. Who transcribed the WYG text is not stated in the repositories. **Per text: unclear; org-wide: CC BY-SA 4.0.** That is compatible with publishing transcriptions and translations under CC BY-SA 4.0 (`src/lib/license-info.ts`, /terms) with attribution. It is **not** compatible with the "bulk and AI-training use is reserved" line (`src/lib/bot-attribution.ts`): BY-SA 4.0 §2(a)(5)(C) ("no downstream restrictions") forbids adding restrictions to the licensed material. Derek's call.
- **A provenance-complete write** (dry run, `results/chinese-skqs-5568/kanripo-write-dryrun.json`) records `ocr.source: kanripo`, the repository, branch, **commit sha**, file, `<pb>`, the URL at that commit, the licence statement and the per-text gap, the alignment (probe engine, probe content_hash, Dice, runner-up), the image URL, and `content_hash`. `missingProvenance()` passes it, **and it also passes the same `$set` with no engine block at all**: any source outside `ai/batch_api/pipeline_preview/kraken/bdrc/mineru/ia_djvu` is checked for `content_hash` + `updated_at` only.
- **Rule T1 (prereg): viable** (0.90 ≥ 0.80, lower bound 0.77 ≥ 0.65, anchor-per-juan 0.98 ≥ 0.90). Three facts the rule did not foresee keep it from being the recommendation (below): the 28 % boundary shift, an English that does not improve (T2b), and a saving capped at Paddle's cost.

**Test 2 — does OCR quality survive translation? (40 pages, 406 judgements, $0.49 of judging)**
- **Judge checks.** Byte-identical control: 10/10 TIE and not-material ✓. Test-retest with A/B swapped: MATERIAL 9/12 agree (0.75, exactly the prereg bar), BETTER 7/12. **Position bias: B was preferred 111 to 57 on the first pass (225 to 111 across both passes).** On P–PP, the per-pair coin put PP in slot B on 28 of 40 pages, and when PP sat in A, P won 7–2. That made the prereg's single-order T2c result an artefact. **Post hoc (not preregistered), every main pair was judged again with A/B swapped, and only verdicts that survive both orders are counted.** Results below are both-orders; the single-order numbers are in `test2/score.json`.

| pair | material (both orders) | better, both orders (rest TIE or flipped) | sign p |
|---|---|---|---|
| **P–P2 (same Paddle text, translated twice)** | **23/40 = 0.58 [0.42, 0.72]** | 14 / 10 | 0.54 |
| **L–P (lite OCR vs Paddle)** | **35/40 = 0.88 [0.74, 0.95]** | **Paddle 20 / lite 4** | **0.0015** |
| P–K (Paddle vs Kanripo text) | 25/36 = 0.69 [0.53, 0.82] | Paddle 13 / Kanripo 8 | 0.38 |
| L–K | 28/36 = 0.78 | lite 9 / Kanripo 10 | 1.0 |
| P–PP (句讀 pass) | 18/40 = 0.45 | **PP 12 / P 3** (25 tie/flip) | 0.035 |

- **T2a — the OCR engine changes the English: yes.** L–P is material on 35/40 against a floor of 23/40; 12 pages are material only for L–P, 0 only for the floor (McNemar p = 0.0005). Paddle's English is preferred 20–4 in both orders. Judge examples: lite drops the small double-column headwords (1f37f6-p60), lite reads a page in reverse column order (158d4c-p41), the two name a commentator differently and one stops mid-sentence (1ef65d-p130, Paddle preferred). Lite also wins pages: on 489739-p158 Paddle's English has "soldiers" where the page says 士 "scholars".
- **T2b — Kanripo text improves the English over Paddle: no.** Kanripo trails Paddle 8–13, and P–K material (0.69) is not above the floor (McNemar p = 0.39). Most of the reasons the judge gives where Kanripo loses are the boundary shift (a column missing or added) and the missing margin title or leaf number. For the English, Paddle's 8 % CER does not cost a measurable amount here.
- **T2c — 句讀 pass: rule met in both orders (12–3, p = 0.035, ≥ 2×), but weak.** 25 of 40 pairs tie or flip with order, and its material rate (0.45) is *below* the sampling floor. The judge prefers the punctuated input's English, but the meaning does not change more than sampling noise does. This is directional, not decision-grade. Cost would be ≈ $0.00043/page realtime (≈ $250 batch for the cohort).
- **The floor itself is a finding.** The production translator at its effective temperature 1.0 gives two materially different Englishes for the *same* source text on 58 % of these pages (both orders). That is larger than any source effect except lite-vs-Paddle. It is a measurement of lite on dense classical commentary, n = 40, one judge family. It is not tested here whether temperature 0 halves it. Worth its own run before anyone reads a single translation A/B on this corpus.

**Test 3 — Paddle output vs the production format (2,713 pilot pages, dry run).** Every check below runs, and Paddle's text goes through unchanged without error. That is the problem: the text is not in the shape the lane assumes.
- Passes unchanged: length cap 0 over 25K; loop guard refuses 1 page (0.04 %); `isTranslatablePage` 2,589 ok, 123 `no-body` (blank and plate pages correctly not sent), 1 `ocr-loop`; `buildTranslationPrompt` accepts the raw text; no wrapper tags, so `stripEditorialWrappers` changes nothing.
- **Conversions a Paddle lane writer needs:**
  1. **Envelope.** Production OCR carries `<scan-quality>`, `<language>`, `<script>`, `<page-type>`, `<warning>`, `<meta>`, `<vocab>`; Paddle carries none, so `page_type` is never set and consumers that trust the in-text `<language>` get nothing. Prepend `<language>Chinese</language><script>handwritten</script>` as the Kraken lane does (`syriac-kraken-lane.mjs envelope`), and claim no `<page-type>` Paddle did not make.
  2. **The 版心 margin.** Paddle reads the fold strip into the body: a 四庫全書 line on 688 pages (25 %), and **kana garbage on 940 pages (35 %)** (`老一でこえー`, `金ちゃんさん` — SKQS contains no kana). Drop lines containing kana; mark the margin title, juan and leaf number as `<header>` / `<page-num>`.
  3. **HTML.** `<div style="text-align: center;"><img src="imgs/img_in_chart_box_…">` on 24 pages (a path to a file that does not exist; the translator would see it as text) and `<table>` on 19. Drop the `<img>` (a plate gets no `<image-desc>` from Paddle); flatten tables to lines.
  4. **Provenance.** Add `paddle` (and `kanripo`, if that lane is ever built) to the specialist set in `write-provenance.mjs` and its TS twin, so the checker requires `engine.name/model/run`. Today a `paddle` write with no engine block passes on 2,713/2,713 pages. Record PaddleOCR-VL 1.6 / paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle-gpu 3.2.1, run, image URL; set `ocr.pipeline` so specialist-lane checks see it.
  5. Nothing in the translation prompt needs `<vocab>`: it is an OCR-side output, and its absence only removes a hint.

**Recommendation for #5547's decision row.** **Paddle for all 7,894 books** (as #5547 proposes, dedup first). **Kanripo for 0 books as page text in this round.** If the licence clears, up to 7,001 books could later get a second, quotable Chinese text layer, re-cut at Paddle's page boundaries, as its own decision. Why not more: a Kanripo lane still needs a read of every page to anchor per juan and to re-cut the 28 % of shifted `<pb>` breaks, so the most it could save is Paddle's ≈ €650–800. It gains nothing measurable in the English (T2b), and the per-text licence is unstated. Do use Kanripo now, for free, as a **QA screen on the Paddle lane**: align each Paddle page, and send any page of a WYG-covered book below Dice 0.6 for review or re-read (≈ 2 % of text pages on regular volumes). The Paddle lane writer needs the four conversions above before it writes a page. The 句讀 pass is a candidate, not a decision. Not changed by this entry: routing, `DECISIONS.md` (#5547's row is in its own PR #5548; this recommendation is posted on #5568 for that row).

**Replicated?** Partly. Paddle over lite on SKQS replicates #4925 and #5547 at the level of the English, not just CER. The alignment rate is measured once (40 + 17 volumes). The judge is one model family with no human reference; its position bias was found and corrected post hoc.

**Cost.** Gemini $0.748 metered (punctuation $0.017, translation $0.244, judge $0.486, including the $0.23 swapped-order pass). GitHub reads only, no GPU. Under the $5 cap.

**Artifacts.** `scripts/eval/zh-skqs-5568-{kanripo,translate-judge,format}.mjs`; `scripts/eval/results/chinese-skqs-5568/` (coverage census, alignment, boundaries, drift, format check, Kanripo write dry run, `test2/` sources, translations, packets with pinned hashes, judgements both orders, scores, spend). The Kanripo page texts in `test2/sources.json` are CC BY-SA 4.0 per the Kanripo organisation profile.
