---
stage: ocr
measure: [judged]
languages: [la, zh, bo, de]
scripts: [Latn, Hani, Tibt]
canons: []
n_books: 100
n_pages: 150
verdict: "Not judged yet. The instrument is built and the 188-call packet is drawn, but no judge call ran: this box's Claude account (team@) was at 88% of its week at 22:45Z, above the brief's 85% ceiling, until the reset at 2026-10-27 14:00Z. The draw itself gave two findings. Of 4,379 served Paddle -> Opus Chinese corrections, one has a table in its draft, so served pages cannot answer the Chinese-tables question. And the visible 1500-1800 German frame holds no served Opus English, so cell 4 has two routes."
status: undecided
decision: "Run the judge after the 2026-10-27 14:00Z reset (one command, below); no routing change until it has run."
superseded_by: null
issue: [6740]
---
## 2026-10-25 · Same-judge qualitative read of production routes: pilot, drawn and not yet judged (#6740)

PRIOR ART: `scripts/eval/translate-cli-lane-7075/sample.mjs` is reused here: its seeded one-page-per-book draw, its
blind packet with a separate key, its wrong-page control, and `parseJson`. It judges translations pairwise, from the
OCR text alone, with no defect tags. `scripts/eval/route-judge-6740/judge.mjs` extends it to OCR and translation. It
reads one output at a time against the page image and tags defects with the 44 classes of
`.claude/docs/page-error-taxonomy.md`.

### What the instrument is (after Derek's note of 2026-10-25 22:19Z)
- **One judge: Opus 5.5 through `claude -p`.** The image is in the call's workspace, and Read is its only tool. **Opus
  is the reference. This is ASSUMED, by Derek** ("I dont even believe in the judge family effect. Assume Opus is ok;
  we are mostly looking for enhanced cost"). The Gemini 3.8 Flash High judge and the A/A repeat in the original brief
  were dropped on that note. Agreement between judges is therefore not measured, and this pilot cannot say whether
  Opus prefers its own outputs.
- **Per page:** `accept` (would a reader be served as well as by the Opus read), `matches_reference`, a 1-5 fidelity
  score, and defects. Each defect has a taxonomy class, a quoted span from the candidate, and a severity: cosmetic,
  misleads, or wrong_text. The judge also writes a one-line note on what a reader would notice.
- **Reference per cell.** Where production or an earlier eval holds an Opus text of the same page, it is shown as the
  reference, and the image wins where the two disagree. Otherwise Opus reads the leaf itself inside the judging call.
- **Control:** two wrong-page items per cell × route. Each shows this page's image (and its reference) beside another
  page's output from the same route. A cell counts only if Opus accepts neither and scores both ≤ 2.
- **Headline per route:** accept k/n with a by-book bootstrap interval (by page in the one-volume Tibetan cell); pages
  with ≥ 1 wrong_text defect; defect classes as k/n; three quoted examples of the commonest class; and cost per usable
  page (route cost ÷ accept rate) against Opus direct. Costs come from `scripts/eval/estimator/ocr/route-costs.json`.
- **Rows for the estimators:** `ocr-defect-observations.jsonl` holds k-of-n rows in `failure-observations.jsonl`'s
  shape: `not_accepted_vs_opus`, `wrong_text` and `defect_<class>`. `translation-rows.jsonl` holds per-page rows with
  build-table-v2's columns, plus `accept`, `wrong_text` and `defects`.

### The draw (seeded; 30 pages per route; `sample.json` under the job scratch)

| cell | tested route(s) | reference | pages | books | frame |
|---|---|---|---|---|---|
| Latin print OCR (#5924) | lite as served | #5924 Opus correction of the same page (never written) | 30 (4 Opus left unchanged: match by construction, not called) | 9 | 225 oc-reads pages in 9 books. The wrong-leaf book (25 CONTAIN pages) is left out. |
| Chinese OCR (#6561) | Paddle draft (`page_revisions`, reason `opus_correct_6561`) | the served Opus correction of the same page | 30 | 30 | 4,379 served corrections in 781 books |
| Tibetan OCR (#6560) | Yigdzin as served; Yigdzin → Flash 3.8 low correction (never written) | Opus reads the leaf in the call | 30 + 30, same pages | 1 | the 435-page #6560 gate volume (rGyud 'bum Kha). One book, so intervals are by page. |
| German translation (#7263) | 3 Flash as served; Flash-Lite as served | Opus reads leaf + OCR in the call | 30 + 30 | 60 | 5,942 visible German books dated 1500-1800. 3 Flash: 306,784 pages in 1,245 books. Flash-Lite: 151,361 pages in 1,025 books. English newer than its OCR. |

Calls: 188, for 150 distinct pages. That is 176 judged items (180 drawn, less the 4 Latin identity rows) plus 12
controls. At route-costs' 0.0303 Claude weekly points per Opus call, that is about 5.7 points of one account-week, inside
the brief's 15% pilot budget.

### What the draw already says (measured, no judge involved)
- **Chinese tables are not in the served correction route.** Of the 4,379 pages whose served OCR is the #6561 Opus
  correction, one has a table in its Paddle draft (a markdown or HTML table). The cell therefore measures Paddle → Opus
  on ordinary text pages. The tables question (#7275, #6871) needs pages drawn from the table works themselves, and
  there production holds no Opus correction to compare against.
- **Two of the four correction routes were never served.** Latin lite → Opus correction (#5924: "No production write")
  and Tibetan Yigdzin → Flash low (#6560 gate: NO-GO) exist only as eval reads. Those cells compare the served draft
  with an eval correction of the same pages, not two served routes.
- **German has no served Opus CLI English in this frame.** The 1500-1800 German frame has 0 pages whose current
  translation model is `claude-opus-5-5`. The "Opus CLI as a new read" arm is covered by Opus reading each page as the
  reference.
- **"Batch" is not recoverable from the stored label.** 297,508 of the 306,784 3 Flash pages and all the Flash-Lite
  pages carry `translation.source: 'ai'`. The batch-vs-realtime split cannot be read from `pages`, so cell 4 compares
  the models as served.

### Not done in this run
- **No judge call** (see verdict). The gate in `judge` reads `model-limits.mjs` and refuses at ≥ 85% weekly
  (`ROUTE_JUDGE_WEEKLY_MAX`).
- **No by-eye reads.** The brief's 3 by-eye pages per route are Opus reads on the same account, so they wait with the
  judge. Nothing was contained, because no page was opened.

### To run (after the reset)
```
D=$JOB_SCRATCH/pilot   # or re-draw: the draw is seeded, but the German frame moves as pages are re-translated
node scripts/eval/route-judge-6740/judge.mjs judge --out=$D --concurrency=2
node scripts/eval/route-judge-6740/judge.mjs score --out=$D
```
