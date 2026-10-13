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
