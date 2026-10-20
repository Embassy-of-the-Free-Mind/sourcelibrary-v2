# Preregistration — Chinese print against CBETA (#6101)

Committed on `eval/cbeta-ref-6101` before any engine ran on these pages.

**Question.** The /quality Pareto panel for Chinese print has n=19, and every interval spans roughly 64–87 %, so no engine can be chosen for print. CBETA's typed text, fitted by #5566 to our own scans of the same editions, is a ready reference. On print pages, how do PaddleOCR-VL 1.6, Gemini 3.1 Flash-Lite and Gemini 3 Flash compare, measured on the same pages?

**Frame.** The books are #5566's 79 fitted books that are `visible: true && pages_count > 0`, which gives 66 books. The pages are those with `ocr.source = 'cbeta-xml-p5'` and `page_number > 0`, which gives 4,287 pages, all imaged on R2. This matches the #6056 audit.
- **Class by eye** (one mid-book page per book, contact sheets): 47 books (2,476 pages) are woodblock and 7 books (226 pages) are 古活字版 movable type (T1988, T2000). The other 12 books (1,585 pages) are the Siku Quanshu **manuscript** copy of 五燈會元 (X1565). The issue calls the whole frame "print"; those 12 books are not print.

**Arms.**
- PaddleOCR-VL 1.6 runs on all 4,287 pages. Setup as in #5547: paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle-gpu 3.2.1, two runners on one leased Scaleway L4, and a page timeout of 90 s that restarts the runner.
- Gemini 3.1 Flash-Lite and Gemini 3 Flash (preview) run on the sealed 200 only, through `benchmark-run-api.mjs`. Both use the generic transcription prompt, thinking 0, temperature 0, and `--refusal-retry=1`.
- Every engine sees the same JPEG: the page image, at most 2,400 px wide.

**Shared set (the engine comparison).** 200 pages, drawn with Mulberry32(6101) from the **54 print books** only.
- Each book's pages are shuffled, and the draw takes one page per book per round (3–4 per book).
- The pool is print-book pages with at least 30 Han characters of reference.
- The registry is `benchmark/chinese-print-cbeta.json`.
- One page per book is impossible at n=200, so intervals are also reported by **book-cluster bootstrap**.

**Reference and normalisation.** The reference is CBETA's text exactly as fitted to the page.
- Before scoring, a `〔composition〕` gaiji becomes one `〇`.
- The scorer then keeps **Han only** on these strata: CBETA punctuation, the `（）` around inline notes, and kana are dropped. The kana are kunten on many of these Japanese prints, and the reference has no kunten, so counting them would measure CBETA's editing.
- The text inside inline notes is kept, because it is printed on the page.
- Residual bias, stated in advance: kaeriten written as Han (一二上下) and any marginal notes that CBETA lacks are charged as insertions to an engine that reads them.

**Measures.** All come from `benchmark-score.mjs`, on pages where all three engines answered:
- CER and its median, with a 95 % CI from a book-cluster bootstrap (2,000 resamples, seed 6101);
- catastrophic rate, CER > 0.5, with a Wilson CI;
- invention_ref;
- loops;
- refusals, counted separately (#5581).

The paired comparisons are Paddle vs lite and flash vs lite: W/L/T, the median Δ with a book-cluster CI, and a sign test. The reference-mismatch guard stays on: if no engine reaches CER ≤ 0.5 on a page, the page counts as a reference misfit, is listed, and is not averaged in.

**Controls.**
- Positive: the reference scored against itself on 5 sealed pages. CER must be 0.
- Negative: on the same 5 pages, the next page's reference. CER must be > 0.5.
- If either fails, the scorer or normalisation is wrong and no result is reported.

**Decision rule** for the one-line recommendation for Chinese print. This is evidence for Derek; routing is not changed here.
- **Paddle** is recommended for print if all of these hold:
  - its median paired Δ vs lite is ≤ 0, with the CI upper bound ≤ +0.02;
  - its catastrophic count is ≤ lite's;
  - its invention_ref median is ≤ lite's.
  These are the #5547 cost-lane thresholds.
- **Flash** is recommended over lite only if its CI excludes 0 in its favour (the shared effect rule).
- Otherwise lite stays.

**Every-page Paddle pass.** This is a secondary result: n, median CER, catastrophic rate (or misfit), loops and timeouts per class (woodblock, typeset, manuscript). With one engine, the misfit guard cannot tell a misread from a misfitted reference, so those pages are counted as "CER > 0.5 or misfit" and 10 are read by eye.

**Spend cap.** $10 in total, with about $5 expected: L4 ≈ €3.6 and Gemini ≈ $0.6.
