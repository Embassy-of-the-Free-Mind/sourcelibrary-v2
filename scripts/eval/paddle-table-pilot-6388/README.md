# #6388 Paddle zh table pages: withhold the detector's 4,379, then a 100-page Opus re-read pilot

PRIOR ART: `scripts/eval/paddle-table-6388/` (the detector's census, the bake-off's Opus runner, review prompt and Kanripo
alignment, all reused here). Write-up: `scripts/eval/experiments/2026-10-12-paddle-zh-table-opus-reread-pilot-6388.md`.
The withhold itself: `scripts/maintenance/withhold-paddle-table-pages-6388.mjs` (its header lists the full sequence).

Run from a scratch directory (`$JOB_SCRATCH/w`) with `node --env-file=/root/sourcelibrary/.env.production.local`.

**Withhold (step 1)**
1. `census.mjs`: re-runs `paddleTableRisk` over the live Paddle pages, writes `flagged.jsonl` (in `data/` gzipped).
2. `sample.mjs 30 6388-withhold chk` + `mkreq-check.mjs` + `opus.mjs`: the 30-page by-image check of the flag
   (`review-prompt.txt`, the bake-off's review prompt). Verdicts: `data/withhold-sample-verdicts.json`.

**Pilot (step 2; reads and reviews only, nothing written to Mongo)**
1. `sample.mjs 100 6388-pilot pil --exclude=chksample.json --one-per-book --require=御定子史精華|御製增訂清文鑑`:
   one page per book, books stratified by run. The Paddle text comes from the withhold's `page_revisions` snapshot.
2. `mkreq-read.mjs`: the live default OCR prompt (`data/prompt-ref.json`) plus the table/rod/drawing addendum and
   sentinels; `opus.mjs pil-read-req.jsonl pil-read-opus.jsonl <cap> 2` (`claude -p`, subscription).
3. `../paddle-table-6388/align.mjs`: the Kanripo leaf per page (`data/align-status.json`; leaf text not committed).
4. `mkreview.mjs`: review requests (`review-prompt-pilot.txt`) and the 5 planted invented lines
   (`data/pil-review-req-controls.json`); `../run-cli-arm.py --model gemini-3.8-flash-high --parallel 2
   --print-timeout 240` (`agy -p`, subscription).
5. `score.mjs` (`data/pilot-score.json`), then `kcheck.mjs` (`data/kanripo-check-invented.jsonl`).
