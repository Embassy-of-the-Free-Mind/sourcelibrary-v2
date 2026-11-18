# Job hosts: where a headless job runs, and how it reports

**Read this when** you are about to hand a brief to `claude-job.sh` (dispatching a fork to a box), writing a brief, or changing the wrapper. Background: #6358, #5709, #6076, #6181, #6223.

## What is going on right now: `situation`

`situation` (installed at `/root/bin/situation` on every box; `scripts/workers/situation.sh` on the laptop) prints the whole fleet in one read, in about 7 seconds: each box's running jobs and the ones that stopped without a DONE (with the issue each reports to and its last words), red cron lanes, standing stops, the GPU queue, every Gemini pool and Claude account, the last 12 h of ntfy alarms, and the open rows of the ops repo's `DECISIONS-PENDING.md`. `--box=<name>` narrows the jobs and lanes, `--hours=N` the window, `--json` gives the object.

It reads what the boxes already push to Mongo (`ops_reports`: `work-board:<box>` every 10 min, `pipeline-now:<box>` hourly, `claude-limits:latest`), so it works from any box, the laptop, a phone session or a headless job, and needs no ssh. A box whose push stopped is flagged `STALE REPORT` at the top of its section rather than shown as quiet. What it cannot see: why a job was started (`job-ledger.sh why <job>`), what it was told (`box.sh <box> brief <job>`), and approvals and ceilings (`RUNNING.md`). The browser view of the same reports: https://sourcelibrary.org/admin/work and https://sourcelibrary.org/admin/pipeline/now.

## The wrapper

`scripts/workers/claude-job.sh` is the one job wrapper for every box. `/root/bin/claude-job.sh` on a box is a **copy** of it, refreshed after each pull by `scripts/workers/install-claude-job.sh` (new file, then `mv`).

- **Never edit `/root/bin/claude-job.sh` on a box.** Change the repo file in a PR. Live jobs execute the installed file for hours, and bash reads a running script incrementally, so an in-place edit changes the script under them. The hand-copied twins also drifted twice (2026-10-04, 2026-10-09).
- Host differences live in the `HOST` block at the top of the script, nowhere else.
- To install by hand after a merge: `bash /root/sourcelibrary/scripts/workers/install-claude-job.sh`. It refuses a file that is not committed and keeps the previous wrapper as `claude-job.sh.prev`.

## The boxes

| Box | Address | What else runs there | Job limits |
|---|---|---|---|
| main (`hetzner`) | `root@203.0.113.2` | every pipeline worker and cron | no slice; root disk fills (#6223) |
| cloudlayer (`earthai-live`, ARM) | `root@203.0.113.3` | the live Cloud Layer globe | `sourcelibrary.slice`: 14 GB RAM and, since 2026-11-12, 6 GB swap (`sourcelibrary.slice.d/swap.conf`); CPUWeight 30. Past both, the kernel kills a process inside the slice: a job that ends with a bare `Killed` on this box hit that limit. Before the limit the slice could take all 16 GB of swap, and on 7 and 9 Nov the globe's tick was killed for it (JDerekLomas/earthlove#548) |
| l7a (`earthai-l7a`, ARM) | `root@203.0.113.1` | the 0.6 km archive tick, every ten minutes | `sourcelibrary.slice`: 14 GB, CPUWeight 30 — jobs only; the page-vector service and Caddy are in `search.slice` (9 GB min, 13 GB max, #6821) |
| gex45 (`gex45-1`, **x86_64 + GPU**) | `root@203.0.113.4` | the GPU stack in `/root/pz`; work moved off main (`infrastructure/gex45-crontab`) | none: dedicated i5-13500 (20 threads), 62 GB, 436 GB root |

The boxes reach each other through the **box mesh** (below), and the laptop reaches all four as root. Main, cloudlayer and l7a are ARM (cax41, 16 shared vCPU); the ARM boxes have no Python ML tools (kraken, CLIP, onnx).

### Capacity (measured 2026-10-26; re-measure with `scripts/workers/box-capacity.sh`)

What each box HAS. For what is free right now, and where the next job should go, use `job-where.sh` (below).

| Box | CPU | RAM / swap | GPU | Disks (size · free on 2026-10-26) | What fills them |
|---|---|---|---|---|---|
| main | 16 vCPU ARM (Neoverse-N1, shared) | 30 GB / 11 GB | none | `/` **150 GB** · 28 GB free (81%) — the tightest root of the four. `/mnt/HC_Volume_105839809` 492 GB · 76 GB (84%) | root: checkout 19 GB, `.gemini` 16 GB, `.claude` transcripts 16 GB, `claude-jobs` 8 GB. The steward moves idle `/root` folders to the volume nightly |
| cloudlayer | 16 vCPU ARM (shared) | 30 GB / 15 GB (swapfile on the volume) | none | `/` 301 GB · 74 GB (75%). `/data/scratch` 492 GB · 131 GB (72%) after a cleanup the same day (it was 9.8 GB, 98%) | Cloud Layer prototype trees: `north72-archive` 54, `poles-e` 53, `north90` 49 GB (an open backfill, #379 in earthlove), all read by nothing live; the globe runs from `/data/live` on `/`. Source Library's `sl/` is 57 GB. No steward |
| l7a | 16 vCPU ARM (shared) | 30 GB / none | none | `/` 301 GB · 138 GB (53%). No volume | `/data` 134 GB (archive tick). No steward |
| gex45 | 20 threads x86 (i5-13500, dedicated) | 62 GB / 31 GB | RTX PRO 4000 Blackwell, 24 GB | `/` 436 GB · 143 GB (66%). No volume | `/root/.cache/huggingface` ≈ 40 GB after the 2026-10-29 prune (model weights; see the gex45 notes), `/root/jobs` 43 GB, `/root/pz` and `/root/bench` 20 GB each |

**Storage has a lifetime, not an alarm (#6223, 2026-10-29).** `disk-steward.sh` runs hourly on every box: it trims the Hugging Face hub cache to 50 GB, 75 GB on gex45 (least recently read model first; models re-download), reaps merged worktrees, removes the test databases a killed CI run leaves in `/tmp` (`mongo-mem-*`, untouched for two hours and open by no process; 17 GB of them filled gex45 on 2026-11-12) and every other idle file or folder the CI runner account leaves there (an `npm ci` leaves a 31 MB `@posthog/cli` tarball each time: 22.9 GB on gex45 on 2026-11-15, #393), resets a CI runner checkout whose `.git` passes 2 GB, and, while a disk is above **70%** (75% until #393), archives idle folders to R2 oldest first: each folder of 200 MB or more in `jobs/` and `moved-from-*/`, each lane's day folder (`jobs/<lane>/YYYY-MM-DD`, since the lane folder itself is written every day), and top-level `/root` folders on main and gex45, with no file written for 7 days (3 days while the disk is at 80% or more), no tmux session named for it, no open files and no uncommitted git work. The folder is tarred with zstd, streamed to R2 (`sl-corpus-snapshots`, `cold/<box>/…`), read back and checked, then removed; `<folder>.IN-R2.txt` holds the key and the one-line restore (`disk-steward.sh restore <folder>.IN-R2.txt`). A job's scratch therefore lasts three days to a week after the job goes quiet: anything worth keeping belongs in Mongo, a PR, or an R2 key of its own. `claude-job.sh start` refuses on a box with under 15% of its root disk free, `where` reports that box as `ready=no:root-NNpct-free`, and `job-where.sh`, `box.sh pick` and the spare lane therefore skip it.

`disk-alarm.sh` runs every 15 min on all four boxes and watches every mount, not just `/` (it watched only `/`, and only on main and gex45, until 2026-10-26). At 85% it pages only when the steward's last run could not get the disk under it (and says what it kept, and why); at 95% it pages at once. Memory for jobs on cloudlayer and l7a is capped by `sourcelibrary.slice` (14 GB), so the RAM column is not what a job gets there.

**GEX45-1, the fourth job box and the only x86 + GPU one** (`root@203.0.113.4`, Hetzner Robot HEL1, NVIDIA RTX PRO 4000 Blackwell 24 GB, i5-13500 with 14 cores / 20 threads, dedicated, 62 GB; $249/mo flat, #5660). A brief that needs Python ML tools or the GPU goes here.
- **The Hugging Face cache has a shared store.** On this box `~/.cache/huggingface/hub/models--X/blobs/<hash>` is often a symlink into `hub/blobs/<xx>/<hash>`, where the weights actually live. `rm -rf models--X` therefore leaves the weights behind with nothing pointing at them. That is how 38 GB of Qwen3-32B and Qwen3.6-27B weights were stranded until 2026-10-29. To remove a model, follow every symlink: delete `models--X` plus each store blob that no remaining model reaches. Then check that `find hub -xtype l` prints nothing. Pruned on 2026-10-29 because their evals ended with "not adopted" (#6871 rows 1, 5, A and 6, and #5924, #6101); re-download one if it comes back: olmOCR-2-7B-FP8, Qwen3-14B/8B-AWQ, Qwen3-Embedding-4B/0.6B, bge-m3, Qwen2.5-VL-7B-AWQ, llama-3.2-11b-vision (unsloth) and the Manchu LoRA and its dataset.
- Paths as on main, but with no volume: checkout `/root/sourcelibrary`, worktrees `/root/worktrees`, job output `$JOB_SCRATCH` = `/root/jobs/<name>`, job state `/root/claude-jobs`, logs `/var/log/sourcelibrary/claude-jobs`. `/root/jobs` and `/root/pz/out` are what `scripts/maintenance/gex45-idle-alert.sh` (cron on main) watches: 6 h with no new file there pages ntfy and comments on #5660. When the GPU queue (`/root/gpu-queue`) has been empty for an hour, the same script starts one `gpu-steward-<date>` job (at most one a day, on cloudlayer or main) with `scripts/maintenance/gpu-steward-brief.md`: queue the next gated #6871 item at $0, or say why none is eligible (`STEWARD=0` turns it off). Before that, `scripts/gpu/ocr-filler.sh` (cron */10, installed in `/root/bin`) queues one chunk of the first gated OCR route in `scripts/gpu/ocr-filler-routes.tsv` with pages left whenever the queue is empty and nobody holds `/root/gpu.lock`; add a route there (lane dir + writer) instead of hand-queuing chunk after chunk. Never power it off to save money: a dedicated box bills the same.
- Installed: node 22, gh (main's token), `agy` 1.4.0 on main's Google login (more CPU, **not** more Gemini quota: quota is per account), the Claude CLI, `.env.production.local`, `.vercel/project.json`. GPU stack in `/root/pz` (`paddle-zh-box.sh setup` with `PADDLE_CU=cu129`; vLLM needs `VLLM_USE_FLASHINFER_SAMPLER=0`). The vLLM server is not left running: start it for a job, stop it after.
- **`agy` on every box and the Mac is `agy-guard`** (`scripts/workers/agy-guard.sh`, installed 2026-10-23, #7075). One Google account (dereklomas@) feeds all of them unless a job sets `AGY_HOME` (second account, below), and Argon/Pro are its scarce models: a print-mode call on argon or -pro is refused (exit 75, "quota reached") unless the job sets `AGY_ALLOW_HEAVY=<issue>`, and then at most 40 per UTC day per box (`AGY_HEAVY_BOX_CAP`), logged in `/root/agy-quota/heavy/<date>.log`. A bare `agy -p` gets `--model gemini-3.8-flash-low`. A `claude-*` or `gpt-*` model is refused unless that account's Gemini weekly bucket reads 0 on `/quota` and its Claude buckets hold 10% (#7545; the same check as `agyClaudeGate` in `scripts/lib/agy-cli.mjs`, sharing its 10-min cache in `/root/agy-quota/quota/`). A brief that needs Argon says so, with the issue, and its job exports the variable.
- **agy-guard also caps how many agy calls run at once on a box (v3 #70).** Every lane picks its own `--concurrency` and nothing added them up: on 2026-11-12 gex45's cron lines asked for 36 calls at once, 22 were running at 1.5–2 GB each, the box sat at load 110 on 20 threads with 20 GB in swap, and a lane process got about a quarter of a core. The cap is per box, in the `box_slots` table at the top of `agy-guard.sh`: gex45 12, main 8, cloudlayer and l7a 4; `AGY_BOX_SLOTS=<n>` overrides it and `0` turns it off. A call that finds the box full waits, up to 120 s (`AGY_SLOT_WAIT_S`), then runs anyway; it is never refused, and `/quota` never waits. Each wait is a line in `/root/agy-quota/slots/<date>.log` (`waited=…s running=… slots=… overflow=0|1`): many `overflow=1` lines mean the box is asked for more than it can run, and the fix is to move a lane to another box, not to raise the number. The guard is installed after every pull by `install-claude-job.sh`.
- **A Google account suspended for "violation of Terms of Service" (v3 #182).** On 2026-11-12 19:12-21:55Z the james and milo logins returned `PERMISSION_DENIED (code 403): This service has been disabled in this account for violation of Terms of Service` on every box while `/quota` still answered, so lanes kept calling (~2,000 calls) and nothing paged. agy-guard now reads the account's own CLI logs before each call: a ToS reply in the last 30 min refuses the call as `refused (config)`, lets one probe through every 15 min, pages ntfy once (and again when it lifts), and keeps state in `/root/agy-quota/tos/<account>.{suspended,probe,log}`. **Do not log in again or move a suspended account's lanes to another box**; that is more of the same traffic. `AGY_TOS_CHECK=0` turns the check off.
- **How much Gemini quota is left: `agy -p "/quota" --output-format json`** (free, no tokens; any box or the Mac, since they share the account). This reads root's (dereklomas@) pool only; the second account's pool is read with `AGY_HOME=/root/.agy-james` (below). Within one account, all Gemini models (Flash and Argon/Pro) draw on ONE pool with a weekly and a 5-hour limit, charged by token cost, and `remaining_fraction` is given per window with its reset time. Claude/GPT models inside agy are a separate pool. Measured 2026-10-27: about 100K 3.8 Flash low calls a week (`scripts/eval/experiments/2026-10-27-agy-quota-pool-6740.md`). `/root/agy-quota/calls.csv` on main counts **main's calls only**; cloudlayer, gex45 and the Mac each keep their own logs in `~/.gemini/antigravity-cli/log`, so a capacity figure from that meter alone is too low. Read readings at least hours apart: minute-to-minute values jump and come back.
- **Second Google Ultra account (account@example.com, added 2026-10-27):** its login lives in `/root/.agy-james` on the box it was signed in on. A job uses it with `AGY_HOME=/root/.agy-james` (agy-guard switches `HOME` for the CLI only, and counts its heavy cap separately). Its quota is its own pool (Ultra since 2026-10-27 ~21:45Z, when its tier moved off "Antigravity Starter Quota"; a real Ultra pool shows a 5-hour bucket, #7517): read it with `AGY_HOME=/root/.agy-james agy -p "/quota" --output-format json`. It runs `gemini-3.8-flash-low` only (`/root/.agy-james/allowed-model`; agy-guard refuses any other model). Linux boxes only; the Mac's login is in the Keychain. **Since 2026-10-28 the login is installed on main, gex45 and cloudlayer** (`/root/.agy-james` on each, with the current agy-guard). Main is CPU-bound, so second-pool lanes run on gex45 or cloudlayer: the correction lane runs on gex45 for both pools (`infrastructure/gex45-crontab`, #7263). A lane that only shares the pool marks its processes `AGY_POOL_SHARED=1` (`scripts/lib/agy-pools.mjs`), so the Siku lane does not count the pool as busy. **Refresh rule:** agy-guard does this itself now (v3 #69): before every call it keeps a copy of each login's good token as `antigravity-oauth-token.good` and puts it back when the file reads `{"token":null}`, which two calls refreshing the token in the same second leave behind (the cause of every loss on gex45, 2026-11-09 to 11-13). Restores are logged in `/root/agy-quota/token-keeper.log`, at most one per login every 10 min. If the ntfy page "agy NOT LOGGED IN" still comes, the copy did not work: copy `antigravity-oauth-token` from main's `/root/.agy-james/.gemini/antigravity-cli/` by hand. Do not log in again on the other box.
- **Third Google Ultra account (account@example.com, added 2026-11-03):** login at `/root/.agy-milo` on main, gex45 and cloudlayer (signed in on main; token, `settings.json` and `allowed-model` copied, as for `.agy-james`). Held to `gemini-3.8-flash-low`. Verified Ultra on sign-in: `/quota` shows a 5-hour bucket; weekly window resets Mondays ~11:27Z. In `POOL_HOMES`, so `--agy-home=auto` lanes see it; the gex45 correction lane has its own line for it. Data-sharing opt-in was left unticked at sign-in. Same refresh rule: copy `antigravity-oauth-token` from main's `/root/.agy-milo`.
- **How the agy lanes spend a pool: drain by reset (#7911).** Each lane (cli-ocr-lane, enrich-agy, Siku) spends a pool freely down to a small weekly reserve (`LANE_RESERVES` in `scripts/lib/agy-pools.mjs`: the declared needs of Siku, cli-translate, enrich and reader requests; a reserved lane does not keep its own), and the reserve is 0 in the last 36 h before that pool's weekly reset. The 5-hour floor (`--floor-5h`) does the pacing. There is no even-burn line, so no cron line needs `--pace-off-until`; change a reserve in the table, never on a cron line.
- **Finish books first (#8482, Derek 2026-11-10).** The pools are spent in this order: (1) the pages that finish a book already 80%+ translated, (2) untranslated pages of other visible books, (3) quality re-reads and re-translations of pages that already have text. Mechanism (`FINISH FIRST` in `scripts/lib/agy-pools.mjs`): `cli-translate-lane.mjs finish` (gex45 :40) translates idle visible books closest to done first and stamps the finish queue each run, in two places: a file under `/root/agy-quota/finish-queue/` on its own box and a copy in Mongo (`ops_reports`, `_id` `finish-queue:<lane>`, v3#70), each naming the box and the time, so a quality lane on any box reads it (per lane the later-written of the two decides; a box that cannot read Mongo uses its file and says so once). Every quality run logs one `finish queue OPEN|closed` line naming the stamp that decided; while that stamp is fresh with work, the quality lanes (latin-first's re-read and correction steps, which carry `--yield-to-finish`, and `cli-translate-lane.mjs stale`) keep `FINISH_RESERVE` (25%) more of every pool. latin-first now starts with two `--finish-first` steps that re-read only the untranslated Flash-Lite pages of finish books and of books the CLI translation lane holds, so its OCR-first gate clears. Every lane run ends with `books finished this run (...)`: count throughput there, in books.
- **Claude login: derek@sourcelibrary.org** (read on the box 2026-11-12; it was account@example.com from 2026-10-26). This is the same account as Derek's laptop, so jobs here and laptop sessions share one weekly limit. With no login, `where` says `ready=no:claude-not-logged-in` and the spare lane stays idle there.

Each box's Claude login is a different account (gex45: derek@sourcelibrary.org as of 2026-11-12); check with `python3 -c "import json;print(json.load(open('/root/.claude.json'))['oauthAccount']['emailAddress'])"` on the box, since logins change (main: account@example.com, Max 20x, since 2026-10-26, was team@sourcelibrary.org; cloudlayer: account@example.com, l7a: team@sourcelibrary.org as of 2026-11-12), so spreading jobs across the boxes also spreads them across separate weekly limits.

## The spare lane on every box (#6395)

Each box is logged into a different Claude account (main: account@example.com, Max 20x, since 2026-10-26, was team@sourcelibrary.org; cloudlayer: derek@playpowerlabs, l7a: team@sourcelibrary.org, gex45: derek@sourcelibrary.org, the laptop's own account, both as read 2026-11-12 by `job-where.sh`; see `needs/stewardship.md`). `scripts/workers/spare-lane.py` runs from cron on all four and spends that account's allowance on small issues when the account is under its fair share of the week. Only main polls usage. It publishes the poll to Mongo (`ops_reports` `claude-limits:latest`, `claude-limits-share.mjs`), and the guests read it there, because no box can ssh to another. Cron: main `*/30` (in `crontab.production`); guests `15,45 * * * *`, logging to `/data/scratch/sl/logs/spare-lane.log`, guarded on the script existing; gex45 `10,40` (in `infrastructure/gex45-crontab`), live since the 2026-10-26 login. Jobs are named `spare-<issue>`, at most 2 on main and 1 on a guest, and an issue the lane picks is labelled `spare-lane` so no other box takes it. Before it starts anything the lane asks `claude-job.sh where` and waits for its next run unless the answer is `ready=yes` (#70): until 2026-11-12 it checked only the 1-minute load, so on a box with a full root disk it called `start` every 30 minutes and every refusal was a high page. In an account's last 6 h it drains: it starts jobs up to 99% of the week, past the usual 90% refusal, because what is left then expires unused (no start in the final hour; extra usage is off on every account). In the last 48 h of an account's week, when no issue is eligible, it runs a paired-fifths round instead (`spare-pf-<date>-<n>`, same cap, logged `reason: fallback audit`; `scripts/audit/spare-paired-fifths.mjs`, v3#197): 24 served books drawn uniformly inside language × print/manuscript cells, emptiest cell this month first, and 16 from `book-check-priority.mjs`, each read by Opus a pair of facing pages at a time. The verdicts are `book_checks` rows, which the Monday loop turns into repair-queue rows. It posts that account-week's rounds as one pooled comment on #6420 after the reset (#6781). `SPARE_LANE_ROUND=convergent` in the cron line brings back the Opus-only #6420 convergent round (`spare-audit-<date>-<n>`) it replaced.

## A second Claude login on one box (2026-10-26)

An account with no box of its own (account@example.com, added 2026-10-26) can share gex45. It gets its own config dir, logged in once by hand with `CLAUDE_CONFIG_DIR=/root/.claude-milo claude`. To start a job on that login, run `JOB_CLAUDE_HOME=/root/.claude-milo claude-job.sh start <name> <brief>`. The dir is recorded in `<name>.claude-home` beside the brief, so `resume` and `sweep` keep the job on the same login. The weekly-limit check reads that login's account too. Jobs started without it use the box's own login, as before. The spare lane is not affected.

A login can only run jobs if its `settings.json` carries the job permissions: `Bash` in `permissions.allow`, and every allow rule the box's own login (`/root/.claude/settings.json`) has. `start` and `resume` check this and refuse with exit 9 otherwise (v3#176: on 2026-11-12 four jobs started on `/root/.claude-derek`, which has a hook and no permissions block, and were refused almost every command). `JOB_IGNORE_PROFILE=1` skips the check.

`start` refuses with exit 10 when its `Lands:` issue has a claim comment (a line starting `taking` or `claiming`) in the last 12 h that does not name this job, and prints who claimed it and when (#239; on 2026-11-13 a second job was started on #244 48 min after `error-zoo-site-244` claimed it). Override: `claude-job.sh start --force-claim <name> <brief>`, or a `Force-claim: <why>` header line in a brief sent through `box.sh`.

## The job ledger: who launched what, and why (#8606)

Every `claude-job.sh` start, DONE and stop writes one record: the job, its box, Lands, Route, the brief's `WHY:` and hash, and who launched it. The launcher is `via` (box-rpc, ssh or local), `from_box` and the dispatching session. Records go to the private ops repo, `jobs/ledger/YYYY-MM/<ts>_<box>_<job>_<event>.json`, one file each so two boxes never conflict. A record waits in `$JD/ledger-spool` until its push lands, and `sweep` retries. GitHub is the store every box and the phone can reach with the laptop off.

- `job-ledger.sh show [days]`: every box's records, newest first.
- `job-ledger.sh why <job>`: one job's start, with its launcher, route and why.
- `box.sh <box> ledger` / `box.sh <box> brief <job>`: that box's local records, and what the job was told.

ssh does not carry the caller's environment, so `box.sh … start` appends a `Dispatched-by: <box> session <id> job <name>` line to the brief. **Start jobs on another box through `box.sh <box> start`, never a root ssh.** A root ssh is logged only as `ssh from <box>`, with no session.

## Placing a job: ask before you start

```
scripts/workers/job-where.sh
```

It asks each box for `claude-job.sh where` (load, free memory, free job disk, live jobs, and whether the box is ready to run a job at all) and each box account's Claude headroom (5-hour %, week % and hours to reset, the week that would go unused at its pace; from `ops_reports` `claude-limits:latest`). Load, memory and disk only filter; it drops accounts at >= 80% of their 5-hour window or >= 90% of their week, and names the box whose account has the most week left per hour to its reset (#6751). Start the job there:

```
/root/bin/box.sh <box> start <name> < brief.txt      # from a box; logged, and the job ledger records who sent it (#8606)
```

Do not default to main. On 2026-10-09 main sat at load 17 on 16 cores with its root disk 86% full while cloudlayer ran no jobs.

### One answer to "may a job start here now?" (#70)

`claude-job.sh where` ends with `ready=yes` or `ready=no:<reason>[,<reason>]`. One function in the wrapper (`ready_state`) computes it, and `start` takes its refusals from the same function, so `start` cannot refuse for a reason `where` did not give. Anything that places a job reads `ready=` first: `job-where.sh`, `box.sh pick` (and so the weekly-cap move) and `spare-lane.py`.

| Reason in `ready=no:` | Meaning | What `start` does | Switch |
|---|---|---|---|
| `no-claude`, `claude-not-logged-in`, `gh-not-logged-in`, `no-env-file`, `no-node_modules`, `no-bash-permission` | the box is not set up to run a job | prints a `warn:` line and goes on; the login preflight still refuses a box that is logged out (exit 7) | none |
| `root-NNpct-free` | under 15% of the root disk is free (`MIN_ROOT_FREE_PCT`) | refuses, exit 5, and pages high | `JOB_IGNORE_DISK=1` |
| `load-N.NN-per-core` | the 5-minute load is over 1.5 per core (`MAX_LOAD_PER_CORE`) | prints a `warn:` line and goes on | `JOB_IGNORE_LOAD=1` |
| `weekly-NNpct` | the box's Claude account is at 90% or more of its week (`MAX_WEEKLY_PCT`) | refuses, exit 6 | `JOB_IGNORE_LIMIT=1` |

- A switch changes `where` and `start` together. The spare lane's drain sets `JOB_IGNORE_LIMIT=1` before it asks `where`, so the drain is not held at 90%.
- Load and setup are placement reasons: nothing that places jobs picks the box, but a `start` that names the box still runs. Load does not refuse because some jobs can run on one box only (the GPU rescue job that `ocr-filler.sh` starts on gex45), because cron callers that name their box page or stop their lane when a start fails (`gex45-idle-alert.sh`, `page-frame-sweep-waves.sh`), and because a start that arrives through the mesh cannot pass a switch. On 2026-11-13 gex45 stood at 4.8 per core and cloudlayer at 1.6.
- Before #70, `ready=` covered only the setup reasons and the week. On 2026-11-12 gex45 printed `ready=yes` at load 110 on 20 threads with 13% of its root disk free, while `start` there refused and paged.

## The brief: two header lines

Every brief carries these in its first 15 lines:

```
Lands: #6358
PR: yes
```

- `Lands: #NNNN` is the issue the job reports on. `Lands: none` means no comment is expected.
- `PR: yes|no` says whether a pull request is expected.

`start` prints a note when they are missing. Without them the wrapper guesses: the issue is the number the job name ends in (`second-reader-6338`), else the first `#NNNN` in the brief; a PR is expected only if the worktree holds commits beyond main. The guess is what paged Derek "did NOT land" for 58 of 113 finished jobs: the first number in a brief is often a cross-reference.

**A third line for OCR and translation briefs: `Route:` (#7701).** If a brief runs a lane that writes page text, or says it will OCR, translate or correct books or pages *and* writes, it names its cell in the router table (#6740, `scripts/eval/estimator/router-table/`). There are three accepted forms:

```
Route: German print, lite text → lite>agy-flash-low 28/30
Route: untested → cell test (30 pages, one per book, blind Opus judge)
Route: none — eval only, no production writes
```

`start` refuses such a brief with exit 8 when the line is missing, or when it is a bare model name. The check is `scripts/workers/brief-route-check.sh <brief>`, and you can run it on a draft brief. Why it is a check: on 10-28 and again on 10-29 an OCR job was dispatched on a model picked by habit. Both times Derek asked "is the router being used?"

**A translation Route must match the live router (#8606).** The router-table files are dated evals. `scripts/lib/translation-routing-table.json` is what the pipeline routes by today. When a translation Route names one engine (Claude, agy or Flash-Lite) and the live table's row for that language names another, `start` refuses. On 2026-11-11, `kangyur-finish-8482` cited the 10-27 Tibetan table and ran Opus, while #8596 had moved Tibetan to agy that same day. To differ on purpose, say why on the Route line: `… → opus-cli 27/30 (override: <why>)`. A Route that defers to the table per book is not checked.

**A fourth line for a job that reads pages against their images: `Checks:` (#8069).** It says where the verdicts go, so they outlive the job's scratch folder: a method id whose rows reach `book_checks` (`recordPageVerdicts()` in `scripts/lib/book-checks.mjs`, one method file in `scripts/eval/methods/`), or `none` with a reason. `start` prints a warning when it is missing and never refuses.

```
Checks: lane-spot-check
Checks: none — candidate text never written; the verdicts land in the experiment file
```

**An optional line: `Skill: <name>[, <name>]` (#6553).** A job uses a repo skill only when its brief names it. Across 370 job transcripts on cloudlayer, `review` was the only skill ever invoked. The wrapper puts the named skills into the prompt as an instruction: invoke each one before the step it covers, and count its script checks as part of done. `start` prints a note when a named skill is not in `.claude/skills/`. For a test of two or more arms with a blind judge, name `Skill: paired-arm-judge`.

## A follow-up job on the same issue: the null-result stop rule (#7869)

A job whose issue already had a job land in the last 48 h must say in its brief which decision it would move:

```
Moves: switch the Tibetan default from lite to flash if flash wins 25/30
```

This applies most of all when the earlier job landed "nothing switches" or another null result. If you cannot name a decision the new job could change, do not dispatch it. Repeat the eval only when the inputs have changed, and say in the brief what changed. Why: in the week to 2026-10-31, four read-surface jobs ran after the first had found nothing to switch (#7830). They took 63% of the milo account's last 24 h (≈ $10–14 a week, the 2026-10-31 value audit).

`start` runs this check inside `brief-route-check.sh`. It never refuses. When the brief's `Lands:` issue appears in a landing from the last 48 h, on this box's `landings.txt` or another box's through the mesh, and the brief has no `Moves:` line, `start` prints a `warn:` line.

## Job-session thrift: fresh sessions and Sonnet subagents (#7869)

**Fresh session per stage.** Every turn re-reads the whole context, so cost grows with the square of a session's length. On cloudlayer, cache reads were 53% of job transcript cost in the week to 2026-10-31. The wrapper cannot cut a `claude -p` mid-turn, so the job makes the cut itself, and only at a stage boundary:
1. The job runs `claude-job.sh ctx <name>` at each stage boundary (the HEADLESS RULES say when). It reads the last main-chain turn of the job's newest transcript and prints `FRESH` at 150K context or more.
2. If work remains, the job writes `$JD/<name>.state.md` and ends its turn without the done file. The file is under 60 lines: done (with links), next, paths, detached processes, notes acted on.
3. The wrapper sees a state file newer than `$JD/<name>.session`, which is touched at every session start. It starts a fresh session in the same worktree from the HEADLESS RULES, the brief and the state file, instead of `--continue`.

More rules:
- A long session that exits without a state file is resumed with one instruction: write the state file now.
- `resume` and the sweep honour a pending state file the same way.
- Fresh sessions do not spend resumes. `MAX_FRESH` (12) caps them.
- A job moved on the weekly cap carries its last state file into the `-mv` brief.
- Tuning: `JOB_FRESH_CTX=<tokens>`; `0` turns the rule off.

Measured on 45 cloudlayer job transcripts from 2026-10-24 to 11-01, cutting at the first commit, push or comment past 150K: 28.5% of main-chain cost saved, and 49% on estimator-v2-6740 (one session, 320 turns, 479K mean context). The measurement does not count what a fresh session spends re-reading files, so the real saving is lower.

**Subagents on Sonnet.** Every job session runs with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`. Subagents were 11% of transcript cost, all of it Opus. A brief that needs Opus subagents says so in its first 15 lines: `Subagents: opus — <why>` (for example, a judge that must match the production reader). The job's own model stays Opus. An Agent call with an explicit `model: "opus"` stays on Opus under this default (tested 2026-11-03), so a job with one judging step passes that on the one call and needs no header. Anything that judges, reads page images or translates must name its model: a skill that says "Opus reviewer" and passes none would run on Sonnet without a word.

**Main session on Sonnet, opt-in.** The job's own session is Opus unless the brief says `Model: sonnet — <why>` in its first 15 lines. Use it only for a job whose own turns are mechanical: babysitting a runner, waiting on CI, merging, copying files between boxes. A job that judges, writes prose or decides what a result means stays on Opus. The log's first `[claude-job]` line names both models. Measurement and risk: `scripts/eval/experiments/2026-11-04-pace-guard-and-sonnet-main-7869.md`. `Model: fable — <why>` runs the main session on Fable 5.2: use it to spend an account's weekly Fable bucket before it resets, on a box whose account has Fable headroom (`climits status`).

**The pace guard paces main sessions too (#7869).** `claude-pace-guard.sh` is the box's `claude`. A `claude -p` call takes one of the account's slots (12, down to 2 when the account burns faster than its weekly budget). A job's main session (`claude-job.sh` sets `CLAUDE_PACE_AGENT=1`) takes a slot from a separate pool of the same size, so an over-pace account runs at most that many main sessions per box and the rest wait at their next stage start. On the guests, main sessions ran the real CLI until 2026-11-04 and were never paced. Burn comes from climits' 5-min history on main; `box.sh push-limits` adds it to the meter it copies (`burn_pct_per_h`). When the meter cannot speak for a login (climits' grant revoked, mesh down), the guard reads the week from that login's own usage endpoint, at most every 5 min and without refreshing its token, and marks the reason `src=login` (#8168). Only that read covers the guard: `where`'s `weekly_pct` and the 90% start refusal still read the meter, so the climits grant still needs `climits add <email>` on main. When it can read neither it fails open, and says so: `claude-job.sh where` prints `pace=<slots>/<why>/<age>`, `/root/claude-pace/failopen.log` keeps every fail-open decision, and over an hour of steady fail-open pages ntfy (again daily, and low when it is paced again). `install-claude-job.sh` installs the guard wherever `/usr/local/bin/claude` already links to it.

**Hard backstop: auto-compact at about 300K.** The fresh-session rule only fires when a job reaches a stage boundary and asks. A single long stage never asks, so every job session also runs with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=30`: 30% of the 1M window. Compaction is blunt: it can land mid-step and keep only a short summary (measured 184K down to 7K), which is why the state file at 150K stays the first choice. A brief that cannot survive it says `Compact: off — <why>` in its first 15 lines. Tuning: `JOB_COMPACT_PCT=<percent>`.

**Per-item `claude -p` calls run lean.** A script that calls `claude -p` once per page or item pays to load the whole Claude Code system prompt and tool list on every call. Cache writes, which are that load plus each item's own prompt, were 84% of ch-audit's cost in the week to 2026-11-03, and 47–73% of the Sanskrit adjudicator and the split-unread screen. Give each call only what it uses: `--tools ""` or `--tools Read`, `--strict-mcp-config`, `--setting-sources local`, `--disable-slash-commands`, `--no-session-persistence`, and a one-line `--system-prompt` when it needs no tools. `scripts/audit/leaf-shift-screen-5021.mjs` is a working example. Use `--model sonnet` where the job is a screen rather than a judgement. `--no-session-persistence` leaves no transcript, so these calls are missing from `usage_report.py`; log their usage to the job's own output.

## Working on another box from a job: the mesh verbs, not a root ssh (#8614)

A job on one box that needs another box (most often gex45's GPU) uses `box.sh <box> <verb>`. It does not use `ssh root@<box>`: a raw shell is unlogged and unbounded, and agent-guard flags it as `raw-ssh`. The verbs are logged in the far box's `/var/log/box-rpc.log` and stay inside the job and log trees:

| need | verb |
|---|---|
| GPU and queue state | `box.sh gex45 gpu` |
| queue a GPU task | `box.sh gex45 gpu-add NN-name < task.sh` (needs a `# issue: NNNN` line; same contract as `gpu-queue.sh add`) |
| read a log or output | `box.sh <box> tail /root/jobs/<job>/<file> [lines]`, `box.sh <box> ls /root/jobs/<job>` |
| copy code or data in | `box.sh <box> put /root/jobs/<job>/<path> < file` (20 MB max) |
| load, memory, disks | `box.sh <box> health` |
| start a job there | `box.sh <box> start <name> < brief` |
| mark its decisions triaged | `box.sh <box> decisions-mark < marks.txt`, one `[TRIAGED <date> …] <the row exactly as it stands>` line per row (or `[DECIDED …]`); only exact, still-unmarked rows change, nothing is added or removed (#90) |

Anything else (crontab, systemd, installing packages, editing `/root/bin`) is a change to that box: a PR to `infrastructure/<box>-crontab` or the installer, or a job started ON that box, never a remote shell.

## Steering a running job: the inbox (#6534)

```
ssh root@<box> /root/bin/claude-job.sh note <name> "score recitation cuts as unscored, not 100% error"   # from the laptop
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
- **The same move by hand: `claude-job.sh move <name> [box]` (#70).** Run it on the box the job is on. It stops the job as `stop` does, checkpoints its worktree to a branch, and starts `<name>-mv` on the named box, or on the one `box.sh pick` names, through the mesh's `start` verb. Nothing is copied box to box: the work travels as the git branch, and the brief and the last state file travel inside the new brief, so scratch files and detached processes on the old box do not move. It refuses, and leaves the job running, when there is no such job (exit 1), or the job is already a `-mv` job, has finished, or the target does not answer `ready=yes` (exit 3). If the job was stopped but the push or the far start failed it says `NOT MOVED` (exit 4) and gives the `resume` line. The job ledger gets a `moved` record here and the new job's `start` record on the other box. Do not run it from inside the job being moved: stopping the job kills the caller.
- **No placement on a box that cannot run a shell command.** Jobs run with `--permission-mode acceptEdits`, so `/root/.claude/settings.json` must allow `Bash` (or the job cannot write its done file and loops: earthai-l7a, 2026-10-09). `where` reports `ready=no:no-bash-permission` otherwise.
- **No placement on a spent account.** `start` refuses when this box's account is at or over `MAX_WEEKLY_PCT` (90) of its weekly limit, read from the climits meter (`/root/.claude-limits/latest.json`; it runs on main and `box.sh push-limits` copies it to the other boxes every 5 min; each box looks up its own login's account; absent or older than 30 min = no check). `where` prints `weekly_pct` and reports `ready=no:weekly-NNpct`, so `job-where.sh` skips the box. Override: `JOB_IGNORE_LIMIT=1`.
- **Not logged in fails loudly, once (#5627).** `start` and `resume` first ask `claude -p` (sonnet) for a one-word OK from the checkout, and refuse with exit 7 unless it answers (a usage-limit answer passes: that is a wait). A job whose log ends on `Not logged in` / `Please run /login` / an expired token is not resumed: it logs `NOT LOGGED IN`, checkpoints, pages high, and comments on its `Lands:` issue. The sweep holds a died job on a box that is logged out instead of spending its two resumes. Skip the preflight: `JOB_SKIP_PREFLIGHT=1`.
- **Jobs decide two-way doors.** The HEADLESS RULES let a job raise `DECISION:` only above the $10 spend floor or on the hold list; anything else it decides and logs as `TAKEN:` (collected into `taken.txt`). DECISION lines go to `decisions.txt` for the morning digest and no longer page one by one; each new one is also posted as a comment on the issue it names (its last `#NNNN`, else the brief's `Lands:`; `DECISION_COMMENTS=0` turns it off), and the digest counts the rows nobody has marked on every box (#8551).

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

## Moving a lane between boxes (#70)

A **lane** here is a cron line that does page work on a schedule (an hourly OCR, correction or translation run). Until now a lane ran on whichever box's crontab held its line, and moving one meant hand-editing two live crontabs.

- **The table:** `infrastructure/lanes.tsv`, one row a lane, four tab-separated columns: `lane` (a name), `box` (`main`, `cloudlayer`, `l7a`, `gex45`, or `off` for nowhere), `schedule` (five cron fields), `command` (the rest of the cron line, exactly as cron runs it).
- **The tool:** `scripts/workers/lanes-crontab.mjs` writes this box's rows into one block of root's crontab, between `# BEGIN lanes …` and `# END lanes`. It keeps every line outside the block byte for byte, and it knows which box it is on from the hostname (the names in `box.sh`).
  - `node scripts/workers/lanes-crontab.mjs` checks: it prints what the block would change and writes nothing. Exit 0 means nothing to do, 1 means a change or a hand action is waiting, 2 means it refused.
  - `node scripts/workers/lanes-crontab.mjs --apply` writes: it saves the old crontab to `/root/backups/lanes-crontab/<date>/crontab-<time>.before`, installs the new one, reads it back and compares. To undo: `crontab <that .before file>`.
  - From the laptop: `ssh gex45 crontab -l | node scripts/workers/lanes-crontab.mjs --box=gex45 --crontab=-`.
- **Today (2026-11-13) the table is empty and nothing applies by itself.** `install-claude-job.sh` runs the check after every pull and logs one `[lanes-crontab]` line (`/var/log/sourcelibrary/auto-pull.log` on main and gex45, `/data/scratch/sl/logs/pull.log` on cloudlayer and l7a). A merged row reaches a crontab only when someone runs `--apply` on that box. Automatic apply is a later change.
- **What it refuses.** A malformed table changes no crontab. A row whose command a hand-kept line already runs is left out and reported as `SKIPPED` (so the lane cannot run twice on one box). A row placed on another box while a hand line here still runs it is reported as `ELSEWHERE`. Broken or doubled markers are refused, not guessed at.

**Add a new lane.** Add a row in a pull request. The command must carry everything it needs (see "what must move" below). Also add its `CRON_ROWS` row in `scripts/lib/lanes.mjs`, as for any page-work cron line. After the merge and the next pull, run `--apply` on the row's box.

**Bring a hand-kept line into the table (migration).** One family of lanes a pull request.
1. Add the row with `box` set to the box where the line runs **now**, and the command copied exactly. Take the line out of that box's snapshot file in the same pull request (the lane-registry test reads both the snapshots and the table). `scripts/maintenance/router-board-push.mjs` still reads only the snapshots: the first migration pull request has to teach it the table, or `/admin/router` loses the lane. Do not change the box in this step: the new box would start the lane while the hand line still runs it on the old one.
2. After the merge and the pull, the check on that box says `SKIPPED lane <name>: already installed by hand (crontab line N)`.
3. On the box: back up (`crontab -l > /root/backups/crontab-<date>`), delete line N by hand, then run `--apply`. The lane is now inside the block, and the check says `in sync`.

**Move a lane.** Change its `box` cell. What happens on the boxes: the old box's next apply takes the line out of its block, so cron starts no further run there. A run already in progress finishes where it is (gex45's lane lines run under `timeout 110m`, so within 110 minutes). The new box's next apply adds the line.

A lane cannot run on two boxes at once, and its ledger has to arrive before its first run on the new box, so the order matters:
1. Stop it on the old box. While apply is by hand: merge the one-cell pull request and run `--apply` on the **old** box only. Once apply is automatic: first merge a pull request that sets the cell to `off`, because the boxes pull and run the installer at different minutes (main and gex45 at :17, cloudlayer and l7a at :23 and :28) and the new box could otherwise start before the old one stops.
2. Wait for the run in progress to end (`pgrep -af <the lane's script>` on the old box prints nothing).
3. Copy what must move (below) to the new box.
4. Start it on the new box: run `--apply` there (or, with automatic apply, merge the pull request that sets the cell from `off` to the new box).

**What must move with a lane.** Each of these was read in the code or on the boxes; a lane that moves without them fails quietly, not loudly.
- **Its ledger folder.** A lane's book claims and its "page tried, never try again" ledger are local files. `claimBook` in `scripts/batch/cli-ocr-lane.mjs` takes a book by creating `<ledger dir>/claims…/<book>.json` and tests the holder by process id, and the ledgers (`first-read-ledger.jsonl`, `correct-ledger.jsonl`, `gpu-correct-ledger.jsonl`, `armc-ledger.jsonl`) are in the folder above the lane's dated `--out` folder, or in its `--lane-dir`, under `/root/jobs/…`. A box without them takes books another box holds and tries again every page the old box had written off. From the laptop: `ssh <old> 'tar -C /root/jobs -cf - <lane folder>' | ssh <new> 'tar -C /root/jobs -xf -'`.
- **The finish-first stamp.** The finishing lanes write `/root/agy-quota/finish-queue` (`FINISH_QUEUE_DIR` in `scripts/lib/agy-pools.mjs`) and the quality lanes read it to leave them quota. As a local folder it is invisible to a quality lane on another box, and the finish-first order (#8482) then stops holding with no error. PR #205 also publishes the stamp to Mongo (`ops_reports`, `finish-queue:<lane>`) so any box reads it. Until that is merged and pulled on both boxes (`git grep -n 'finish-queue:' scripts/lib/agy-pools.mjs` finds it), move the finishing lanes and the lanes that yield to them together; after it, they can sit on different boxes.
- **Its `CRON_ROWS` row.** `scripts/lib/lanes.mjs` matches every live line to a row **by box**. Change the row's `box` in the same pull request, or `/admin/pipeline/now` shows the moved line as `UNREGISTERED` (or `RETIRED BUT LIVE`: main has a retired row for the correction lane).
- **The logins it names.** An `--agy-home=/root/.agy-james` needs that folder on the new box, answering `/quota`.
- **Paths and environment.** The checkout is `/root/sourcelibrary` on main and gex45 and `/data/scratch/sl/sourcelibrary` on cloudlayer and l7a. gex45's crontab sets `PATH`; the other three set no variables (read 2026-11-12). So a command sets its own `PATH` and uses full paths, as today's lane lines do.
- **Hardware.** A lane that drafts on the GPU stays on gex45. The three ARM boxes have no Python ML tools.

Page text and holds are in Mongo, and lock files and logs start fresh on the new box. This list is what was found on 2026-11-12, not a proof that nothing else is local: before the first move of a family, search its script for `/root/` and `os.tmpdir()`.
