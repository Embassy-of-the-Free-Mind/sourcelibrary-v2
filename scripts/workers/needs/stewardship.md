# Needs map: Stewardship

Part of [#6359](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6359) step 2. Written 2026-10-11 by job `needs-stewardship-6359`, read-only and $0.

**Purpose of this area:** the boxes, the money and the jobs keep Readable, Trustworthy and Found moving cheaply and without losing work. Stewardship is a platform for those three, not a peer, so every item below says which of them it serves.

**How it was read:** `landings.txt`, `decisions.txt` and `taken.txt` on all three job boxes (`box.sh others …`), the stored `ops_reports` rows written by `spend-daily.mjs` and `paid-vs-got.mjs` (read, not re-run), `ops_reports` `claude-limits:latest`, the ntfy topic `sourcelibrary-uptime` (12 h of cache), `gh` for issues and PRs, and the worktrees on the cloudlayer box. The main box's job logs and the private ops `DECISIONS-PENDING.md` were not readable from here.

## The number

**Share of the Gemini bill that neither the dial nor an envelope authorised.** 2026-10-10: **64%** ($27.05 of $42.31 billed; authorised $15.26). 2026-10-09: 82% ($43.08 of $52.22).

- **How measured:** the `dial` check in `ops_reports` `spend-daily-<day>` (`scripts/audit/spend-daily.mjs`, 07:00 on the main box): billed (Google's invoice export) against dial plus envelope spend. It has failed 7 days running, 10-04 to 10-10 (n = 7 days). The whole daily check has failed 9 of 9 stored days (10-02 to 10-10).
- **Why this one:** the other gauges are at or near target (see below), and this is the one that says money is leaving without a decision. On 10-10 the "other" lane was $35.96 of the $43.79 metered, and wrote no pages. The likely cause is the Phase 1.6 metadata loop found in [#4599](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4599) (about $13 a day), fixed by PR #6467, merged 10-11 15:19Z. The 10-11 and 10-12 rows will show whether it was.
- **Outside check against gaming:** the share falls if someone raises the dial or opens a wide envelope. Pair it with two numbers nobody inside the pipeline writes: billed dollars per day from the invoice, and dollars per 1,000 pages written (10-10: OCR $4.21, translation $0.68, n = 719 and 6,395 pages). If the share falls while either rises, the number was gamed.

Gauges that are holding, kept here so they are not mistaken for needs:

| Gauge | Value | n, date | Source |
|---|---|---|---|
| Job endings that landed | 109 of 113 (96%); 0 work-at-risk pages | 3 boxes, 10-09 to 10-11 16:10Z | `landings.txt`, [#6358](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6358) |
| Decisions raised per job | 0.33 (36 lines, 108 endings), down from 0.86 (176 lines, about 205 jobs) | 10-10 and 10-11 against the week to 10-09 | `decisions.txt`, [#6360](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6360) |
| Defaults taken and logged | 167 `TAKEN` lines | 10-10 and 10-11 | `taken.txt` |
| Subscription allowance used | team@ 57% of the week (resets 10-13), gmail 75%, playpowerlabs 3%, derek@sourcelibrary 3% | 10-11 16:00Z | `claude-limits:latest` |
| Disk | root free: main 28 GB, cloudlayer 55 GB, l7a 254 GB | 10-11 16:20Z | `claude-job.sh where`, [#6223](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6223) |

## Asked

- **Derek, 2026-10-09: "things drift on the Hetzner… investigate and let's improve this process."** [#6360](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6360). A page should mean his attention changes an outcome. Three of the five fixes are in the wrapper (checkpoint on exit, refuse a box at 90% of the week, take defaults); the alert half is not done (see Found).
- **Derek, 2026-10-09: jobs must land before the lane adds more of them.** [#6359](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6359). The condition was "a week of job endings shows work-at-risk pages near zero". Three days in: 0 of 113. The week ends 10-16.
- **Derek, 2026-10-11: the spare lane should balance purpose and opportunity; build the maps first.** This file, and PR #6507, which makes the lane read the maps.
- **Derek, 2026-10-09: gmail stays on the laptop, the other three accounts go on the boxes.** [#6359](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6359). Done: main is team@, cloudlayer playpowerlabs, l7a derek@sourcelibrary.
- **Spend only on approved books.** [#6205](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6205): paid steps should take an allowlist. One comment since it was filed; no PR.
- **Decisions waiting on Derek.** 36 new `DECISION` lines on 10-10 and 10-11, and 16 open `tier:hold` PRs (oldest 10-04, 5 need a rebase). The queue page is [#6258](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6258). At least five of the lines are the same ask in different words: "install this merged cron line by hand" (PRs #6434, #6428, #6047, #5960 and [#4937](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4937)). That is one defect, [#6323](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6323), not five decisions.
- **A partner reading room.** `/embed/bhutan` logged 515 render errors in 7 days (measured 10-11 on [#5075](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5075)). Nobody asked in words; the partner's readers get the failures.

## In motion

Finishing these ranks above starting anything new.

- **The spare lane itself** (#6395, closed; PR #6396). 90 jobs on 81 issues from 10-10 14:12Z to 10-11 16:10Z. 47 issues got a PR (41 merged, 6 open), 31 were skipped with a reason, 4 ended with no PR where one was expected. 9 issues were worked twice by two boxes on the same tick; the crontabs were staggered on 10-11.
  - **Did its picks serve the other three areas?** Yes, mostly. By title (my reading, not a label): Trustworthy 34 issues (15 merged PRs), Readable 15 (10), Found 8 (5), Stewardship 24 (11). So 57 of 81 picks served another area, though it picked by label order (every pick carried `bug`) and worked issue numbers downward from #6324 to #4258, not by need.
  - PR #6507 (open, `tier:auto`) switches it to the ranked maps, three picks in four.
- **Unmetered Gemini calls**, [#4599](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4599) (17 comments, active 10-11). PR #6467 and #6497 merged; PR #6499 (`tier:hold`) adds a per-project meter gap and a repeat-ask check to the daily ledger.
- **Paid batches never lost**, [#6276](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6276) and [#5499](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5499). The hourly audit pages and clears on its own (it did both on 10-11). The daily ledger still failed on 10-10: 3 batch jobs succeeded and were never collected (108 pages), 4 are in no store (35 pages).
- **Landing contract**, [#6358](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6358). Wrapper in the repo (PR #6363). Left: the backtest on the main box and the named worktrees there.
- **Disk**, [#6223](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6223). Steward and alarm merged (PR #6226). The main box crossed 85% again and recovered on 10-11 04:45Z (81%, 28 GB free). The archive scratch leak ([#4564](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4564)) got PR #6488.
- **ntfy tiers**, [#6181](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6181) (PR #6183 merged). The morning digest ran on 10-11. Of 78 messages in 12 h, 63 were low, 7 normal, 8 high.
- **Running jobs**, 10-11 16:20Z: 2 on main, 4 on l7a, 2 on cloudlayer (this one and `needs-trustworthy-6359`). PRs #6506 (Readable map) and #6507 are open.
- **Larger money work, each waiting on a decision:** Vercel cache spend [#3645](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/3645), hidden-book images to a cold tier [#5989](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5989), the move to Hetzner [#4753](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4753).

## Found, not fixed

- **A merged PR that says `Closes #n` does not close the issue when the bot merges it.** Of 40 issues named as closed by `tier:auto` PRs merged by `github-actions` since 10-08, 38 are still open (measured 10-11; no issue). `auto-merge.yml` grants `contents`, `pull-requests` and `actions` but not `issues`, which is the likely cause; I did not confirm it. Effect: the open count (700) overstates the backlog, and every map and picker that reads "open" re-offers finished work.
- **`/embed/bhutan` pages as DOWN about once an hour and no one owns the fix.** 7 high-priority pages in 12 h on 10-11, all "streamed render error". PR #6461 added the index to the manifest; the index is not built until someone runs `ensure-indexes.mjs --apply` on prod, which the job logged as a decision. [#5075](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5075).
- **Merged cron lines never install.** [#6323](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6323): the repo's crontab file says it is auto-applied and nothing applies it. The lane skipped it (hold list). Each new scheduled check becomes a hand step and a decision line.
- **Nothing alarms when cron on the main box dies.** [#4528](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4528): a 25 h outage went unnoticed. Skipped by the lane (hold list); no owner.
- **"Stale worker needs you" repeats hourly for the same two processes.** 4 pages in 12 h for `embed-gemini` pid 2629492 and `mirror-changelog`, both "held" because cron started them, so the restart script can never act. Owner on the page is [#6360](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6360); no one is working it.
- **The spare lane writes decision lines.** 10 of the 36 lines on 10-10 and 10-11 came from `spare-*` jobs. Its charter says it adds nothing to Derek's queue.
- **Work at risk on the cloudlayer box, unseen by the pager.** `job-split-wave1-6114`: its HEAD is on no remote branch and 3 files are uncommitted (last commit 10-07, job stopped). `job-embed-integrity-6175b`: 7 uncommitted files. `/root/wt-ia-5679`: 6 untracked logs. These predate the checkpoint fix. No issue.
- **Seven jobs gave up on 10-07 and were not re-run.** [#5354](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5354) names them. No one has checked which are superseded.
- **Machines with no lease, flagged every day since 10-02.** Two Scaleway containers (€21 a month together) and `HCLOUD_TOKEN` unset, so the Hetzner machine check reads UNKNOWN. The owning issue (#5743) is closed. No open issue.
- **Stored spend.** 54 envelopes, 41 with room: $4,033.83 authorised and unspent (10-10). 27 are near cap or idle. Envelope expiry is [#5827](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5827), on hold.
- **Brakes that do not brake.** [#5492](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5492): pausing `ocr` or `images` pauses nothing. Skipped by the lane.
- **A fix to the OCR Lambda does not ship when merged.** [#4600](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4600). Skipped by the lane.
- **Homepage copy merges by machine.** [#5792](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5792): `pr-tier` labels it `tier:auto`. No comments since it was filed.
- **Two open security items on the boxes.** Gemini CLI jobs ran as root with tools auto-approved ([#6345](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6345)); the embedding server takes unauthenticated requests ([#6206](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6206)).
- **Wrapper gaps with no activity since 10-08:** preflight auth ([#5627](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5627)), memory admission ([#5709](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5709)), rebase of stuck `tier:auto` PRs ([#5710](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5710)).

## Surprising

- Paid volume fell sharply while pages kept arriving. Gemini wrote 120,000 to 300,000 pages a day on 10-02 to 10-07 and 7,114 on 10-10. On 10-10 the $0 lanes wrote 104,134 pages (Paddle OCR 87,001, CLI translation 17,133). The cheap lanes now carry the volume, and none of their pages are stamped with cost or tokens.
- With the dial at $5 since 10-04, more money is spent outside every envelope ($27 to $34 a day) than inside (about $4 to $10).

The ranked queue is in `stewardship.json`.
