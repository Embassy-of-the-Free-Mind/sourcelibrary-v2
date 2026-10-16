# #6561 item 1: Opus-correct the high-change stale Siku pages (runbook)

PRIOR ART: `scripts/eval/paddle-correct-6561/batch/` (the table run: run.mjs, prompt.mjs, upload.mjs, status.mjs,
cron.sh, review-brief.md), reused; this directory adds the stale-page frame, the over-correction gate, sharding across
boxes and the crons. Write-up: `scripts/eval/experiments/2026-10-15-stale-siku-opus-correct-pilot-6561.md`.

**State on 2026-10-15 (job stale-correct-6561):** the pilot ran. The over-correction gate FAILED as written: v1 had
9 of 60 pages made worse, and v2 had 5 of 40 on the held-out draw. So the full run was **not** started; Derek
decides. Nothing has been written to `pages`.

Run everything from a scratch dir with `node_modules` symlinked, `node --env-file=/root/sourcelibrary/.env.production.local`
for Mongo, and `CLAUDE_BIN=/usr/bin/claude` on main. On main, `/root/.local/bin/claude` is a stale 2.1.31 whose `opus`
is Opus 4.5. run.mjs now refuses non-Opus-5 replies.

1. `prep.mjs [--pilot=100]` builds the frame (stale pages, old-vs-new CER >= 0.1, eligible): `frame.jsonl`,
   `census.json`, the hash-checked `prompt.json`, `pilot/` and `rest/`. It reads only.
2. `prompt-v2.mjs` writes `prompt-v2.json` (v1 + the character-forms / no-notes rule). Copy it over a shard's
   `prompt.json` to run v2.
3. Run `../paddle-correct-6561/batch/run.mjs --par=2 --run=<name>` in a dir holding `pages.jsonl` + `prompt.json`.
   It writes files only.
4. `../paddle-table-6388/align.mjs cand.jsonl align.jsonl` gives each page's Kanripo leaf. Then
   `overcorrect.mjs out.json dir:align.jsonl ...` scores the gate: made worse by > 0.5 pt on <= 10% of the pages that
   have a trusted own leaf.
5. `review-sample.mjs <pilot dir> <supp dir>` builds the Gemini review requests (100 + 5 controls). Run them with
   `run-cli-arm.py`, then score with `score-gate.mjs` (copied from PR #6744).
6. Full run, only on GO: `shard.mjs <main|cloudlayer|l7a>` (by book; the pilot pages are left out), and on each
   box `box-cron.sh`. Its header has the cron line and `start`. The cron restarts the runner, comments every 6 h,
   and at the end uploads to staging `stale_corrections_6561` with `upload.mjs --coll=…`, comments, and removes
   itself.
7. `main-cron.sh` (installed on main as a copy in `/mnt/HC_Volume_105839809/jobs/stale-correct-6561/state/bin/`):
   - waits for agy Gemini to answer, then starts job `stale-correct-6561-b` with `brief-b.md` (item 2's run and
     judge, and the pilot's Gemini review);
   - when the 50,387-page stale run exits complete, retries its failed pages once (item 5) and reports on #6567;
   - removes itself when both are done.

   Check it with `crontab -l | grep stale-correct-6561-main-cron` and
   `tail /mnt/HC_Volume_105839809/jobs/stale-correct-6561/state/main-cron.log`.
