Lands: #6561
PR: yes

# #6561 follow-ons, part b: everything that waited for the agy Gemini quota (job stale-correct-6561-b, on main)

Started by `main-cron.sh` (job stale-correct-6561, 2026-10-15) when agy Gemini answered again. Every agy Gemini model
had answered "Individual quota reached" since 2026-10-14 13:06 UTC (the message's "resets in 30m" was false for over a
day; it answered again from about 15:00 UTC on 2026-10-15). Job stale-correct-6561's comments on #6561 say what
it already did; read them first. Its PRs: #6749 (item 1 pilot, runbook, crons), #6748 (item 2's `--withheld` mode,
stacked on #6598), #6747 (item 3, the detector). Derek's answers of 2026-10-13 and 2026-10-15 stand: Claude is the final arbiter, and a Gemini
call alone withholds nothing.

Claim: comment "taking this (job stale-correct-6561-b)" on #6561. Report ONLY by comments on #6561 / #6567 and the PRs.
`node --env-file=/root/sourcelibrary/.env.production.local`. Claude ONLY via `claude -p` on the subscription
(`/usr/bin/claude`: on main `/root/.local/bin/claude` is a stale 2.1.31 whose `opus` is Opus 4.5). Gemini ONLY via
`agy -p` on main. No Gemini API, no money. agy capacity is the binding constraint: on 2026-10-13/14 it gave about
19,200 Gemini calls, then nothing for over a day. Spend it in this order and stop each stage cleanly on a quota wall
(a 429 is a pause, never a verdict): A, B, then whatever the 50,387-page run (`stale-retranslate-6567.mjs run`, still
running from /root/stale-resume-6567) needs; it resumes on its own.

Scratch from part a: `/mnt/HC_Volume_105839809/jobs/stale-correct-6561/` (item1/, item2/). Use your own $JOB_SCRATCH
for new output.

## A. Item 2: the 1,320 withheld English pages of the served table pages
- Code: `scripts/batch/stale-retranslate-6567.mjs` with the `--withheld` mode, branch `job-stale-correct-6561-withheld`
  (PR #6748, stacked on #6598). Use a worktree of that branch.
- The set is already selected (read-only census, 2026-10-15: 1,320 eligible pages, 270 books):
  `/mnt/HC_Volume_105839809/jobs/stale-correct-6561/item2/{census.json,set.jsonl}`. Re-run `select-withheld` into a
  fresh dir first if more than a day has passed, and say if the count moved.
- Run: `run --withheld --out=<dir> --parallel=2 --apply` (agy 3.8 Flash low, 1 page/call, the run's guards; book holds
  untouched). A headless job cannot wait: detach it (`setsid nohup`) and wait in the foreground with an until-loop
  (each call <= 10 min) on its exit. Pages still withheld (`ocr.unreadable`) are skipped by the mode.
- Judge: 20 written pages at random, one per book (seed 6561). Opus (`claude -p --model opus`, Read only) judges them
  BLIND against the page image, 5 pages per call, with 2 planted controls mixed in across the calls (a written page
  whose English has one fluent sentence inserted that the Chinese does not say; record which). Per page: the verdict
  clean / minor / material / invented-or-wrong-page, and the spans. Report on #6561 with n, the rate and the Wilson
  95% interval, the controls caught, and 3 links you opened. `.claude/docs/quality-statements.md` governs wording.

## B. Item 1: the pilot's Gemini review (evidence for Derek's decision; the run itself is NO-GO)
Part a's over-correction gate FAILED as written (details in its #6561 comment; `results/` in its PR):
- arm v1 (the experiment's prompt): 9 of 60 Kanripo-scored pages made worse by > 0.5 pt (15%);
- arm v2 (v1 + "keep the page's own character forms; no notes of your own", `prompt-v2.mjs`): 4 of 60 on the same
  pages, but 5 of 40 (12.5%) on a fresh held-out draw. Read beside the gate, almost every "worse" page is a swap
  between variant forms of one character or a printed seal Kanripo omits; part a did not move the gate.
So the full Opus run was NOT started. Derek decides (DECISION line on #6561). This stage only gathers the other half
of the evidence, on the v2 corrections:
- The review requests are built: `item1/review/gate-req.jsonl` (the 100 v2-corrected pilot pages + 5 planted
  duplicated-row controls from the v2 supplement, unmarked), `gate-sample.json`, `gate-controls.json`. From that dir:
  `python3 <repo>/scripts/eval/run-cli-arm.py --job stale-correct-6561-b --model gemini-3.8-flash-high --kind review
  --arm stale-pilot-review --requests gate-req.jsonl --out gate-review.jsonl --parallel 2 --print-timeout 240`
  (exit 3 = quota: wait and resume; it skips done uids). Re-ask unparsed replies twice (`gate-review-r1.jsonl`, ...).
- Score: `node <repo>/scripts/eval/stale-correct-6561/score-gate.mjs` in that dir → `gate-score.json`.
- Arbitrate every page Gemini calls invented (Derek 2026-10-15): open the image (Read) and, where `item1/pilot-align.jsonl`
  has an `own` leaf, count the span in the Kanripo leaf (`scripts/eval/paddle-review-6561/arbitrate-kanripo.mjs` on
  PR #6744 is the prior art). Your ruling, not Gemini's, decides. Record each ruling (page, span, evidence, verdict).
- Report on #6561: controls caught (of 5), invented after arbitration (of 100) with the Wilson interval, beside part
  a's over-correction numbers. Do not start the full run unless an inbox note or a #6561 comment from Derek says so.

## C. Only if Derek says go: the full run and the serve
- Run: `prep.mjs` in a fresh scratch dir, then `shard.mjs <box>` (weights main 50 / cloudlayer 30 / l7a 20), the v2
  prompt (`prompt-v2.mjs`, copy prompt-v2.json over each shard's prompt.json) unless Derek picks v1, and per box
  `box-cron.sh` (its header has the cron line; `start` starts the runner; `CLAUDE_BIN` must be a current CLI). On
  cloudlayer and l7a, through the mesh: `/root/bin/box.sh <box> start <name>` with a brief on stdin.
- Serve path: `scripts/eval/paddle-correct-6561/batch/review-brief.md` Step 3, adapted to these pages (they are NOT
  withheld: guard instead on `ocr.source === 'paddle'`, the same text as the staging doc's `paddle_text`, and no human
  edit). `page_revisions` snapshot first (reason `opus_correct_6561_stale`), provenance naming the Opus run, arm,
  draft, image and reviewer/arbiter, a `sweep_log` row per page (sweep `serve-stale-correct-6561`), per book
  `recountBook` + `book_events` + `sync-pages-content.mjs`. Dry run, 20-page canary, open 3 in the reader.
- Item 4: the corrected page's English was made from the reading that just changed, so it must stay marked stale:
  keep (or set) `translation_stale` with lane `paddle-zh-2026-10`, reason `ocr_rewritten`. Check the reader and the
  hourly `withhold-stale-translations` sweep treat it as stale.
- Per-page Gemini review (the 2026-10-13 brief) costs ~24,700 agy calls plus Claude arbitration of every invented call;
  ask Derek (it is in part a's DECISION lines) before starting it.
- Retranslate the served pages only AFTER the 50,387-page run has exited (the script needs a mode for them, as
  `--withheld` was added: their `ocr.source` is no longer `paddle`). 1 page/call, agy.

## D. Crons
A headless job cannot wait: every long stage is a detached runner plus an hourly cron that comments every 6 h and
starts the next stage, then removes itself. Verify each cron by its non-comment line and a `DRY=1` run.

## Land
Comment on #6561 (and #6567 where it belongs) with what ran, what is waiting and how to check it. New scripts in a PR.
Touch /root/claude-jobs/stale-correct-6561-b.done at the end.
