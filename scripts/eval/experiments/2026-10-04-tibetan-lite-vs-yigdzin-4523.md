## 2026-10-04 · On the same held Tibetan pages, how often do Gemini 3.1 flash-lite and Yigdzin agree, and which one reads the Kangyur? (#4523)

**Question.** 527 held Tibetan books had preview OCR from `gemini-3.1-flash-lite` (10,630 pages) and no Yigdzin read. Once Yigdzin had read them, which this job did anyway, how often do the two engines diverge on the same page? And on the one Kangyur book, which engine matches Derge?

**Design.**
- **Rule:** `PREREGISTRATION-tibetan-lite-vs-yigdzin.md`, committed before any pair was read.
- **The read** (job yigdzin-527, approved 2026-10-03):
  - the step-2 per-leaf worker, unchanged: partition mode, BDRC/tibetan-ocr `50506eb6`, vLLM 0.29.0;
  - 406,512 pages on 5 L4 GPUs (`sl-yig527-0` L4-1 and `sl-yig527-1` L4-4);
  - acceptance rule v4 (`leaf_v4.judge_one`) against an **empty** reference (see below);
  - applied with `apply-reocr-verdicts.mjs --model=bdrc-yigdzin-v1 --run=yigdzin-leaf-2026-10-03 --read-mode=leaf`, which snapshots each Gemini read to `page_revisions` first.
- **The comparison:** one pair per book (smallest `sha256("4523:"+page_id)`) out of 7,659 lite/Yigdzin pairs. Both reads are normalised the same way: tags dropped, Tibetan block only, `kanjur_align.syllables`.
  - Agreement = 1 − syllable Levenshtein / longer read.
  - Derge control: `kanjur_align.py score` (full index, window 2) plus a shuffle floor, on Neyphug Kanjur rGyud Ta.
- **Spend:** €50.4, 64.0 L4 GPU-hours. The estimate was €105 and the cap €120. The comparison itself cost $0 on CPU.

**Result.**
- **The engines rarely agree** (n = 494 books, one page each). Median syllable agreement is **0.11** (IQR 0.06–0.44). Bins:

  | agreement | pages |
  |---|---|
  | < 0.2 | 291 |
  | 0.2–0.5 | 88 |
  | 0.5–0.8 | 106 |
  | ≥ 0.8 | 9 |

  - BDRC: median 0.22 (n = 369).
  - BL: median **0.06** (n = 125). On BL cursive, lite mostly writes Devanagari, the fabrication named in the issue title.

  This measures divergence, not accuracy.
- **Derge positive control** (23 pages; the instrument is valid on this book: Yigdzin is 0.71 above its floor, against ≥ 0.20 required):

  | arm | median identity vs Derge | shuffle floor |
  |---|---|---|
  | **Yigdzin** | **0.962** | 0.249 |
  | lite | 0.149 | 0.125 |

  - **Yigdzin wins 23 of 23 pages**; the median paired difference is +0.81.
  - Here lite wrote fluent Tibetan, about 9.8K Tibetan characters per page and no Devanagari, that matches Derge at chance. Tibetan-only lite text: 0.150 (not pre-registered; reported as a check).
  - On this book the lite read is invented text, not a noisy reading.
- **40 disagreement pages** (27 BDRC, 13 BL; 379 pages qualified below 0.5) are ready for by-eye arbitration: `arbitration-40.{json,html}`. **They are unjudged.** No model has judged them; that is left to a human.
- **Found on the way, and it matters more than the comparison.**
  - **The 527 were not all Tibetan script.** On the English *Tibet's Great Yogi Milarepa*, Yigdzin wrote fluent Tibetan, and the empty-reference v4 rule accepted 56 of 128 pages at validity ≈ 1.0. Caught in the pilot, before any apply.
  - **19 books excluded** after an eye check of two mid-book images for every non-BL book whose Gemini read was not Tibetan-dominant (`exclude-books.json`): Chinese (Taishō, 16.6K pages), Indic palm-leaf and paper manuscripts, English studies, IDP paintings.
  - **1,587 pages gated** because their Gemini read was Latin- or CJK-dominant (front matter).
  - **Yigdzin is not a script detector.** Any future Yigdzin lane needs a script gate in front of it.
- **The read.**
  - 401,099 pages judged, 392,888 accepted.
  - Rejected: 5,604 validity-drop, 2,602 duplication, 5 loop.
  - 391,816 served; 1,072 skipped as under 20 syllables.
  - 10,331 guttered images skipped by the worker, which is by design.
  - Holds, `visible`, and translations (0) unchanged on all 527 books.
- **What the absolute rule cannot see.** Step 2's relative checks (fewer syllables or lines than a page read) cannot fire without a page read. An accepted read here has passed only strip, duplication, loop and validity ≥ 0.50.
  - 108K pages had fallback geometry and were read as one crop.
  - 16,876 multi-leaf pages carry seams.

**Replicated?**
- The Derge result is consistent with #4195's by-eye finding that lite invents fluent text on Tibetan cursive. It is one book, 23 pages.
- The agreement distribution is a single run.

**Artifact.**
- `scripts/eval/results/tibetan-lite-vs-yigdzin-4523/`: `summary.json`, `scores-sample.jsonl`, `derge-*`, `arbitration-40.*`, `run-summary.json`, `script-survey.jsonl`.
- `scripts/eval/tibetan-lite-vs-yigdzin/`: scope, todo, shards, box, tender, judge, export, compare, Derge control, verify.
- The full pairs (`pairs-all.jsonl`, 64 MB) and the per-page decisions and provenance are on Hetzner in `/root/yig527/`.
