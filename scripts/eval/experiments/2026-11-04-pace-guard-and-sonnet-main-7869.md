---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The pace guard was blind for two reasons: it sampled the meter only while a paced call ran, and on the guest boxes job main sessions bypassed it. Fixed in this PR. #7872/#8018 removed every turn over 300K on the jobs that ran with them, but those were only 10 jobs in 38 h. A Sonnet main session fits about 1–3% of box Opus use."
status: informational
decision: "Pace guard paces job main sessions in their own pool; burn now comes from climits' 5-min history; opt-in `Model: sonnet — <why>` header added with Opus as the default (this PR, #7869)"
feeds: [guard, cost]
supersedes: []
superseded_by: null
issue: [7869]
router_evidence: "none — no route compared"
defect_rates: "none — nothing judged"
---
## 2026-11-04 — Pace guard meters, #7872/#8018 measured, Sonnet main sessions, gex45 GPU (#7869)

PRIOR ART: `~/sourcelibrary-ops/bin/opus-usage-by-job.py`, whose dedup and weighting (out×5 + in + cache_write×1.25 + cache_read×0.1) `scripts/eval/job-transcript-efficiency-7869.py` reuses. Also PR #7872's 45-transcript replay and PR #8018's 12% estimate, which are the forecasts tested here, and ops `costs/subscription/2026-10-31-value-audit.md`.

Measured 2026-11-04 between 10:30 and 10:50Z on main (clawdbot) and gex45. From main I could not ssh into cloudlayer or l7a (`Permission denied (publickey)`), and the mesh does not run scripts, so those two boxes are reasoned about, not measured.

## 1. Why the pace guard could not read its meters

**gex45, `burn-unknown` while dereklomas burned about 4%/h.** The guard keeps its own samples (`/root/claude-pace/<email>.hist`), and it adds one only when a paced `claude -p` call runs. Its samples for dereklomas stop at 11-03 15:00 and resume at 11-04 08:55. After a gap like that, the 3-hour window holds less than an hour of samples, so for the first hour of every new burst the burn rate reads as unknown. The 10:28 `.slots` file was just the cache from the last paced call, at about 09:50, when the window spanned 0.92 h.

Between 09:50 and 10:35 no paced call ran at all, yet the account rose from 18% to 21%. That spend came from job main sessions. On cloudlayer, l7a and gex45, `claude-job.sh` runs them with `CLAUDE_BIN=/root/.local/bin/claude`, the real CLI, so the guard never saw them. At the next paced call (10:37) the guard did cut: `2 burn=5.40%/h,budget=0.55%/h,week=21%`.

**main, `burn-unknown` for team@.** The cause is the same sparse sampling. team@ reads 0% all day, and its samples sit at 01:30 and then 10:30.

**cloudlayer, `meter-error`.** In climits on main, the grant for derek@playpowerlabs.com is revoked: `HTTP 400 … invalid_grant, Refresh token not found or invalid`. The account therefore reaches the meter as `ok: false`. The old guard looked for the account and its `ok` flag in one expression, so a missing account and an unreadable one gave the same bare `meter-error`. Code cannot fix this. Someone has to run `climits add derek@playpowerlabs.com` on main. The climits log also warns that the team@ and derek@sourcelibrary.org grants expire in under 3 days.

**Does a home chosen with `JOB_CLAUDE_HOME` / `CLAUDE_CONFIG_DIR` get metered under its own account?** Yes. The guard reads `$CLAUDE_CONFIG_DIR/.claude.json`, and `claude-job.sh` exports the job's recorded home before every call. Two cases show it: on gex45, the milolomas jobs keep their own `.slots` beside dereklomas's, and this job on main is metered as team@. On the guests, though, that applied only to children until now, because the main session bypassed the guard whatever its home.

**What changed (this PR):**
- Burn comes from the densest samples available:
  - on main, climits' 5-minute `history.jsonl`, read on every decision;
  - else `burn_pct_per_h` in the meter, which `box.sh push-limits` now computes from that history before it copies the meter out (`job-where.sh` already read this field, but nothing had ever written it);
  - else the box's own samples, with 30 minutes of them required instead of an hour.
- A job's main session (`CLAUDE_PACE_AGENT=1`, set by `claude-job.sh` only when it calls through the guard) takes a slot from a separate `main` pool of the same size. An over-pace account then runs at most `slots` main sessions per box. The rest wait at their next stage start, re-deciding every minute and logging every 10 minutes. Their children use the child pool, so the two cannot deadlock.
- On the guests, `claude-job.sh` now calls through the guard wherever `/usr/local/bin/claude` links to it.
- `install-claude-job.sh` installs the guard wherever that link exists. The guard had been copied by hand once, on 10-27, and no later fix reached any box.
- Fail-open stays, and it is now named:
  - `.slots` gives the reason (`meter-error:ValueError:account-not-ok-in-meter`, `meter-error:ValueError:meter-stale:160m`, `burn-unknown:span=…`);
  - every fail-open decision goes to `/root/claude-pace/failopen.log`;
  - `claude-job.sh where` prints `pace=<slots>/<why>/<age>`.
- No API calls were added. The guard reads only the meter file, which climits already polls every 5 minutes. The one call at job start (the login preflight, one Sonnet "OK") is now marked unpaced, so a full queue cannot hold it past its 120 s and get it misreported as a login failure.

**Over-pace logins are cut. Before the install, this was shown with the patched guard against the live meter, the real accounts and a stub CLI:**

| login | before (installed guard) | patched |
|---|---|---|
| derek@sourcelibrary.org (main) | `12 burn-unknown` | `2 burn=2.06%/h,budget=0.45%/h,week=84%` |
| team@sourcelibrary.org (main) | `12 burn-unknown` | `12 burn=0.00%/h,budget=0.68%/h,week=0%` |
| milolomas (main) | `6 burn=0.55%/h…` | `4 burn=0.69%/h,budget=0.26%/h,week=87%` |
| dereklomas, guest path (pushed meter, empty own history) | `burn-unknown` for the first hour | `2 burn=3.77%/h,budget=0.55%/h,week=21%,src=meter` |
| derek@playpowerlabs (cloudlayer) | `12 meter-error` | `12 meter-error:ValueError:account-not-ok-in-meter`, logged |

Four main sessions on derek@ with 2 slots: two ran, and two waited until a slot freed (`waited=5s pool=main slots=2` in `waits.log`). The post-merge `.slots` from each box are in the issue comment.

## 2. Did #7872 / #8018 land? (merged 11-03 20:02 and 20:10Z)

Each line is a job's main-chain Opus turns, split at 11-03 20:10Z. "After" covers 38 h.

| box | window | turns | mean context | median | turns > 300K | max | weighted tokens / turn |
|---|---|---|---|---|---|---|---|
| main | 10-28 → 11-03 20:10 | 5,026 | 228K | 179K | 25% | 834K | 30.5K |
| main | after, 4 jobs, all on the new settings | 355 | **113K** | 100K | **0%** | 232K | **17.1K** |
| gex45 | 10-28 → 11-03 20:10 | 6,721 | 206K | 197K | 20% | 581K | 27.7K |
| gex45 | after, all jobs | 530 | 182K | 169K | 15% | 389K | |
| gex45 | after, 6 jobs on the new settings | 377 | **136K** | | **0%** | 293K | 29.8K |

There were 12 fresh-session restarts (main 2, gex45 10) and 6 compactions (all on gex45).

**The 12%.** #8018 forecast about 12% of box Opus use from capping context at 300K. The cap itself is fully in effect: no turn on any job that ran with the settings went over 300K, against 20–25% of turns before. Whether that became a 12% saving does not show yet:
- On main, the cost per turn fell 44%, more than forecast. But that rests on 4 jobs and different work, so it is not a controlled comparison.
- On gex45, the cost per turn rose 8% even though context fell 34%. The most likely cause is the cache rewrite at every fresh start and compaction, but this run did not split it out.

Jobs started before 20:10Z are still on the old wrapper (gex45 `wrong-leaf-find-5021`, at 296K mean after the cut). The week-over-week comparison on or after 11-10, already listed on the issue, is still the real test.

## 3. Main sessions on Sonnet

Main sessions take 97% of job Opus on main and 79% on gex45; the rest is subagents. A **wait turn** is a turn whose tool calls are all Bash commands that poll CI or a runner, sleep, merge, push, comment, or read a log tail. Wait turns take **8.1%** of main-chain Opus on main (486 of 5,381 turns) and **9.1%** on gex45 (624 of 7,251 turns).

A per-job header cannot catch only those turns. Jobs with at least 20% wait weight account for 5.4% (main, leaving out the Opus-only `spare-audit-*` rounds) and 5.5% (gex45) of main-chain Opus. About half of those jobs are judgement work that happens to wait a lot (`repeat-check-judge`, `article-german-7954`, `tib-wave3-7263-mv`). The truly mechanical ones are runners and movers: `greek-cli-redo-5813` (54% wait), `spare-7341` (67%), `xfer-7611-texts` (51%), `land-7499`, `agy-drain-7911`.

**Saving.** Assuming Sonnet draws on the weekly limit at its list-price ratio (3:5 of Opus; not measured on the subscription), a switched job costs 40% less:
- the mechanical jobs alone: about 2–3% of main-chain Opus, so **about 1% of box job Opus**;
- the ceiling, if every wait turn ran on Sonnet: about 3.5%.

That is small next to the fresh-session work. **Risk:** a whole-job switch also moves that job's few judgement turns to Sonnet. The job may follow the headless rules (done file, state file, `-s` sign-off) less reliably. A missed done file costs a resume, which is worth more than the saving. So the header is opt-in, defaults to Opus, and is for runner, CI, merge and transfer briefs only. No existing job or lane changes.

## 4. GPU on gex45, 24 h to 11-04 10:45Z (report only)

There is no continuous GPU utilization log on the box. What it does log is `gpu-queue.log` (task start and end) and each SigLIP shard's `gpu_s` / `wall_s`.

| | minutes | share |
|---|---|---|
| SigLIP2 full page run (22 runs, 20 of them yielded) | 601 | 42% |
| Latin first-read arm c (PERO drafts, 20 chunks, 1.56 s/page) | 521 | 36% |
| LaBSE, zh-ditto, zh re-OCR (one each) | 21 | 1% |
| nothing running (47 gaps, mean 4.5 min, max 15) | 212 | 15% |

The log window starts 11-03 12:09, so the rows sum to about 22.6 h.

While SigLIP runs, the card is busy: across 119 shards, `gpu_s` is 95% of wall time, at 41.8 img/s against the 44 img/s design figure.

**The queue is not starving.** SigLIP backfill chunks are always pending. The idle time is scheduler latency: the queue runs from cron every 5 minutes, and SigLIP yields to every OCR chunk the filler adds. Each yield costs a restart and a model reload. At 10:10Z the OCR filler logged `no enabled route has pages left`, so from then on SigLIP has the card to itself.

The 0% sample came while the queue ran `153-zh-print-arms-7263`, a vLLM server holding 3.3 GB between requests, right after SigLIP had yielded at 10:44. Every task's logged `vram=2MiB` is read after the task exits, so it says nothing about use. PERO's GPU use during the arm-c chunks is not logged. The box's load average was 90–128 on 20 threads, so CPU, not the card, is the likely limit for PERO's feeders. That was not measured.

Reproduce: `python3 scripts/eval/job-transcript-efficiency-7869.py 2026-10-28T10:40` on a box (or `ssh root@<box> python3 - … < script`). It writes JSON. The tables above come from that JSON, and the GPU table from `gpu-queue.log`.
