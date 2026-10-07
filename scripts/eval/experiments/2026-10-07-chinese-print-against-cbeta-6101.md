## 2026-10-07 · Which engine reads Chinese print, measured against CBETA fitted to our own scans? (#6101)

**Question.** The /quality Pareto panel for Chinese print had n=19 and overlapping intervals of roughly 64–87 %, so no engine could be chosen. #5566 fitted CBETA's typed text (CC BY-NC-SA 4.0) to our scans of the same editions. Used as a reference only (never committed, never translated from), does it separate PaddleOCR-VL 1.6, Gemini 3.1 Flash-Lite and Gemini 3 Flash on print? Prereg: `PREREGISTRATION-chinese-print-cbeta-6101.md`, committed before any engine ran.

**Design.**
- **Frame:** 66 visible books and 4,287 pages with `ocr.source = 'cbeta-xml-p5'`. This matches #6056.
- **Class by eye**, from a contact sheet of one mid-book page per book:
  - 47 woodblock books (2,476 pp);
  - 7 古活字版 movable-type books (226 pp);
  - **12 books (1,585 pp) are the Siku Quanshu manuscript of 五燈會元**, not print.
- **Shared set:** 200 pages, Mulberry32(6101), drawn from the 54 print books only, 3–4 per book.
  - Images are NDL two-page spreads, at most 2,400 px wide, and every engine sees the same JPEG.
  - Gemini uses the generic prompt, thinking 0, temperature 0, and one refusal retry.
  - Paddle uses the #5547 setup (paddleocr 3.7.0, paddlex 3.7.2, paddle 3.2.1) on one leased L4 with two runners and a 90 s page timeout.
- **Scoring:** `benchmark-score.mjs`, **Han only** on these strata (CBETA punctuation, the `（）` around inline notes and kunten kana dropped), with a `〔gaiji〕` counted as one character. Intervals use a book-cluster bootstrap (2,000 resamples) for medians and Δ, and Wilson for rates.
- **Controls:** the reference scored against itself gives CER 0 on 5/5 pages. The next page's reference gives CER > 0.5 on 5/5 (median 1.02).

**Result 1: shared pages** (n = 198 pages from 54 books on which all three answered; 1 reference misfit, `5595ab-p45`). Primary scoring, as preregistered:

| engine | median CER [95 % CI] | catastrophic (CER > 0.5) | invention_ref (median) | loops | refused | $ / 1K pages (this run) |
|---|---|---|---|---|---|---|
| Gemini 3 Flash | **0.052 [0.045, 0.061]** | **0/198 = 0 % [0, 1.9]** | 0.121 | 0 | 1 (RECITATION, both tries) | 1.77 realtime |
| Gemini 3.1 Flash-Lite | 0.068 [0.061, 0.086] | 3/198 = 1.5 % [0.5, 4.4] | 0.155 | 2 (MAX_TOKENS, CER 7.7 and 10.6) | 0 | 1.10 realtime |
| PaddleOCR-VL 1.6 | 0.128 [0.115, 0.142] | **29/198 = 14.6 % [10.4, 20.2]** | 0.197 | 0 | 0 | 2.33 billed (€0.0020/page) |

- **Paired comparisons:**
  - Flash − lite: Δ −0.019 [−0.026, −0.014]; Flash wins 162 pages, loses 30 and ties 6 (sign test p < 0.001).
  - Paddle − lite: Δ +0.062 [+0.053, +0.076]; Paddle wins 33 pages and loses 165.
  - Paddle − Flash: Δ +0.077 [+0.068, +0.088].
- **By class (median CER, Paddle / lite / Flash):**
  - woodblock (n = 172): 0.122 / 0.068 / 0.050;
  - typeset (n = 26): 0.192 / 0.073 / 0.057, with no catastrophic page for any engine.
- **Sensitivity (not preregistered; found while reading the worst pages).** Every NDL image carries the library's label strip below the book (国立国会図書館 / タイトル『…』 / 請求記号 / ガラス使用).
  - Paddle transcribes it on 193 of 200 pages; Gemini does on at most 6. That is about 25 Han characters per page that are not page text.
  - With those lines removed from every engine's output:

    | engine | median CER [95 % CI] | catastrophic |
    |---|---|---|
    | Paddle | 0.067 [0.062, 0.078] | 28 |
    | lite | 0.067 [0.060, 0.085] | 3 |
    | Flash | 0.052 [0.045, 0.060] | 0 |

  - Paired, Paddle − lite becomes +0.006 [−0.002, +0.013], a tie. Flash − lite is −0.017 [−0.024, −0.013].
  - So Paddle *reads characters* about as well as lite on its good pages. What loses is its page-level failures.
- **Paddle's 29 catastrophic pages, by kind:**
  - 8: spread order. It reads the left leaf before the right, so CER ≈ 1.0 at length ratio ≈ 1.05. Confirmed by eye on 9e6c38-p30.
  - 9: it returned only the NDL label and skipped two clean leaves of text. Confirmed by eye on 76797f-p16.
  - 7: 90 s timeouts.
  - 5: one leaf of the spread dropped (length ratio ≈ 0.5).

**Decision rule (preregistered).**
- **Paddle fails.** It has 29 catastrophic pages against lite's 3, and its invention is 0.197 vs 0.155. Its median Δ also fails the CI rule under the primary scoring.
- **Flash passes the effect rule over lite:** its CI excludes 0 in its favour, and it has 0 catastrophic pages against 3.

**Result 2: Paddle on the print frame** (secondary, one engine).
- **Coverage:** the box read 2,048 of the 2,702 print pages (54 books) before its 5-hour deadline, in a seeded shuffle (seed 6102). The manuscript pages, queued last, were not reached; #5547 already measured that class at n=433.
- **Failure** means CER > 0.5 or a reference misfit, *or* fewer than 30 characters returned on a page with text. This is the honest single-engine count, because the misfit guard cannot separate a misread from a misfitted reference here.

  | class | pages | failure | median CER, label-stripped (scored pages) |
  |---|---|---|---|
  | woodblock | 1,883 | **15.2 % [13.7, 16.9]** | 0.059 [0.056, 0.064] |
  | movable type | 165 | 3.0 % [1.3, 6.9] | 0.085 [0.072, 0.113] |

- **The 285 failures, by kind:**
  - 134 spread order (left leaf first);
  - 64 label-only or empty;
  - 52 timeouts;
  - 32 one leaf dropped;
  - 3 other.
- **Concentration:** 碧巖錄 (5 vols), 天如惟則語錄 (4 vols) and 臨濟錄 account for most of them; 14 of 54 books have none.
- **Throughput:** 8.79 s/page wall with 2 runners, 2.6× slower than #5547's 3.35 s on single SKQS pages; 23+ runner restarts after timeouts.
- **Cost:** €4.09 billed for 2,048 pages (311.6 min × €0.7875/h), so €0.0020 per page. All 4,287 pages would have cost about $14, over the $10 cap, so the full run was not done.

**Recommendation for Chinese print (evidence for Derek; routing is not changed here).**
- **Gemini 3 Flash.** Against lite it has a lower median CER (Δ −0.019 [−0.026, −0.014]), no catastrophic pages (0/198 vs 3/198) and no loops (0 vs 2), at about 1.6× the per-page price.
- **Not Paddle on spreads.** About 1 woodblock page in 7 fails outright, and it costs more per page than either Gemini on these images.
- **Untested:** Paddle on split leaves. Spread order and dropped leaves are 166 of its 285 failures, so splitting the spreads first might rescue it. That is a follow-up, not a finding.

**Replicated?**
- Paddle ≈ lite on characters with page-level failures matches the direction of the 7-page #6011 print panel.
- Paddle's catastrophic rate replicates within this run: 14.6 % on the shared 200, 15.2 % on 1,883 woodblock pages.
- Lite's 1.5 % catastrophic on print is far below its 10.6 % on SKQS manuscript (#5547).

**Cost (this run).** Gemini $0.57 metered (lite $0.22, Flash $0.35). Scaleway L4 €4.09 ≈ $4.79. **Total ≈ $5.36**, under the $10 cap. The L4 `sl-cbeta-ref-6101-g1` was deleted with its volume; the provider API returns 404 for both.

**Artifacts.**
- Registry and reference records: `scripts/eval/benchmark/chinese-print-cbeta.json` and `benchmark/refs/chinese-print-cbeta.refs.jsonl`. These are records only: sha256, CBETA work id and lines. The texts are on Hetzner in `/root/cbeta-ref-6101/refs-private/`.
- Scores: `results/benchmark/chinese-print-cbeta-2026-10-06.json`.
- Summaries: `results/cbeta-ref-6101/summary.json` and `summary-nolabel.json`.
- Per-page Paddle results: `paddle-all-pages.jsonl` and `paddle-all-pages-nolabel.jsonl`, scores and hashes only.
- Book classes: `book-class.json`.
- Code: `scripts/eval/cbeta-ref-6101.mjs` and `scripts/gpu/cbeta-ref-6101-scw.sh`.
- Engine outputs, kept on Hetzner only because a correct read *is* CBETA-equivalent text: `/root/cbeta-ref-6101/bench*/`.
