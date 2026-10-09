# Job hosts: where a headless job runs, and how it reports

**Read this when** you are about to hand a brief to `claude-job.sh` (dispatching a fork to a box), writing a brief, or changing the wrapper. Background: #6358, #5709, #6076, #6181, #6223.

## The wrapper

`scripts/workers/claude-job.sh` is the one job wrapper for every box. `/root/bin/claude-job.sh` on a box is a **copy** of it, refreshed after each pull by `scripts/workers/install-claude-job.sh` (new file, then `mv`).

- **Never edit `/root/bin/claude-job.sh` on a box.** Change the repo file in a PR. Live jobs execute the installed file for hours, and bash reads a running script incrementally, so an in-place edit changes the script under them. The hand-copied twins also drifted twice (2026-10-04, 2026-10-09).
- Host differences live in the `HOST` block at the top of the script, nowhere else.
- To install by hand after a merge: `bash /root/sourcelibrary/scripts/workers/install-claude-job.sh`. It refuses a file that is not committed and keeps the previous wrapper as `claude-job.sh.prev`.

## The boxes

| Box | Address | What else runs there | Job limits |
|---|---|---|---|
| main (`hetzner`) | `root@46.224.122.120` | every pipeline worker and cron | no slice; root disk fills (#6223) |
| cloudlayer (`earthai-live`, ARM) | `root@46.224.208.175` | the live Cloud Layer globe | `sourcelibrary.slice`: 14 GB, CPUWeight 30 |
| l7a (`earthai-l7a`, ARM) | `root@167.233.32.250` | the 0.6 km archive tick, every ten minutes | `sourcelibrary.slice`: 14 GB, CPUWeight 30 |

The boxes cannot ssh to main. Only the laptop reaches all three, so placement is decided on the laptop. The ARM boxes have no Python ML tools (kraken, CLIP, onnx): a brief that needs them goes to main.

## Placing a job: ask before you start

```
scripts/workers/job-where.sh
```

It asks each box for `claude-job.sh where` (load, free memory, free job disk, live jobs, and whether the box is ready to run a job at all) and names the emptiest. Start the job there:

```
scp brief.txt root@<box>:/tmp/ && ssh root@<box> /root/bin/claude-job.sh start <name> /tmp/brief.txt
```

Do not default to main. On 2026-10-09 main sat at load 17 on 16 cores with its root disk 86% full while cloudlayer ran no jobs.

## The brief: two header lines

Every brief carries these in its first 15 lines:

```
Lands: #6358
PR: yes
```

- `Lands: #NNNN` is the issue the job reports on. `Lands: none` means no comment is expected.
- `PR: yes|no` says whether a pull request is expected.

`start` prints a note when they are missing. Without them the wrapper guesses: the issue is the number the job name ends in (`second-reader-6338`), else the first `#NNNN` in the brief; a PR is expected only if the worktree holds commits beyond main. The guess is what paged Derek "did NOT land" for 58 of 113 finished jobs: the first number in a brief is often a cross-reference.

## What the landing check says when a job finishes

| Verdict | Meaning | Where it goes |
|---|---|---|
| `ok` | comment found; PR found if one was expected; nothing left on the box | ntfy low |
| `REPORT:` | the comment or the PR was not found | ntfy low, and `landings.txt` for the morning digest |
| `AT-RISK:` | uncommitted files in the worktree, or commits that are on no remote branch and are not a PR's head | ntfy **high** |

A high page means work exists only on that box. The job's HEADLESS RULES tell it to leave `git status --porcelain` empty before it writes its done file, so scratch left in a worktree pages too: move it to `$JOB_SCRATCH`.

- One job: `claude-job.sh _land <name>`.
- Every finished job on the box, logged verdict beside the check run again now: `claude-job.sh backtest`.
- Every verdict is appended to `landings.txt` in the box's job directory (`date | host | name | verdict`).
