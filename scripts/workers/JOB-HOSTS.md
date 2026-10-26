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
| l7a (`earthai-l7a`, ARM) | `root@167.233.32.250` | the 0.6 km archive tick, every ten minutes | `sourcelibrary.slice`: 14 GB, CPUWeight 30 — jobs only; the page-vector service and Caddy are in `search.slice` (9 GB min, 13 GB max, #6821) |
| gex45 (`gex45-1`, **x86_64 + GPU**) | `root@65.108.136.89` | the GPU stack in `/root/pz`; work moved off main (`infrastructure/gex45-crontab`) | none: dedicated i5-13500 (20 threads), 62 GB, 436 GB root |

The boxes reach each other through the **box mesh** (below), and the laptop reaches all four as root. Main, cloudlayer and l7a are ARM (cax41, 16 shared vCPU); the ARM boxes have no Python ML tools (kraken, CLIP, onnx).

**GEX45-1, the fourth job box and the only x86 + GPU one** (`root@65.108.136.89`, Hetzner Robot HEL1, NVIDIA RTX PRO 4000 Blackwell 24 GB, i5-13500 with 14 cores / 20 threads, dedicated, 62 GB; $249/mo flat, #5660). A brief that needs Python ML tools or the GPU goes here.
- Paths as on main, but with no volume: checkout `/root/sourcelibrary`, worktrees `/root/worktrees`, job output `$JOB_SCRATCH` = `/root/jobs/<name>`, job state `/root/claude-jobs`, logs `/var/log/sourcelibrary/claude-jobs`. `/root/jobs` and `/root/pz/out` are what `scripts/maintenance/gex45-idle-alert.sh` (cron on main) watches: 6 h with no new file there pages ntfy and comments on #5660. When the GPU queue (`/root/gpu-queue`) has been empty for an hour, the same script starts one `gpu-steward-<date>` job (at most one a day, on cloudlayer or main) with `scripts/maintenance/gpu-steward-brief.md`: queue the next gated #6871 item at $0, or say why none is eligible (`STEWARD=0` turns it off). Never power it off to save money: a dedicated box bills the same.
- Installed: node 22, gh (main's token), `agy` 1.4.0 on main's Google login (more CPU, **not** more Gemini quota: quota is per account), the Claude CLI, `.env.production.local`, `.vercel/project.json`. GPU stack in `/root/pz` (`paddle-zh-box.sh setup` with `PADDLE_CU=cu129`; vLLM needs `VLLM_USE_FLASHINFER_SAMPLER=0`). The vLLM server is not left running: start it for a job, stop it after.
- **`agy` on every box and the Mac is `agy-guard`** (`scripts/workers/agy-guard.sh`, installed 2026-10-23, #7075). One Google account feeds all of them, and Argon/Pro are its scarce models: a print-mode call on argon or -pro is refused (exit 75, "quota reached") unless the job sets `AGY_ALLOW_HEAVY=<issue>`, and then at most 40 per UTC day per box (`AGY_HEAVY_BOX_CAP`), logged in `/root/agy-quota/heavy/<date>.log`. A bare `agy -p` gets `--model gemini-3.8-flash-low`. A brief that needs Argon says so, with the issue, and its job exports the variable.
- **Claude login: dereklomas@gmail.com** (Derek's interactive `/login`; no box used that account before). Until it exists, `where` says `ready=no:claude-not-logged-in` and the spare lane stays idle there.

Each box's Claude login is a different account (gex45: dereklomas@gmail.com, logged in 2026-10-26); check with `python3 -c "import json;print(json.load(open('/root/.claude.json'))['oauthAccount']['emailAddress'])"` on the box, since logins change (main: team@sourcelibrary.org since 2026-10-15, cloudlayer: derek@playpowerlabs.com, l7a: derek@sourcelibrary.org), so spreading jobs across the boxes also spreads them across separate weekly limits.

## The spare lane on every box (#6395)

Each box is logged into a different Claude account (main: team@sourcelibrary.org since 2026-10-15, cloudlayer: derek@playpowerlabs, l7a: derek@sourcelibrary, gex45: dereklomas@gmail.com since 2026-10-26; since 10-16 the laptop shares team@ with main, see `needs/stewardship.md`). `scripts/workers/spare-lane.py` runs from cron on all four and spends that account's allowance on small issues when the account is under its fair share of the week. Only main polls usage. It publishes the poll to Mongo (`ops_reports` `claude-limits:latest`, `claude-limits-share.mjs`), and the guests read it there, because no box can ssh to another. Cron: main `*/30` (in `crontab.production`); guests `15,45 * * * *`, logging to `/data/scratch/sl/logs/spare-lane.log`, guarded on the script existing; gex45 `10,40` (in `infrastructure/gex45-crontab`), live since the 2026-10-26 login. Jobs are named `spare-<issue>`, at most 2 on main and 1 on a guest, and an issue the lane picks is labelled `spare-lane` so no other box takes it. In the last 48 h of an account's week, when no issue is eligible, it runs an Opus-only #6420 convergent-audit round instead (`spare-audit-<date>-<n>`, same cap, logged `reason: fallback audit`) and posts that account-week's rounds as one pooled comment on #6420 after the reset (#6781).

## Placing a job: ask before you start

```
scripts/workers/job-where.sh
```

It asks each box for `claude-job.sh where` (load, free memory, free job disk, live jobs, and whether the box is ready to run a job at all) and each box account's Claude headroom (5-hour %, week % and hours to reset, the week that would go unused at its pace; from `ops_reports` `claude-limits:latest`). Load, memory and disk only filter; it drops accounts at >= 80% of their 5-hour window or >= 90% of their week, and names the box whose account has the most week left per hour to its reset (#6751). Start the job there:

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

## Steering a running job: the inbox (#6534)

```
ssh root@<box> /root/bin/claude-job.sh note <name> "score recitation cuts as unscored, not 100% error"
```

A headless job's prompt is fixed when it starts, so before this the only way to add an instruction was to stop and restart it (three dispatches of the #6523 fix on 2026-10-11). `note` appends a timestamped line to `$JD/<name>.inbox`. The headless rules tell the job to read its inbox at the start of each step, before each report and before the done file, and to name the notes it acted on. There is deliberately no hook: a PostToolUse hook would run in every Claude session on the box, which is more exposure than the gain is worth (#6534). A note therefore lands at the job's next step, not mid-step. A note to a job that is not running is read when the job resumes. Prefer a note to a restart, unless the job has gone the wrong way so far that its work is better discarded.

## What the landing check says when a job finishes

| Verdict | Meaning | Where it goes |
|---|---|---|
| `ok` | comment found; PR found if one was expected; nothing left on the box | ntfy low |
| `REPORT:` | the comment or the PR was not found | ntfy low, and `landings.txt` for the morning digest |
| `AT-RISK:` | uncommitted files in the worktree, or commits that are on no remote branch, are not a PR's head, and touch a file whose content is on no remote (a squash-merged branch reads as landed) | ntfy **high** |

A high page means work exists only on that box. The job's HEADLESS RULES tell it to leave `git status --porcelain` empty before it writes its done file, so scratch left in a worktree pages too: move it to `$JOB_SCRATCH`.

- One job: `claude-job.sh _land <name>`.
- Every finished job on the box, logged verdict beside the check run again now: `claude-job.sh backtest`.
- Every verdict is appended to `landings.txt` in the box's job directory (`date | host | name | verdict`).

## When a job does not finish, and what it asks (#6360 fixes 1–3)

- **Checkpoint on every non-DONE exit.** GAVE UP, a weekly cap, `stop`, and the sweep's "died twice" all commit the worktree (gitignore applies; files over 5 MB, the shared `node_modules` link, the vendored bundle and `.vercel` are left out) and push it to the job's branch, or to `<branch>-checkpoint-<time>` if that push is refused. The page names the branch. A lost job costs time, not results.
- **A weekly cap moves the job.** The 6-hour wait is for the 5-hour session window only; a weekly cap resets in days. The job checkpoints, then `box.sh pick` finds the emptiest ready box and the job continues there as `<name>-mv`, from the checkpoint branch (low page). One move per job; if no box can take it, it pages high with the laptop step.
- **No placement on a box that cannot run a shell command.** Jobs run with `--permission-mode acceptEdits`, so `/root/.claude/settings.json` must allow `Bash` (or the job cannot write its done file and loops: earthai-l7a, 2026-10-09). `where` reports `ready=no:no-bash-permission` otherwise.
- **No placement on a spent account.** `start` refuses when this box's account is at or over `MAX_WEEKLY_PCT` (90) of its weekly limit, read from the climits meter (`/root/.claude-limits/latest.json`; it runs on main and `box.sh push-limits` copies it to the other boxes every 5 min; each box looks up its own login's account; absent or older than 30 min = no check). `where` prints `weekly_pct` and reports `ready=no:weekly-NNpct`, so `job-where.sh` skips the box. Override: `JOB_IGNORE_LIMIT=1`.
- **Not logged in fails loudly, once (#5627).** `start` and `resume` first ask `claude -p` (sonnet) for a one-word OK from the checkout, and refuse with exit 7 unless it answers (a usage-limit answer passes: that is a wait). A job whose log ends on `Not logged in` / `Please run /login` / an expired token is not resumed: it logs `NOT LOGGED IN`, checkpoints, pages high, and comments on its `Lands:` issue. The sweep holds a died job on a box that is logged out instead of spending its two resumes. Skip the preflight: `JOB_SKIP_PREFLIGHT=1`.
- **Jobs decide two-way doors.** The HEADLESS RULES let a job raise `DECISION:` only above the $10 spend floor or on the hold list; anything else it decides and logs as `TAKEN:` (collected into `taken.txt`). DECISION lines go to `decisions.txt` for the morning digest and no longer page one by one.

## The box mesh (#6360)

Each box can ask the others to do a short, fixed list of things, and nothing else.

- **Client:** `/root/bin/box.sh <main|cloudlayer|l7a|gex45|all|others> <verb>`; `box.sh pick` names the emptiest ready box (same scoring as `job-where.sh`); `box.sh push-limits` copies the usage meter (main, every 5 min).
- **Server:** `/root/bin/box-rpc.sh`, the forced command of every mesh key. Verbs: `ping`, `where`, `status`, `decisions`, `taken`, `landings`, `put-limits` (stdin), `start <name>` (brief on stdin). Anything else is refused. Every call is logged to `/var/log/box-rpc.log`.
- **Safe:**
  - A dedicated key per box (`/root/.ssh/id_mesh`), accepted by the others only from that box's addresses (`from=`), only as `box-rpc.sh` (`command=`), with no shell, pty or forwarding (`restrict`).
  - Host keys are pinned in `/root/.ssh/known_hosts_mesh`, read from each box over the laptop's own connection.
  - `start` refuses a name already used and more than 6 remote starts an hour.
  - What the mesh does NOT limit: a started job is a Claude job with that box's ordinary job permissions, so a box that can `start` can run work on the others. That is the point of it, and the reason the key never leaves root on the four boxes.
- **Smooth:** one table of boxes in `box.sh`; the scripts install with the wrapper (`install-claude-job.sh`, after every pull).
- **Resilient:** 8 s connect timeout, keepalives, three tries with backoff on a connection failure and none on a refusal. A box that cannot be reached for 30 min pages once (high) and once more when it is back (low). Without the mesh, everything falls back to how it was: no weekly check on that box, and a capped job pages for a human.
- **Set up / repair / rotate, from the laptop:** `scripts/workers/mesh-setup.sh install | check | rotate | remove`. It backs up `authorized_keys` before every change and only ever touches lines ending ` mesh@<box>`.
