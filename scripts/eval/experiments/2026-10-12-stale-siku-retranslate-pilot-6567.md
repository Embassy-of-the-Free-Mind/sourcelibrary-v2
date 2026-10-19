---
stage: translation
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 289
n_pages: 30
verdict: "The 300-page pilot of the stale-Siku retranslation (3.8 Flash via the CLI, production prompt, CER < 0.1) wrote 289 pages with 0 failed reads. On 30 random written pages the new English beats the stored English under both blind judges (Opus 0.97 → 0.17 material errors per page, Gemini 3.1 Pro 2.77 → 1.53), but Pro's 1.53 fails the pre-registered GO bar of ≤ 0.5. Most of Pro's material errors cite Chinese the Paddle reading does not have, so they come from the reading, not the translation. The run stopped at the pilot."
status: undecided
decision: null
superseded_by: null
issue: [6567, 6561, 6388]
---
## 2026-10-12 · Stale Siku retranslation, pilot and 30-page review (#6567)

PRIOR ART: `2026-10-12-stale-siku-english-gate-6567.md` (PR #6581) set the rule: retranslate the stale pages below an
old-vs-new CER of 0.1, and hold the rest for the OCR fix (#6561). This entry is the first production step under that
rule. The brief's GO test: material errors per page in the new English ≤ 0.5 under both judges (the gate measured
0.00 under Opus and 1.05 under Pro). Code: `scripts/batch/stale-retranslate-6567.mjs` (select, pilot, run) and
`scripts/eval/stale-retranslate-6567/review.mjs` (judge prep and scoring). Reads and the score: `scripts/eval/stale-retranslate-6567/`.

**Set (census 2026-10-12, `census.json`).** 75,543 stale pages carry `translation_stale.lane = paddle-zh-2026-10`.
- 24,837 pages are at CER ≥ 0.1 and are held for the OCR fix. 30 pages have fewer than 8 Han characters.
- 0 pages were excluded for `ocr.unreadable` (#6574 tables), withheld English, a human edit, or the table detector.
- **Held books.** All 738 eligible books carry the lane's own `paddle-zh-*-ocr-only` hold. Its release condition is
  this approval, so the hold does not exclude them. Books held for any other reason would be excluded; there are 0.
  The run does not release the hold, because the hold is what keeps the paid lanes and gap-fill off these books.
- **Eligible: 50,676 pages in 738 books** (0–.05: 34,721; .05–.1: 15,955), matching the gate.

**Pilot.** 300 pages, one per book, seeded (`pilot-ids.txt`). Each page used one `agy -p` call to 3.8 Flash (low),
with the production prompt (Standard Translation v13, hash `516510147237…`), the gate's CLI suffix, the #6523 sentinels
and the tool gate. Pages ran in order inside each book, 3 calls in flight.
- **Written: 289.** Skipped: 11, all `not translatable: no-body`. Failed reads: 0. Tool calls: 0.
- Two box-wide quota pauses of 20 min each happened at 03:41 and 04:01 UTC. The quota is shared, and every job on the
  box hit the 429.
- Every write has a `page_revisions` snapshot (289), a provenance block (api `cli`, `agy 1.3.3`, model, prompt
  id+version+hash, sent hash, run `stale-retranslate-6567-pilot`), a `sweep_log` row (289) and a `book_events` row
  (289). `translation_stale` is cleared on all 289.
- **Nothing was queued.** All 289 books are still `held`, no job rows were created for them, and the only new
  `book_events` rows are this run's own.
- **Live check.** 3 reader pages serve the new English: Dongtian aozhi vol 5 p63, vol 3 p17, and Daozang catalogue
  vol 3 p20.

### Review: 30 random written pages, blind

Opus (`claude -p`) and Gemini 3.1 Pro High (`agy -p`) each judged the pages against the image and the Paddle reading,
using the gate's MQM prompt. Each page showed, labelled in a seeded random order:
- the NEW English;
- the OLD English, from the snapshot;
- on 6 pages, a PLANT: the new English with one number word changed.

A **material error** is an accuracy error of major or critical severity. No read failed.

| judge | NEW material / page | pages with a material error | OLD material / page | new better / worse than old | plants caught |
|---|---|---|---|---|---|
| Opus | **0.17** | 4/30 (Wilson 5–30%) | 0.97 | 15 / 0 | 6/6 |
| Gemini 3.1 Pro | **1.53** | 19/30 (Wilson 46–78%) | 2.77 | 16 / 5 | 6/6 |

**GO test (≤ 0.5 under both judges): NO.** It fails under Pro.

**Where Pro's errors come from.** This is a heuristic (`cause-split.mjs`): an error counts as reading-caused when the judge says the
reading is wrong, or quotes a run of Han characters that is not in the Paddle reading.
- 36 of Pro's 46 material errors are reading-caused, on 16 pages. They are misread characters and names that the
  translation followed faithfully: 伏虎 read as 伏霓 (p21), 吳 as 昊 (p28), and 一帖 as 二帖 (p23).
- That leaves about 10 translation-only errors, **0.33 per page**.
- Under Opus, 3 of 5 errors are reading-caused, which leaves 0.07 translation-only errors per page.

The gate saw the same split. Its 2 of 16 under-0.1 pages with a material OCR error were confirmed by a referee. The
judges here are unrefereed and one pass, and Pro also flags characters it may itself misread. So the 16/30 figure is
an upper bound on the reading-error rate, not a measurement of it.

### Limits
- n = 30. There is one judge pass and no referee.
- The cause split is a string heuristic, not an alignment.
- A plant is caught when the judge's quote contains the planted word. On a page where that word also occurs naturally,
  this could over-count.
