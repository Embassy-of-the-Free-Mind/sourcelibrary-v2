# #6561 Gemini review of the Opus-corrected Paddle table pages, then serve what passes

PRIOR ART: `scripts/eval/paddle-table-pilot-6388/` (the pilot's sample, review prompt, request builder and gate
scorer, reused here) and `scripts/eval/paddle-correct-6561/batch/` (the Opus-correct run that wrote the staging
collection `paddle_table_corrections_6561`). Write-up: `scripts/eval/experiments/2026-10-14-paddle-table-gemini-review-gate-6561.md`.

Run from `$JOB_SCRATCH` with `node --env-file=/root/sourcelibrary/.env.production.local`. Gemini only through
`agy -p` on main (`scripts/eval/run-cli-arm.py`, `--kind review --parallel 2 --print-timeout 240`, tool gate on).

**Step 1, the gate (ran 2026-10-14: NO-GO, 23 of 100 called invented; controls 5 of 5)**
1. `sample.mjs`: asserts the staging shape against `pages` (string `corrected_text`, its sha16 = `corrected_sha`, one
   doc per page, page still withheld for `paddle_table_6388`), downloads the images, draws 100 pages (seed 6561, one per
   book) and 5 control pages whose body has 3+ text rows; on each control one printed row is duplicated directly after
   itself (`gate-controls.json`). Writes `gate-req.jsonl` (controls mixed in, opaque uids).
2. `run-cli-arm.py --model gemini-3.8-flash-high --arm review-6561-gate --requests gate-req.jsonl --out gate-review.jsonl`;
   unparsed replies re-asked up to twice into `gate-review-r1.jsonl`, `-r2`.
3. `score-gate.mjs` → `gate-score.json` (verdict split, Wilson 95%, controls, the invented calls).
4. `record.mjs --apply` writes each reviewed page's verdict into its staging doc (`review: {...}`) and `checkpoint.jsonl`.

**Step 2, every other page (NOT RUN: the gate said NO-GO)**: `mkall.mjs` builds the requests, `run-all.sh` is the
detached resumable runner (pass 0, then two re-asks of unparsed replies; a quota stop sleeps 60 min and resumes),
`cron.sh` the hourly watcher (progress every 6 h, restart once, then start job `table-serve-6561` and remove itself).

**Step 3, serve (NOT RUN with --apply)**: `serve.mjs --gate=gate-score.json` refuses `--apply` unless the gate says GO.
Dry run on 2026-10-14 over the 77 gate pages not called invented: 77 would write, 0 skipped. Its header has the
write shape, the snapshot of the withheld state and the undo (`serve.mjs --undo`).

`results/`: the sample, the controls, the gate score, the verdicts and raw replies, the 5 invented calls read against
the image (`eye-check-invented.json`), and every page still withheld with its reason (`still-withheld.jsonl.gz`).
