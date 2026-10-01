## 2026-09-28 — For which English IA books may the Archive's own OCR replace flash-lite? First English reference pages, both engines scored against them (#5124, scoped; #5180, #5186, #5014)

- **Question.** Every English OCR number so far was two engines agreeing (eval-design §11: zero English
  reference pages). Against a truth independent of both, how does the Archive's `_djvu.xml` text compare
  with a fresh flash-lite read, per cohort — and how often does either misread a printed NUMBER (#5186)?
- **Design.** `measure: accuracy`. English IA books we hold ∩ en.wikisource proofread `Page:` transcriptions
  of the SAME scan (176 Index files matched by IA id in the file name, the Index `Source=`, or the Commons
  description), then Project Gutenberg HTML with printed page breaks (`pagenum` markers) for cells still
  short. One interior page per book (15–95% of the scan). Strata: catalogue year (<1880 / 1880–1930) ×
  date-dense PAGE (reference has ≥ 6 numbers of 2–4 digits). Leaf identity checked on every page by eye
  (Sonnet subagents, `leaf_check_by: model-eye`; 17 queued for Derek's human spot-check) plus an
  image↔leaf engine-consensus cross-check. Lite = production OCR prompt v16, realtime, thinking 0, one
  retry on refusal; the Archive text = the located `_djvu.xml` leaf, dehyphenated. Scored on letters+digits
  after trimming an engine's unmatched leading/trailing words (running heads). Number misread candidates
  were read off the image; a **silent misread** = the page prints the reference's number and the engine
  gave a different number one glyph away (the #5186 class).
- **Result** (122 referenced books; S1 25, S2 22 = *exploratory*; S3 41, S4 34 = *directional*):

  | cell | Archive pooled CER | lite pooled CER | paired: lite better / Archive better / tie | silent number misreads Archive / lite | lite refusals after retry |
  |---|---|---|---|---|---|
  | S1 pre-1880 prose | 6.6% | 1.5% | 15 / 1 / 7 | 1 of 10 / 0 | 2 of 25 |
  | S2 pre-1880 date-dense | 6.4% | 4.0% | 11 / 1 / 7 | 3 of 265 / 0 of 194 | 3 of 22 |
  | S3 1880–1930 prose | 0.62% | 0.34% | 16 / 1 / 19 | 0 / 0 | 5 of 41 |
  | S4 1880–1930 date-dense | 3.5% | 4.9% | 15 / 2 / 10 | 6 of 599 / 0 of 534 | 7 of 34 |
  | ALL | 3.95% [2.3, 6.1] | 2.62% [1.2, 4.6] | **57 / 5 / 43** (sign test p < 0.001) | **1.5% of printed numbers [0.6, 2.7], 9 pages / 0 of 750** | 17 of 122 (14%, CI 9–21%) |

  (ALL row: CI recomputed 2026-09-30, #5373 — was [2.2, 6.2], [1.1, 4.5] and [0.6, 2.5]. The 9–21% refusal interval is analytic and stands.)

  Lite is better on the same page in every stratum. The Archive silently misreads about 1 printed number
  in 70 (e.g. *5180 years* → *6180* twice on one Albērūnī page, read by eye); lite made none that survived
  the image check. Lite's worse pooled CER in S4 is one two-column index it laid out as a row-wise table
  (39 of its 63 "dropped" numbers are that one page: order, not misreading). The Archive's worst page is
  English text OCR'd by Tesseract as Greek (`ΟΝ ΤῊ ΟΑΥ̓Ε…`, CER 87%).
- **Proposed routing (not applied; Derek's call, eval-design §10).** Lite stays the default. The Archive
  lane earns NO date-dense cohort (silent number misreads at ~1.5%, lite 0). Candidate cohort, directional
  only: **1880–1930 pages whose Archive text contains no 2–4-digit number and is ≥ 90% Latin script** —
  there the Archive is 0.6% CER against lite's 0.3% with no number to get wrong. Second use: on a lite
  **recitation refusal after retry** (14% of pages), write the Archive text instead of nothing. Pre-1880
  prose is not earned (6.6% vs 1.5%).
- **Instrument findings.** (1) The IA djvu leaf index is not always our `/page/nK` image index: 25 of the
  first 134 images were a neighbouring leaf. (2) A model-eye leaf check passed 3 wrong leaves that the
  engine cross-check caught. (3) The normaliser in `ia-ocr-delivered-quality.mjs` strips `<[^>]+>` before
  the centred-line marks, so a lite read with `->…<-` loses text up to the next `>` — its #4780 CERs
  are affected. (4) Lite files printed FOOTNOTES in `<note>`, which the prompt defines as interpretive;
  any surface that drops `<note>` drops printed footnotes. (5) Wikisource was wrong on 4 numbers the
  engines read correctly (one index page, one footnote) — the reference error is not zero.
- **Not measured.** Batch (vs realtime) lite; flash; pre-1600 English and French (rest of #5124); a random
  sample of our holdings — only books volunteers proofread or DP transcribed, which skews legible. 4,888
  English IA books had no e-text by these matchers (`no-e-text-queue.jsonl`, the transcription queue).
- *Cost:* < $0.50 of $3 (store: $0.38, 244 lite calls). *run_id* `en-ocr-ref-5124-2026-09`.
  *Replicated?* No; one lite run, one reader per leaf. *Artifact:* `results/en-ocr-ref-5124/report.md`,
  registry `benchmark/english-ia-5124.json`, 122 references `benchmark/refs/en-*.{json,txt}`, store
  `store/outputs/gemini-3.1-flash-lite/2026-09.jsonl` + `store/scores/en-ocr-ref-scorer@1/2026-09.jsonl`,
  script `en-ocr-reference-5124.mjs`. Dashboard not regenerated: the store has no dashboard reader yet (#5121 store converters, #5119 dashboard). References reusable by #5182 (lite vs flash on modern English).
