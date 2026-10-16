---
stage: pipeline
measure: [judged_vs_reference, accuracy]
languages: [la, de, fr, it, grc, he, ar, fa, sa, pi, lzh, bo, en, syc]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani, Tibt, Syrc]
canons: []
n_books: null
n_pages: null
verdict: "Planner v0 ranks 21 routing decisions by expected loss removed per quota cost of a within-round paired test. Fifteen sit above the stop line. The top three are: translate Latin (Flash-Lite vs 3 Flash; the uncertainty is the Gemini judge's view, never measured in Latin); translate German (Flash-Lite vs 3.8 Flash CLI; the evidence already favours 3.8, P 1.00, and only a cross-family round is missing); and read Latin print (Flash-Lite vs 3 Flash vs Sonnet; Flash-Lite is last of the routable readers). Each test costs under 1% of one account-week. Opus leads every language with a reference panel, but Opus can carry only small queues this quarter, so for Latin, German, Chinese and Tibetan the decision is among the Gemini engines."
status: informational
decision: "Three draft briefs attached (briefs/), not dispatched; the session that reads #6740 dispatches them (#6740)"
superseded_by: null
issue: [6740, 6553, 6688]
---
## 2026-10-15 · Planner v0: which routing decisions are worth a test, ranked by expected loss per quota? (#6740)

PRIOR ART: `.claude/docs/quality-research-system.md` §4 (the planner, designed and never built). The decisions come
from two places, not rebuilt: the OCR routing table (`scripts/lib/ocr-routing-table.json`, #6688, read from PR #6695 at `9b9f3644b`), and the
translation engine per language (`src/data/translation-pareto.json`, the engine `getTranslateModelForBook` assigns).
The posteriors are estimator v2 (`2026-10-15-estimator-v2-judge-family-term-6740.md`, translation) and OCR v0
(`2026-10-15-ocr-estimator-v0-accuracy-failure-rates-6740.md`). Quota capacities are #6561's `meter.json`.
`recommend-experiments.mjs` ranks experiments by hand-set priority, not by a posterior. CPU only, $0; one read-only
Mongo aggregate (`volumes.mjs`).

### What it computes (`scripts/eval/estimator/planner/planner_v0.py`)

For each decision, from posterior draws of each available engine's quality:
- **P(not best):** the chance the engine in use is not the best available engine.
- **Gap if not best.** The unit is a page-fraction wrong:
  - translation: (5 − fidelity)/4 of a page;
  - OCR: the CER;
  - a correction lane: its made-worse rate.
- **Pages:** the pages the decision still governs. These are pages not yet translated or read, each book weighted by
  (read_count + 1)/(mean + 1). Live books only; read-only aggregate, `results/volumes-2026-10-15.json`.
- **Expected loss** = P(not best) × gap × pages.
- **The test that would resolve it:** a within-round paired test of the incumbent against the challengers with
  P(best) ≥ 0.10, at most 3 arms.
  - n is chosen by preposterior simulation from 20 to 200 pages.
  - Its value = expected loss removed × pages.
- **Cost:** calls on each subscription as a share of one account-week. Opus 4,250 page-calls; Gemini thinking 33,600;
  Gemini Flash low 151,200; Sonnet half an Opus call. Paid API is counted at $10 per point.
  - Translation tests carry two-family judges (Opus in batches of 3, Gemini 3.8 high one item a call). The incumbent's
    stored English costs nothing.
  - OCR tests pay for new references: one Opus by-eye transcription per page.
- **Rank** = value / cost.
- **Stop line:** a decision is settled when P(not best) < 0.10, or when its test is worth under 1% of the top one (low
  volume: route on the estimate).

**Rules carried from v1, and one added:**
- Translation quality is a **two-family** mean (the Opus and Gemini 3.1 Pro judges, equally weighted). Differences
  only; never a level across rounds.
- An engine whose family has no measured member in the cell is **test first**, never estimated.
- **Capacity:** an engine is a candidate only if the decision's raw queue fits in half its subscription for one quarter
  (13 weeks):
  - Opus 82,875 pages; Sonnet 165,750; Flash low CLI 982,800; API engines unlimited.
  - This is what keeps Opus out of Latin, German, Chinese and Tibetan translation. It leads there, and it cannot carry
    them.
- Withdrawn engines are not candidates: 3.6 and 3.7 Flash CLI, and 3.1 Pro (#6688).

### The ranked table (top 15, the stop line, and the rest)

| # | decision | in use | P(not best) | gap if not | pages (read-weighted) | expected loss | test: arms, n | quota % of an account-week | value / quota | note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | translate Latin | Flash-Lite 3.1 | 0.82 | 0.047 | 561,246 | 21,871 | Flash-Lite vs 3 Flash, n=20 | 0.44 | 42,999 | Opus judge +0.20; Gemini judge +0.09 [−0.47, +0.63], never measured in Latin |
| 2 | translate German | Flash-Lite 3.1 | 1.00 | 0.128 | 146,146 | 18,745 | Flash-Lite vs 3.8 Flash CLI, n=20 | 0.45 | 41,194 | evidence already favours 3.8 Flash CLI (P 1.00) |
| 3 | read Latin print | Flash-Lite 3.1 | 1.00 | 0.074 | 342,892 | 25,268 | Flash-Lite vs 3 Flash vs Sonnet, n=20 | 0.72 | 32,171 | evidence already favours 3 Flash (P 1.00) |
| 4 | translate Tibetan | 3 Flash | 1.00 | 0.082 | 68,250 | 5,607 | 3 Flash vs 3.8 Flash CLI, n=20 | 0.45 | 12,052 | evidence already favours 3.8 Flash CLI |
| 5 | translate Greek | 3 Flash | 1.00 | 0.182 | 58,107 | 10,603 | 3 Flash vs Opus, n=20 | 0.90 | 11,777 | evidence already favours Opus (#6545) |
| 6 | translate French | Flash-Lite 3.1 | 1.00 | 0.093 | 84,363 | 7,808 | Flash-Lite vs Opus, n=20 | 0.90 | 8,443 | evidence already favours Opus |
| 7 | read German, French etc. print | Flash-Lite 3.1 | 0.95 | 0.021 | 150,435 | 3,015 | Flash-Lite vs 3 Flash, n=20 | 0.49 | 5,969 | |
| 8 | translate Italian | Flash-Lite 3.1 | 1.00 | 0.187 | 26,062 | 4,876 | Flash-Lite vs Opus, n=20 | 0.90 | 5,405 | evidence already favours Opus |
| 9 | translate Hebrew | 3 Flash | 1.00 | 0.149 | 26,906 | 4,018 | 3 Flash vs Opus, n=20 | 0.90 | 4,457 | evidence already favours Opus (#6545) |
| 10 | read early English print | Flash-Lite 3.1 | 0.97 | 0.041 | 59,082 | 2,365 | Flash-Lite vs Chandra vs 3.8 Flash high CLI, n=20 | 0.55 | 3,088 | flat: 6 engines at P(best) 0.11–0.16 |
| 11 | translate Arabic | 3 Flash | 1.00 | 0.187 | 13,297 | 2,482 | 3 Flash vs Opus, n=20 | 0.90 | 2,758 | evidence already favours Opus |
| 12 | read Chinese print | Flash-Lite 3.1 | 0.97 | 0.088 | 21,019 | 1,800 | Flash-Lite vs Chandra vs 4 Argon low CLI, n=20 | 0.55 | 2,405 | references unfit (#6304): a reference set first |
| 13 | translate Sanskrit | 3 Flash | 1.00 | 0.247 | 5,943 | 1,471 | 3 Flash vs Opus, n=20 | 0.90 | 1,634 | evidence already favours Opus (#6545) |
| 14 | read Chinese manuscript (Siku) | PaddleOCR-VL | 0.78 | 0.021 | 84,075 | 1,406 | Paddle vs 4 Argon low CLI vs Opus, n=20 | 1.01 | 794 | a three-way tie |
| 15 | translate Persian | 3 Flash | 1.00 | 0.238 | 2,420 | 577 | 3 Flash vs Opus, n=20 | 0.90 | 642 | evidence already favours Opus (#6545) |
| | **— stop line: below here the decision is settled enough —** | | | | | | | | | |
| 16 | translate Pali | 3 Flash | 1.00 | 0.200 | 258 | 52 | | | 58 | low volume: route on the estimate (Opus) |
| 17 | translate Chinese | 3 Flash | 0.02 | 0.021 | 492,501 | 236 | | | 47 | settled among the engines that can carry 1.66M pages |
| 18 | correct Chinese table drafts | Opus | 0.25 | 0.021 | 4,379 | 23 | | | 3 | low volume |
| 19 | correct Tibetan drafts | Gemini 3.8 Flash low | 0.43 | 0.013 | 5,755 | 33 | | | 3 | low volume |
| 20 | read Syriac print | OmniSyr (Kraken) | 0.61 | 0.035 | 25 | 0 | | | 1 | low volume |
| 21 | read Greek print | Gemini 3 Flash | 0.04 | 0.007 | 24,558 | 7 | | | — | settled (P best 0.94) |

**Test first, not estimated:**
- Syriac translation (no estimator data);
- three Chinese-print engines with no measured family member (NDL Koten, Surya, Tesseract).

**Routing-table rows the planner cannot score yet** (no posterior covers them):
- manuscripts (Opus);
- Nahuatl and Mayan;
- Tibetan reading (Yigdzin; syllable identity is a different measure);
- Japanese cursive;
- refused pages;
- two reads that disagree.
The OCR v0 failure rates speak to some of them (`results/failures-v0.json`). None has an accuracy posterior.

### What the table says

- **The three most valuable tests are cheap.** Each costs under 1% of one account-week and about 20 pages. They govern
  561K (Latin translation), 146K (German translation) and 343K (Latin reading) reader-weighted pages.
- **Eight of the fifteen are "evidence already favours" rows.** The estimator already prefers the challenger with
  P ≥ 0.95, and the planner still asks for a test. That follows v1's rule 1: a route changes on a within-round paired
  test that includes the incumbent, judged by both families.
  - For the Opus rows (Greek, French, Italian, Hebrew, Arabic, Sanskrit, Persian), #6545 already ran exactly that test
    in four of them (Greek, Hebrew, Sanskrit, Persian). A session may judge those rows already resolved, and route by capacity. That is a
    decision for Derek, not the planner.
- **Opus is the leader wherever it is a candidate.** The binding constraint is capacity, not evidence. A route to Opus
  for Greek (57K pages) or French (48K) uses most of a quarter's Opus allowance on its own, so the planner's capacity
  rule is the real decision. #6690 found 10 pages per call cuts usage 2.7× for −0.30 points; that is the lever that
  would move those rows.
- **Chinese translation is settled only because 3.8 Flash and Opus cannot carry 1.66M pages this quarter.** Among the
  engines that can (the API's Flash-Lite and 3 Flash), 3 Flash is ahead with P = 0.98.

### Limits

- **The common unit is a choice.** One fidelity point counts as a quarter of a page wrong.
  - A different exchange rate between translation and OCR would move the OCR rows against the translation rows, and
    could move the stop line.
  - Within each stage, the order does not change.
- **Expected loss counts only the decision's queue, not the stored text** that a switch might later redo.
- **The OCR posterior's levels are biased** (v0). The planner uses its within-chart differences only. Their sign is
  right in 95% of in-sample pairs.
- **Volumes are live books** (`visible && pages_count > 0`, read 2026-10-15). Hidden books queued for processing are not
  counted.
- **The value of a test is preposterior on the model's own noise.** A real round adds a round effect. The paired design
  cancels it for the difference, and nothing else does.

Artifacts:
- `scripts/eval/estimator/planner/`: `planner_v0.py`, `volumes.mjs`, `results/plan-v0-2026-10-15.json` (every row,
  arms, n, calls by subscription, the test-first list), `results/volumes-2026-10-15.json`.
- `briefs/`: the top-3 draft job briefs, with a pinned prediction, pages, arms, two-family judges, controls, α and a
  sequential stop rule.
- Posterior draws are on cloudlayer: `/data/scratch/sl/jobs/qloop-6740/`.
