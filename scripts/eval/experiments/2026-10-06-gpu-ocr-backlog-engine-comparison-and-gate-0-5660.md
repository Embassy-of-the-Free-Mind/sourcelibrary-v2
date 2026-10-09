---
stage: ocr
measure: accuracy
languages: [lzh, bo]
scripts: [Hani, Tibt]
canons: []
n_books: 48
n_pages: 48
verdict: "Paddle reads SKQS manuscript pages best (median CER 0.132 vs Qwen3-VL 0.205, flash 0.304, lite 0.372); the Tibetan woodblock canary passed, and gate 0 stopped both backlog lanes."
status: undecided
decision: null
superseded_by: null
issue: [5660]
---
## 2026-10-06 · Can the GPU OCR backlog (SKQS Chinese on Paddle, Tibetan on Yigdzin, Japanese on NDL) be run with quality gates, and which engine should read the SKQS manuscripts? (#5660)

PRIOR ART: the #5600 Paddle fleet (`scripts/gpu/paddle-zh-fleet.mjs`, `scripts/workers/paddle-zh-lane.mjs`, PR #5607) and the yigdzin-527 recipe (`scripts/eval/tibetan-lite-vs-yigdzin/`) are the lanes, reused here. `paddle-zh-5600-optimize.mjs` compared Paddle *configurations*; this compares *engines*, and adds per-gate checks (`scripts/eval/gpu-backlog-5660-gate.mjs`, `scripts/eval/gpu-backlog-5660/tibgate.py`).

**Question.** Job gpu-backlog-5660 (Derek "go", 2026-10-06): read the OCR still owed where a GPU engine is the adopted reader, only on the page class each engine was measured on, and stop at any gate showing a wrong leaf or invented text.

**Scope, recounted from Mongo** ("owed" = a page with no `ocr.data`):
- **Chinese:** 788,265 pp in 8,642 books.
  - In scope: SKQS hand copies (`book_class` handwritten, the siku rule), unheld, ≥ 50 % unread, minus the lane's duplicate rule. That is **3,479 books, 494,495 never-read pages**, all held `gpu-backlog-5660`.
  - Class by eye, one page per book: cohort 20/20 `manuscript-regular`; the `printed` stratum 14/20 woodblock.
  - Out: 109,534 pp of #5600's skipped duplicates, 103K pp printed, 13K pp of #5600 leftovers.
- **Tibetan:** 51,473 pp, not the 131K quoted on 10-05.
  - Script gate: stored OCR ≥ 80 % Tibetan, or one page by eye.
  - In scope: **1,054 books / 26,344 pp** (woodblock 17,444, manuscript 8,898). 1,052 were already held for other reasons.
  - Out: the Taishō Tripitaka and the rest of yigdzin-527's exclude list (19,870 pp), plus non-Tibetan pages by eye.
- **Japanese:** 26,751 pp, but **0 eligible**. All 116 #5100-cursive books were read on 9/30.

**Engine comparison** (prereg `PREREGISTRATION-zh-manuscript-engines-5660.md`).
- 50 manuscript-regular pages, one per book, from the sealed #5547 pool, minus the 200 pages #5600 tuned on. 48 scored after the reference-mismatch guard. `measure: accuracy`, CER vs Kanripo/CBETA.
- **Paddle** (vLLM, 8 clients, no layout): median **0.132**, 0 catastrophic, **€0.000154/page** (H100).
- **Qwen3-VL-8B:** 0.205, Δ +0.016 [+0.010, +0.032], 1 catastrophic, €0.000409/page.
- **gemini-3-flash-preview** (production prompt, thinking off): 0.304, Δ +0.084 [+0.064, +0.100], 6 catastrophic, €0.00271/page.
- **flash-lite:** 0.372, 13 catastrophic.
- Lite run twice at temperature 0 is byte-identical on all 48 pages, so no noise floor.
- **Neither challenger wins; Paddle stays.** Cost to read all 494K pages: Paddle ≈ €76, Qwen ≈ €202, flash ≈ €1,341.

**Tibetan woodblock canary** (prereg `PREREGISTRATION-tibetan-woodblock-yigdzin-5660.md`). 30 Derge Kangyur print volumes, one page each. Median syllable identity **0.955** vs the Derge e-text (shuffle floor 0.27). By eye 10/10: right leaf, nothing invented. **PASS.**

**Gate 0.**

| lane | pages | screen | accuracy | by eye (10 books, `read-from-image`) | verdict |
|---|---|---|---|---|---|
| Chinese (Paddle) | 17,822 read / 16,691 written / 1,026 textless kept / 105 loop-refused, 121 books | Kanripo Dice < 0.6: **5.45 %** [book-clustered 3.0–8.4 %] vs 6.55 % baseline, not worse | 40 books, median CER **0.057** vs the matched WYG page, 0 catastrophic | 0 wrong-leaf; **1 invented** (a Manchu–Chinese 清文鑑 page: five lone 金 lines, Manchu dropped); 1 heavy (康熙字典); 4 clean, 4 minor | **STOP** |
| Tibetan (Yigdzin), shard 0, **not applied** | 5,718 read; 3,634 the judge would serve, 2,084 rejected | — | 33 Kangyur books, median identity **0.954** | 0 wrong-leaf; **3 invented** (a blank leaf read as shad + བ/དང; a title leaf followed by repeated དགེའོ; a cursive page with loops); 2 heavy truncations | **STOP** |

**What the stops say.**
- *Tibetan:* the v4 judge, run against an empty reference, has no check for blank, title-only or short-loop pages. It needs a first-OCR filter: punctuation share, the top syllable's share, image ink.
- *Chinese:* the invention is on a page outside the measured class: a bilingual Manchu dictionary that sits inside the SKQS cohort. Excluding Manchu-bilingual works (清文鑑 and kin) before scaling is the obvious fix. It is Derek's call, because the brief stops on any invented text.

**Ops findings.**
- `paddle-zh-box.sh infer` hung for an hour on every box. Its bare `wait` also waited on the genai server that `serve()` had started from the same shell. Fixed: it now waits on the runner PIDs only.
- The four 抱朴子 volumes have black archived JPEGs (6 KB). The lane kept them unwritten.
- Scaleway had no L4 or L40S stock at 08:20Z, so an H100 was used (0.19 s/page; cheaper per page than an L4). RunPod's balance is negative.

**Spend.** GPU **€11.71** (H100 2.9 h, L4 4.3 h); Gemini **$0.37**. Every box was deleted and confirmed on the provider.

*Replicated?* Engine comparison: n = 48, one draw. Gates: one sample each.

Artifacts: `scripts/eval/results/zh-manuscript-engines-5660/`, `scripts/eval/results/tibetan-woodblock-yigdzin-5660/`, `scripts/eval/results/gpu-backlog-5660/`.
