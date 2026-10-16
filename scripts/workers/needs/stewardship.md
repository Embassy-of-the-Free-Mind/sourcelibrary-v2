# Needs map: Stewardship

Part of [#6359](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6359) step 2. First written 2026-10-11 by job `needs-stewardship-6359`; refreshed 2026-10-16 by job `needs-refresh-stewardship-6359`, read-only and $0.

**Purpose of this area (Derek, 2026-10-16):** every page a reader opens reads right, hardest books first, paid for with subscription capacity that would otherwise go unused. The measure is verified pages per week, weighted by difficulty and readership, not jobs finished. Stewardship is the platform under that: the boxes, the money and the jobs. It keeps Readable, Trustworthy and Found moving cheaply and without losing work, so every item below says which of them it serves.

**How it was read:** the main box's `landings.txt`, `decisions.txt`, `taken.txt` and `claude-job.sh status` (read locally; the other two boxes were not reachable, so their ledgers are not counted here). Also the stored `ops_reports` rows `spend-daily-<day>` and `paid-vs-got-<day>` (read, not re-run), `claude-limits:latest`, and the main box's live crontab. Issues and PRs came from `gh`, and from comments on issues active since 10-11.

## The number

**Share of the Gemini bill that neither the dial nor an envelope authorised.** 2026-10-15: **87%** ($55.22 of $63.46 billed; authorised $8.24). The five days from 10-11 to 10-15 come to 53% ($134.39 of $254.35). Leave out 10-11, the one day big envelopes ran, and 10-12 to 10-15 come to 77% ($102.59 of $132.83). Then (10-10, revised invoice): 70% ($35.97 of $51.23); the first map quoted 64% from the unrevised invoice.

- **How measured:** the `dial` check in `ops_reports` `spend-daily-<day>` (`scripts/audit/spend-daily.mjs`, 07:00 on the main box). It compares billed (Google's invoice export, revised the next day) with dial plus envelope spend. Each day's figure is from the latest stored revision. The daily check has failed on every stored day, 10-02 to 10-15 (n = 14).
- **What changed:** the Phase 1.6 loop is gone. #6467 merged on 10-11, and metered spend outside envelopes fell from $27 to $38 a day to $5.64 to $28.23. But billed now runs ahead of metered: 10-13 billed $40.37 against $8.14 metered, and 10-15 billed $63.46 against $31.47. Money no meter sees is now the larger part. The known suspect is the unmetered caller on the `booksplit` key ([#4599](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4599)).
- **Outside check against gaming:** the share falls if someone raises the dial or opens a wide envelope. Pair it with billed dollars per day (10-12 to 10-15: $21.08, $40.37, $7.92, $63.46) and with dollars per 1,000 pages written. On 10-15 that was OCR $1.58 (2,396 pages) and translation $1.01 (87 pages); on 10-10 it was OCR $4.21 and translation $0.68. If the share falls while either of those rises, the number was gamed.

Gauges that are holding, kept here so they are not mistaken for needs:

| Gauge | Value | n, date | Source |
|---|---|---|---|
| Job endings that landed (main box) | 70 of 76 ok, 6 REPORT, 0 work at risk | 10-12 to 10-16 | `landings.txt` |
| Decisions raised per job (main box) | 0.64 (49 lines, 76 endings); 0 from `spare-*` jobs since 10-12 | 10-12 to 10-16 | `decisions.txt` |
| Defaults taken and logged (main box) | 234 `TAKEN` lines | 10-12 to 10-16 | `taken.txt` |
| Paid vs got ledger | PASS 10-13, 10-14, 10-15; measured waste 0.4% on 10-15 (58% on 10-11) | 3 days | `paid-vs-got-<day>`, [#5499](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5499) |
| Subscription week used | team@ 48% (resets 10-20), gmail 63% (10-20), playpowerlabs 91% (10-17), derek@sourcelibrary 15% (10-22) | 10-16 16:30Z | `claude-limits:latest` |
| Disk | main root 27 GB free (82%) after two fills to 95–100% the same day | 10-16 16:40Z | `df`, [#6223](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6223) |

## Asked

- **Derek, 2026-10-16: verified pages per week, hardest books first, on subscription capacity that would otherwise go unused.** This refresh ranks by that. The capacity half moved this week: `job-where.sh` now places jobs by the account's Claude headroom (PR #6784), and the spare lane falls through to an Opus-only audit round when its labels run dry (PR #6785). playpowerlabs went from about 43% due to lapse on 10-15 to 91% used on 10-16.
- **Derek, 2026-10-09: "things drift on the Hetzner… investigate and let's improve this process."** [#6360](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6360). Repeat stale-worker pages are deduped per pid (PR #6526, merged 10-11). The issue still reads open; see the first item under Found.
- **Derek, 2026-10-09: jobs must land before the lane adds more of them.** [#6358](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6358). The week ended 10-16. On the main box, 0 of 76 endings left work at risk (10-12 to 10-16). PR #6527 stopped squash-merged commits from reading as at risk.
- **Accounts on boxes.** As of 10-15, main is team@ (PR #6741), cloudlayer is playpowerlabs and l7a is derek@sourcelibrary. From 10-16, main and the laptop share team@, so interactive sessions and up to 10 main-box jobs draw on one 5-hour window. Job `stale-correct-6561-b` GAVE-UP on that limit on 10-16.
- **Spend only on approved books.** [#6205](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6205). No activity since 10-09; no PR.
- **Decisions waiting on Derek.** 24 open `tier:hold` PRs (oldest 10-04, 3 conflicting, 4 labelled `needs-rebase`), up from 16 on 10-11. The routing-drift detector ([#6716](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6716)) lists 13 PENDING `DECISIONS.md` rows older than 14 days. The queue page is [#6258](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6258).

## In motion

Finishing these ranks above starting anything new.

- **The spare lane** now reads the needs maps (PR #6507, merged 10-11). It falls through to the #6420 audit when an account is in its last 48 h with allowance left (PR #6785, closes [#6781](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6781)). Placement uses headroom (PR #6784, [#6751](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6751)). Both issues are closed.
- **Disk**, [#6223](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6223). On 10-16 the main box's root filled twice from agy's SQLite WAL (`/root/.gemini/antigravity-cli/conversation_summaries.db-wal`, 1 GB to 20 GB in under 7 h). Concurrent agy calls keep the database open, so it never checkpoints, and disk-steward skips `.gemini` because it was written recently. An hourly `agy-wal-checkpoint.py` cron is now on main's live crontab only: it is not in the repo or `infrastructure/hetzner-crontab`, and not on the other two boxes, which now run agy too. Disk-steward also links copies it already made (PR #6530).
- **Unmetered Gemini**, [#4599](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4599). Envelopes now expire and meter only their own lane (PR #6513). Derek's default on 10-11: the meter-gap check stays a FAIL. PR #6499 (`tier:hold`, open) adds it. The `booksplit` caller is still unfound; the spare box cannot read Cloud Monitoring.
- **Embedding re-runs**, [#6628](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6628). About $250 was spent on 10-07 to 10-12 re-embedding the same pages. The fix (PR #6629) merged, and the cron was re-enabled on 10-13 with Derek's approval. The issue is open pending a check that runs now skip.
- **Work board**, PR #6830 (open, `tier:auto`). The main box's jobs have been missing from `/admin/work` since 10-16 00:10Z, because `work-board-push` read the ARM guests' job folder (98 failures).
- **Gemini CLI capacity.** agy is installed on all three boxes, and on 10-16 the CLI ran at its 5-hour ceiling. The $0 lanes (CLI translation, Argon pilots #6729, #6731, #6769, the #6420 audit) are now bound by that window, not by money.
- **Running on main**, 10-16 16:40Z: 5 live jobs (`consciousness-l2`, `finish-6559`, `g4-reread-6769`, and the found and stewardship map refreshes); 27 DONE since 10-15.
- **Larger money work, each waiting on a decision:** Vercel cache spend [#3645](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/3645), the hidden-book image cold tier [#5989](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5989), the move to Hetzner [#4753](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4753).

## Found, not fixed

- **A merged PR that says `Closes #n` does not close the issue when the bot merges it. It still happens.** In PRs merged since 10-12, 39 of 42 closing links merged by `github-actions` left the issue open; 0 of 12 merged by a person did (GraphQL `closingIssuesReferences`, 10-16). #6360 and #6358 are examples. `auto-merge.yml` grants `contents`, `pull-requests` and `actions` but not `issues`, which is the likely cause; I did not confirm it. Every map and picker that reads "open" re-offers finished work (696 open issues). No issue.
- **The agy WAL fix exists only as a hand edit on one box.** See Disk above. Every box that runs agy can fill its root the same way, and a crontab restore loses the fix. Part of [#6223](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6223) and [#6323](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6323).
- **Billed runs ahead of metered.** On 10-13 and 10-15, Google billed $32 more than we metered each day. [#4599](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4599).
- **Merged cron lines still never install.** [#6323](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6323), no activity since 10-10. This week's live crontab edits were the embed-gemini hold on 10-12, its re-enable on 10-13 and the agy checkpoint on 10-16. All were made by hand, and the repo file knows none of them.
- **Nothing alarms when cron on the main box dies.** [#4528](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4528). Unchanged.
- **The laptop and the main box share one Claude account.** A busy job day can block Derek's own session, which the #6359 design meant to prevent by reserving an account for the laptop. No issue.
- **Stored spend grew.** Expiry halved the envelopes (54 to 27), but authorised and unspent rose from $4,033.83 to $4,290.54 across 16 with room (10-15). $1,999.19 of it sits in `stubs4719-ocr-2026-10`, with no spend on its books for 3+ days. [#5827](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5827).
- **Machines with no lease, flagged every day since 10-02.** Scaleway `makemode-workspace-pilot` (€15 a month) and `makemode-forgejo` (€7 a month); `HCLOUD_TOKEN` is unset, so Hetzner reads UNKNOWN. [#5743](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5743) is open again.
- **Seven jobs gave up on 10-07 and were not re-run.** [#5354](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5354). On 10-11 the spare lane found two of them likely landed (`embed-repair-6175`, `tib-bl-evidence-4523`). The rest need a re-dispatch call.
- **Stranded cloudlayer work.** `split-wave1-6114`'s commit was pushed on 10-11 (5fb10182d); its `prep.sh` is still uncommitted. `job-embed-integrity-6175b` and `/root/wt-ia-5679` were not rechecked (no ssh from here).
- **Unchanged since 10-11, all on the hold list:** brakes that do not brake ([#5492](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5492)), the OCR Lambda with no CI ([#4600](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4600)), homepage copy merging by machine ([#5792](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5792)), Gemini CLI as root with tools auto-approved ([#6345](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6345), now on three boxes), and the wrapper gaps [#5627](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5627), [#5709](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5709) and [#5710](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5710).

**Dropped since 10-11:** [#5075](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5075) (`/embed/bhutan`: the index was built and the issue closed on 10-12), [#6206](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6206) (closed 10-13), [#5634](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5634) (closed; replaced by the tier:hold rebase item), the #6276 batch write-off (the ledger has passed 3 days running), and both #6360 items (stale-worker repeat pages fixed by PR #6526; spare-lane decision lines at 0 on main since 10-12).

## Surprising

- The money problem moved out of sight. Metered spend outside envelopes fell after #6467, but the invoice did not fall with it: on 10-15 the bill was twice what we metered.
- The scarce resource is no longer dollars. The dial has been at $5 since 10-04, while the $0 lanes hit the Gemini CLI's 5-hour ceiling and one Claude account serves both the laptop and the busiest box. Capacity, not budget, now decides how many verified pages a week we get.

The ranked queue is in `stewardship.json`.
