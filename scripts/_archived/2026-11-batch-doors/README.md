# Archived 2026-11: hand-run Gemini Batch scripts that put model text into pages

v3#241 (v2#8590 item 3) classified the 35 files under `scripts/` that submit a Gemini batch. These
two put page TEXT into `pages` on an engine the router never chose, and nothing runs them any more.
Each one handed its batch to `scripts/workers/batch-collector.mjs` as a `batch_jobs` row of `type: 'ocr'`.
The collector writes the results of every pending row of that type into `pages.ocr`, so the script never
wrote a page itself, yet every page it submitted was written.

| Script | Why it is dead |
|---|---|
| `experiments/batch-size-experiment.mjs` | The April 2026 batch-size experiment. It OCR'd a sample of real pages on a hard-coded `gemini-3.1-flash-lite` with prompt v10, and the collector wrote the results. Its question is answered (docs/BATCH-OCR-WORKFLOW.md), and its only later commits are corpus-wide sweeps. |
| `migration/backfill-ocr-near-complete.mjs` | The one-off backfill for v2#500 (closed 2026-03-31): OCR the 1–50 missing pages of nearly translated books. The orchestrator's OCR phase is the lane for those pages now, and since #7075 this script could only submit flash-lite books anyway. Its later commits are also corpus-wide sweeps. |

Checked before the move: no caller in `git grep` (only the three page-text test allowlists, the
gemini-usage-perimeter baseline, and three docs that named them; those were updated), and no line in any crontab
snapshot (`scripts/workers/crontab.production`, `infrastructure/gex45-crontab`, `infrastructure/l7a-crontab`,
`infrastructure/lanes.tsv`), `scripts/workers/scheduler.mjs` or `.github/workflows`.

This is a **move, not a delete**. To restore one, `git mv` it back. `tests/unit/script-page-text-doors.test.ts`
will then fail until the script is a lane's file or an entry in `SCRIPT_PAGE_TEXT_DOORS` (scripts/lib/lanes.mjs).
That is the point: decide which engine reads those pages before you run it.
