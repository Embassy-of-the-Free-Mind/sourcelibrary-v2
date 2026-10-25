# #6561 Paddle zh: correct flagged pages vs a full Opus re-read

PRIOR ART: `scripts/eval/paddle-table-pilot-6388/` (PR #6574: the withheld table pages, the pilot's Opus re-reads,
its read prompt and Kanripo leaves, all reused), `scripts/eval/paddle-table-6388/align.mjs` (Kanripo leaf per page),
`scripts/eval/paddle-stale-english-6388/census.mjs` (the stored second read), `scripts/eval/run-cli-arm.py` as fixed in
PR #6571 (#6523: tool gate; run with `--no-sentinels` because these prompts carry their own sentinel lines).
Write-up: `scripts/eval/experiments/2026-10-12-paddle-zh-correct-vs-redo-6561.md`.

Run from a scratch directory (`$JOB_SCRATCH/w`, `node_modules` symlinked) with
`node --env-file=/root/sourcelibrary/.env.production.local` for the Mongo reads. Nothing is written to Mongo.

1. `draw.mjs <census.jsonl.gz>`: set B (30 random + 30 where Paddle and the stored second read disagree), images.
2. `../paddle-table-6388/align.mjs candB.jsonl alignB.jsonl`: the Kanripo leaf per set-B page.
3. `mkreq.mjs <pilot-w-dir>`: set A (40 of the pilot's own-aligned table pages), the 10 planted-error drafts, and the
   request files: `req-opus-correct`, `req-agy-correct` (Pro and 3.8 Flash high), `req-opus-redo` (set B; set A reuses
   the pilot's reads), `req-agy-second` (3.8 Flash low, the cheap second read used as a flag signal).
4. `opus.mjs <req> <out> <cap> 1` (`claude -p --model opus`) and `run-cli-arm.py --model gemini-3.1-pro-high |
   gemini-3.8-flash-high | gemini-3.8-flash-low --kind ocr --no-sentinels --parallel 1` (`agy -p`). Two calls in flight.
5. `score.mjs <pilot-w-dir>` → `results/score.json`.
6. `readoff.mjs build`, run `ro-req-gem.jsonl` on 3.8 Flash high and `ro-req-opus.jsonl` on Opus, `readoff.mjs score`
   → `results/readoff.json` (the recitation check).
7. `coverage.mjs 200` (Kanripo screen coverage of the lane), `project.mjs` → `results/projection.json`.

## Sonnet and Haiku arms (#6667)

Same pages, drafts, plants and prompt as the Opus correct arm; write-up
`scripts/eval/experiments/2026-10-13-sonnet-haiku-correct-vs-opus-6667.md`.

1. `rebuild.mjs --dir=<kanripo cache dir>`: the #6561 scratch is gone, so this rebuilds `sets.json`, `anchors.json`
   (with the planted drafts), `req-correct.jsonl` and the images from `results/draw.json`, `results/anchors.json`, the
   pilot sample and the live OCR prompt (hash-checked against `results/prompt-ref.json`). Check it by scoring the
   committed `out-*.jsonl.gz` (gunzipped into the scratch dir): the result must equal `results/score.json`.
2. `opus.mjs req-correct.jsonl out-sonnet-correct.jsonl <cap> 1 sonnet` and the same with `haiku`: the fifth
   argument is the model (default `opus`); each model keeps its own ledger and workspace.
3. `score.mjs <dir holding the pilot's read-opus.jsonl as pil-read-opus.jsonl>`: now also scores `sonnet-correct` and
   `haiku-correct` and adds `vs_opus_correct` (paired Δ CER, 95% bootstrap over books) to every arm's summary.
   Output of that run with all arms: `results/score-6667.json.gz`. Meter readings: `results/meter-6667.json`.

## The batch: Opus correct over all 4,379 withheld table pages (`batch/`, job table-correct-6561)

Derek's "yes" of 2026-10-13 on #6561. Opus runs on cloudlayer (derek@playpowerlabs), files only; the review and the
serve are a second job on main (`batch/review-brief.md`, written out in full).

1. `batch/prep.mjs <flagged.jsonl.gz>`: the work list (`pages.jsonl`: every page still withheld with reason
   `paddle_table_6388`, its image URL and the Paddle text from the withhold's snapshot) and `prompt.json`. It rebuilds
   the correct prompt from the live OCR prompt and refuses to run unless it hashes to `results/prompt-ref.json`.
2. `batch/run.mjs`: `claude -p --model opus`, one page per call, 2 in flight. Checkpoint `out.jsonl` (one row per
   attempt: page_id, book_id, outcome, corrected text and its hash). A reply is accepted only if it came from Opus,
   opened the image, has the three sentinels with nothing outside them and passes `ocrReadProblem`. Pauses above 85%
   weekly use (`claude-job.sh where`), sleeps 30 min on a limit, tries a page 3 times, writes `runner.done` at the end.
3. `batch/status.mjs [dir]`: progress, as markdown.
4. `batch/upload.mjs [--apply]`: accepted corrections to Mongo `paddle_table_corrections_6561` (staging; nothing
   reads it but the review job), read back and hash-checked.
5. `batch/cron.sh` (hourly on cloudlayer, `DRY=1` to rehearse): restarts a dead runner, comments progress every 6 h,
   and when the runner finishes uploads, starts `table-review-6561` on main through the box mesh, and removes itself.

## gemini-3.1-flash-lite arms (#7263)

Same rebuilt pages, drafts and plants; runner and P2 prompt in `scripts/eval/lite-correct-gpu-7263/` (PREREG there).
`out-lite-correct` (the Gemini arms' correct prompt, image attached), `out-lite-noimg-correct` (no image),
`out-lite-correct-r2` (repeat, 10 pages), `out-lite-p2-correct` (production-shaped prompt; `out-lite-p2-raw` is the raw
reply, `p2-post.mjs` turns it into the scored row). `score.mjs` scores them beside the committed arms and adds
`vs_paddle_ci95` and `wreck` to every arm's summary: `results/score-7263.json.gz`. Write-up:
`scripts/eval/experiments/2026-10-24-lite-corrects-gpu-drafts-7263.md`.
