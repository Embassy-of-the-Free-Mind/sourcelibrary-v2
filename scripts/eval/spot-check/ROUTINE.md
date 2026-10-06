# Fortnightly spot check — runbook and routine prompt (#5914)

PRIOR ART: `../translation-corpus-audit/MONTHLY.md` (the monthly audit's runbook; same two-stage shape — Hetzner
draws and pushes a branch, a claude.ai routine judges with Opus subagents and opens the PR). This file is that pattern
for the fortnightly image-and-book arm, and **stage 2 below is the literal instruction set the routine follows** —
edit it here, not in the routine.

## Why it exists

Derek reads one page every two weeks to see whether quality is improving, and the Quality Center (/quality, #5918)
shows the rate. Our curated quality figures come from passages that have a human reference, which are the easy ones.
A random draw read against the images (month 0, 2026-10-06: 21 of 91 pages with a serious error, ≈ 18 of 30 books
with an on-sight defect) finds what those never sample: wrong leaves, unreadable inputs translated anyway, broken books,
wrong shelves, modern editions. A fix counts when this rate falls, not when it ships.

## Design (fixed — change it only with a note in the series file)

| | |
|---|---|
| Frame | public library: `visible: true`, `pages_count > 0`, ≥ 3 translated pages (`draw.mjs --frame public`) |
| Unit | the BOOK: 10 books uniform per book (never `$sample`), then a random run of 3 consecutive translated pages |
| Seed | the draw date as `YYYYMMDD` |
| Reviewers | 2 Claude Opus subagents, 5 books each, `REVIEWER.md` verbatim, every page read against its image |
| Headline | rolling 8-week window (~40 books), 95% CI resampled by book (`score.mjs`) |
| Series | `scripts/eval/experiments/_series-fortnightly-spot-check.md` |
| Cost | $0 API: the draw is a Mongo read; the reviewers run on the claude.ai subscription (the Hetzner Anthropic key is 401) |

## Stage 1 — the draw (Hetzner cron, every other Monday, 05:00 UTC)

`fortnightly-draw.sh`: runs every Monday, skips weeks that are not a whole even number of weeks after
`ANCHOR=2026-10-19`, draws, writes `scripts/eval/results/spot-check/<date>/` (sample.json, packets/packet-1.json,
packets/packet-2.json, draw-log.json; no images) in its own clone (`/root/spot-check-work`), commits it to branch
`spot-check-<date>` and pushes. Log: `/var/log/sourcelibrary/spot-check.log`. On any failure it comments RED on #5914.

Install (after the PR that adds it merges), then verify with `crontab -l | grep '^[^#]' | grep spot-check` and, after
the first Monday, the log file:

```
0 5 * * 1 [ -f /root/sourcelibrary/scripts/eval/spot-check/fortnightly-draw.sh ] && flock -n /tmp/sl-spot-check.lock bash /root/sourcelibrary/scripts/eval/spot-check/fortnightly-draw.sh >> /var/log/sourcelibrary/spot-check.log 2>&1
```

## Stage 2 — the review (claude.ai scheduled routine, every Tuesday, 07:00 UTC)

You are the routine. You start with a fresh checkout of the repo and no other context. Do exactly this:

1. `D=$(date -u -d yesterday +%Y-%m-%d)`. Compute `DAYS` = days from `2026-10-19` to `D`. **If `DAYS` is negative or
   not a multiple of 14, this is an off week: stop with one line saying so.** (The cron runs weekly; the draw
   script skips the same weeks. The anchor here and in `fortnightly-draw.sh` must match.)
2. `git fetch origin spot-check-$D`. **If the branch does not exist:** if this file is not on `origin/main`, the setup is
   not merged yet — stop with one line saying so. Otherwise the draw failed: `gh issue comment 5914 --repo
   Embassy-of-the-Free-Mind/sourcelibrary-v2 --body "RED — no spot-check draw branch spot-check-$D; the review did not
   run (scripts/eval/spot-check/ROUTINE.md)"` (if `gh` is unavailable, push an empty signed-off commit to a new branch
   and open a draft PR with that title). Then stop.
3. Check out the branch. `DIR=scripts/eval/results/spot-check/$D`. It holds `sample.json`, `draw-log.json`,
   `packets/packet-1.json` and `packets/packet-2.json`.
4. **Review.** Launch both reviewers at once, with the Agent tool, `model: "opus"`, one per packet. Each prompt is the
   full text of `scripts/eval/spot-check/REVIEWER.md` (drop the leading `<!-- … -->` comment) followed by two lines:
   `PACKET_FILE: <absolute path to $DIR/packets/packet-N.json>` and
   `OUTPUT_FILE: <absolute path to $DIR/reviews/packet-N.json>`. Add nothing else: no summary of earlier runs, no
   hints. Do not review pages yourself and do not edit a reviewer's judgements.
5. **Completeness.** Each `reviews/packet-N.json` must parse as a JSON array with one entry per book in its packet and
   one page entry per page. If a reviewer put its JSON in its reply instead (a refused write), save that JSON to the
   file unchanged. Re-launch a reviewer once for a packet that is missing or short; after that, leave it and say so
   in the PR.
6. **Merge and score.** `node -e` concatenate `reviews/packet-*.json` into `$DIR/results.json` (an array, sample order).
   Then `node scripts/eval/spot-check/score.mjs --date $D`. Exit 0 prints the series row and writes
   `$DIR/report.json` + `report.md`. Exit 2 lists what is incomplete or malformed (a serious error with no taxonomy
   class, a missing page): re-launch the reviewer for that packet once with the same prompt, then re-score. If it still
   fails, do not add a series row; open the PR titled `… — INCOMPLETE, not reported` and stop after step 9.
7. **Rights notes stay out of the public repo.** This repository is public. For every book whose `rights_flag` is a
   note, replace the note in `results.json` and `reviews/*.json` with `true`. Nowhere public (PR, comment, commit)
   quote the reviewer's evidence; list the book only as "slot N <book_id>: rights suspect" in step 10's to-do.
8. **Series row.** Insert the printed row as the first data row of the table in
   `scripts/eval/experiments/_series-fortnightly-spot-check.md` (newest first, below the `|---|` line). Never edit
   `EXPERIMENTS.md` itself; main regenerates it (#5436).
9. Commit `$DIR` (reviews, results, report) and the series file with `git commit -s`. Push to `spot-check-$D`; if
   refused, push to `claude/spot-check-$D`. Open a PR to `main` titled
   `eval(spot-check): <D> — <window page rate>% (<ci>) of pages with a serious error, 8-week window, n=<books> books (#5914)`.
   Body: `report.md`, any packet left incomplete, `Refs #5914 #5700`.
10. **The fortnightly quality review** — a comment on #5700 (`gh issue comment 5700`), written for Derek, who reads
    one page every two weeks. Short sentences, numbers with their n. Sections:
    - **Rates.** This fortnight and the 8-week window (pages with a serious error; books with an on-sight defect), each
      with its CI, against the previous run's window (`scripts/eval/results/spot-check/<D-14>/report.json → window`).
      Say "moved" only when the CIs do not overlap; otherwise "no detectable change".
    - **Top 3 defect classes by pages × severity** (`report.json → top_classes` and `window_top_classes`), each with one
      quoted example (source → English → problem).
    - **Fixes landed and whether their kinds of text moved.** Read the rows of `scripts/eval/DECISIONS.md` whose
      *Applied in* PR merged since the previous review, and the #5700 comments since then. For each fix, name the text it
      targets (language, engine, class) and count this window's pages of that kind. Fewer than 10 such pages: say
      "too few pages to tell", not a direction.
    - **Findings with no owner.** For each serious error's class and each on-sight defect, find its owning open issue
      (`.claude/docs/page-error-taxonomy.md` lists the issue per class; else `gh issue list --search`). Name every
      class with no open owner, and any class named here last time that still has none (the closure rule: a class with
      no owner after one cycle is named in the next review).
    - **To do today (needs a session with Mongo):** broken books and rights suspects to hide with
      `scripts/maintenance/hide-named-books.mjs` (by slot and book id, no evidence quoted); serious findings to add to
      the regression set (#5913).
    - The PR link.
11. Finish with one line: the PR URL and the window rate.

## Reading a fortnight

- One fortnight is 10 books; its own rate swings by ± 15 points by chance. Read the window.
- Every rate is conditional on the frame: public books with ≥ 3 translated pages. A run with `--frame canon` is a
  different population; the scorer pools only runs with the same frame.
- Reviewers are AI reading at stored image resolution; low-confidence judgements are marked in `reviews/`.

## Operating it

- Re-run a draw by hand: `SPOT_DATE=2026-11-02 SPOT_FORCE=1 bash scripts/eval/spot-check/fortnightly-draw.sh` on Hetzner
  (refuses if the branch exists — delete the remote branch first, deliberately).
- A canon-shelf draw (outside the series): `node --env-file=.env.production.local scripts/eval/spot-check/draw.mjs
  --frame canon --date <date> --out <dir>`.
- Re-run the review: run the routine from https://claude.ai/code/routines, or follow stage 2 by hand in any session.
