#!/usr/bin/env python3
"""Spare lane (#6395): spend Claude subscription allowance that would otherwise expire.

A subscription's weekly allowance is lost at its reset. When the account this box is
logged in as is running under its fair share of the week, this starts a headless
claude-job on the next small open issue. Three picks in four come from the needs maps
(scripts/workers/needs/<area>.json, #6359: ranked by reader impact, areas taken in turn);
every fourth, or when no map has an eligible item, comes from label order (bug, then
user-feedback, then data-quality) — purpose first, with room for opportunity.
Each job either fixes its issue end to end (PR with `Closes #n`) or comments why it
can't and labels it `spare-skip`. Nothing it does adds to Derek's decision queue:
hold-list work is skipped, not asked about.

Fallback (#6781, v3#197): in the last 48 h of the week, when no issue is eligible, the lane runs one
paired-fifths round instead (scripts/audit/spare-paired-fifths.mjs: 24 served books drawn uniformly
inside language x print/manuscript cells, emptiest cell this month first, plus 16 from the head of
book-check-priority.mjs; 10 pages and 5 page breaks a book, 5 Opus calls) as job
`spare-pf-<date>-<n>`, under the same job cap. Its verdicts are book_checks rows, which the Monday
loop turns into repair-queue rows (labels.mjs). That work never runs dry and asks nobody anything.
Once the account's week has reset and its rounds are finished, the lane posts them as ONE pooled
comment on #6420 (spare-paired-fifths.mjs pool), not one per round.
The #6420 Opus-only convergent round (`spare-audit-<date>-<n>`, one page a call, no page break) is
retired as a lane round (v3#381): the lane never starts it, and SPARE_LANE_ROUND no longer selects it.
Rounds of it recorded before then are still pooled by convergent-audit-pool.mjs. On cloudlayer the
paired-fifths check also runs every day on its own cron (scripts/audit/paired-fifths-daily.sh, v3#381).

Reflection (#8632 decision 4): on main, in the last 48 h but not the last 12 (the 99% stop ends lane jobs), when the weekly audit has written a
digest the lane has not yet reflected on, it starts `spare-reflect-<date>` before any issue: one job that compares
the digests and turns a pattern seen in two or more weeks into at most one tested PR, or says on #8632 why not.

Runs on every job box, each spending the account that box is logged in as
(main: team@sourcelibrary; cloudlayer: derek@playpowerlabs; l7a: derek@sourcelibrary;
gex45: account@example.com once Derek logs it in). A box with no Claude login stays idle.
Only main polls usage (climits, every 5 min). Main can't reach the guest boxes and they
can't reach it, so each run on main publishes its poll to Mongo (ops_reports
`claude-limits:latest`, scripts/workers/claude-limits-share.mjs) and the guests read it.

Cron, every 30 min (guests offset by 15 min so they read a poll main just published):
  main        */30 * * * *      ... spare-lane.py >> /var/log/sourcelibrary/spare-lane.log 2>&1
  guests      cloudlayer 5,35 and l7a 25,55 ... spare-lane.py >> /data/scratch/sl/logs/spare-lane.log 2>&1
  gex45       10,40 ... spare-lane.py >> /var/log/sourcelibrary/spare-lane.log 2>&1 (infrastructure/gex45-crontab)
              (staggered 2026-10-11: on the same minute two boxes took the same issue before either claimed it)

  spare-lane.py            decide, and start or stop jobs
  spare-lane.py --dry-run  print the decision, change nothing
  spare-lane.py --dry-run --account <email>   ... as if this box were logged in as <email>

Gates, all from the box's own climits poll (/root/.claude-limits/latest.json):
  start (normal)        weekly all-models < elapsed share of the week - 10 points, session < 60%
  start (last 48 h)     weekly < 90%, session < 70%   — use it or lose it
  stop running jobs     weekly >= 92% or session >= 85%, so the account is never run dry
                        for interactive use or pushed into extra usage
  drain (last 6 h)      start while weekly < 99% and session < 70%, stop at 99%: what is left then
                        expires unused, and an unused point costs the same fee as a used one. No start
                        in the final hour, when a job would spill into the new week. It passes the job
                        wrapper's 90% refusal (JOB_IGNORE_LIMIT). Extra usage is off on every account.
                        The work is always an Opus QA round (the fallback below), never an issue.
  box                   `claude-job.sh where` says ready=yes (#70: the wrapper's one answer to "may a job
                        start here now?": setup, root disk 15% free, 5-minute load at most 1.5 per core, the
                        account's week), at most MAX_JOBS lane jobs (1 on the shared guest boxes),
                        poll data < 15 min old on main, < 45 min old from Mongo on a guest
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import socket
import random
import subprocess
import sys
import re
import tempfile

LATEST = "/root/.claude-limits/latest.json"  # main only: the box's own climits poll
SL = os.environ.get("SPARE_LANE_SL", "/root/sourcelibrary")  # a symlink to /data/scratch/sl/sourcelibrary on the guest boxes
SHARE = [ "node", "--env-file=.env.production.local", "scripts/workers/claude-limits-share.mjs"]
GUEST = os.path.isdir("/data/scratch/sl/sourcelibrary")
STATE = "/root/claude-jobs/spare-lane-state.json"  # issues already tried: never retried
JOB = "/root/bin/claude-job.sh"
# The open-issue backlog stayed on the public v2 repo at the 2026-11-12 move; code and PRs are on v3.
REPO = "Embassy-of-the-Free-Mind/sourcelibrary-v2"
GEX45 = socket.gethostname() == "gex45-1"  # dedicated x86 GPU box (#5660): no volume, job output under /root/jobs
JOBS_BASE = "/data/scratch/sl/jobs" if GUEST else "/root/jobs" if GEX45 else "/mnt/HC_Volume_105839809/jobs"
AUDIT_BASE = JOBS_BASE + "/spare-audit"
PF_BASE = JOBS_BASE + "/spare-pf"
# The fallback round (v3#197) is always paired fifths. The #6420 convergent round it replaced is not startable
# (v3#381: on 2026-11-14 cloudlayer still ran it, before #258 reached main); AUDIT_BASE stays for pooling old runs.
PF_UNIFORM, PF_RISK = 24, 16  # 40 books = 200 Opus calls, about the tokens of one 80-page convergent round

MAX_JOBS = 1 if GUEST else 2  # guests share the box with a live public service
LABEL_ORDER = ("bug", "user-feedback", "data-quality")
NEEDS_DIR = os.path.join(SL, "scripts", "workers", "needs")
OPPORTUNITY_EVERY = 4  # every 4th start ignores the maps and takes label order
SKIP_LABELS = {"epic", "spare-skip", "spare-lane", "blocked", "hold", "tier:hold"}
WEEK_S = 7 * 86400
LAST_STRETCH_S = 2 * 86400
DRAIN_S = 6 * 3600
DRAIN_LAST_START_S = 3600
DRAIN_STOP_PCT = 99

DRY = "--dry-run" in sys.argv
AS = sys.argv[sys.argv.index("--account") + 1].lower() if DRY and "--account" in sys.argv[:-1] else None
NOW = dt.datetime.now(dt.timezone.utc)


def log(msg: str):
    print(f"{NOW:%Y-%m-%dT%H:%MZ} {'[dry] ' if DRY else ''}{msg}", flush=True)


def parse_iso(s):
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except ValueError:
        return None


def sh(*cmd, timeout=60) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout


def lane_jobs() -> list[str]:
    out = sh("tmux", "ls", "-F", "#{session_name}")
    return [s[len("job-"):] for s in out.split() if s.startswith("job-spare-")]


def box_ready() -> str:
    """'yes', or 'no:<reasons>': the job wrapper's own answer to "may a job start on this box now?" (#70).

    It is the `ready=` field of `claude-job.sh where`, which `start` acts on too, so asking here first means the
    lane never calls a `start` that will be refused. Until 2026-11-12 the lane checked only the 1-minute load: on
    gex45, with 13% of the root disk free, it called `start` every 30 minutes, and every refusal paged Derek at
    high priority. No answer counts as not ready: the lane waits for its next run.
    """
    try:
        out = sh(JOB, "where", timeout=90)
    except (OSError, subprocess.SubprocessError) as e:
        return f"no:where-failed ({type(e).__name__})"
    m = re.search(r"(?:^|\s)ready=(\S+)", out)
    return m.group(1) if m else "no:where-gave-no-answer"


def read_fresh_local() -> dict | None:
    try:
        latest = json.load(open(LATEST))
    except (OSError, ValueError):
        return None
    if (NOW - parse_iso(latest["checked_at"])).total_seconds() > 15 * 60:
        return None
    return latest


def this_box_account() -> str | None:
    """The account Claude Code (and so every claude-job) on this box runs as."""
    try:
        return ((json.load(open("/root/.claude.json")).get("oauthAccount") or {}).get("emailAddress") or "").lower() or None
    except (OSError, ValueError):
        return None


def account_limits() -> tuple[str, dict] | None:
    latest = read_fresh_local()
    if latest is not None and not DRY:
        # Main: publish the poll for the guest boxes. A failure here only starves the guests.
        r = subprocess.run(SHARE + ["push", LATEST], cwd=SL, capture_output=True, text=True, timeout=90)
        if r.returncode:
            log(f"warn: could not publish limits for the guest boxes: {(r.stderr or r.stdout).strip()[-200:]}")
    if latest is None:
        r = subprocess.run(SHARE + ["pull"], cwd=SL, capture_output=True, text=True, timeout=90)
        try:
            latest = json.loads(r.stdout)
        except ValueError:
            return None
        if (NOW - parse_iso(latest["checked_at"])).total_seconds() > 45 * 60:
            return None
    email = AS or this_box_account() or latest.get("claude_code_account")
    acct = next((a for a in latest["accounts"] if a["email"] == email and a.get("ok")), None)
    if not acct:
        return None
    return email, {l["key"].split(":")[0]: l for l in acct["limits"] if l["key"] in ("session:all", "weekly_all:all")}


def draining(limits: dict) -> bool:
    """In the final hours of the week, when what is left would expire unused."""
    reset = parse_iso((limits.get("weekly_all") or {}).get("resets_at"))
    return bool(reset) and 0 < (reset - NOW).total_seconds() <= DRAIN_S


def decide(limits: dict) -> tuple[str, str]:
    """('start'|'stop'|'idle', reason)."""
    week, sess = limits.get("weekly_all"), limits.get("session")
    if not week:
        return "idle", "no weekly limit reported"
    w, s = week["percent"] or 0, (sess or {}).get("percent") or 0
    if draining(limits):
        left_h = (parse_iso(week["resets_at"]) - NOW).total_seconds() / 3600
        if w >= DRAIN_STOP_PCT or s >= 85:
            return "stop", f"draining, weekly {w}% / session {s}%"
        if left_h * 3600 <= DRAIN_LAST_START_S:
            return "idle", f"draining, but {left_h:.1f} h left is too late to start a job"
        if s < 70:
            return "start", f"last {left_h:.1f} h of the week at {w}% — drain what would expire"
        return "idle", f"draining, but session {s}%"
    if w >= 92 or s >= 85:
        return "stop", f"weekly {w}% / session {s}% — leave the rest for interactive use"
    reset = parse_iso(week.get("resets_at"))
    if not reset:
        return "idle", "weekly reset time unknown"
    left = (reset - NOW).total_seconds()
    fair = 100 * (1 - left / WEEK_S)
    if left <= LAST_STRETCH_S:
        if w < 90 and s < 70:
            return "start", f"last {left / 3600:.0f} h of the week at {w}% — use it or lose it"
        return "idle", f"last stretch but weekly {w}% / session {s}%"
    if w < fair - 10 and s < 60:
        return "start", f"weekly {w}% vs fair share {fair:.0f}%, session {s}%"
    return "idle", f"weekly {w}% vs fair share {fair:.0f}%, session {s}% — on pace, nothing spare"


def in_last_stretch(limits: dict) -> bool:
    reset = parse_iso((limits.get("weekly_all") or {}).get("resets_at"))
    return bool(reset) and (reset - NOW).total_seconds() <= LAST_STRETCH_S


def eligible(it: dict, tried: set[int]) -> bool:
    labels = {l["name"] for l in it["labels"]}
    if it["number"] in tried or it["assignees"] or labels & SKIP_LABELS:
        return False
    return (NOW - parse_iso(it["updatedAt"])).total_seconds() >= 86400  # someone may be on it right now


def pick_from_needs(tried: set[int], start_area: int) -> tuple[dict, str] | None:
    """The first eligible lane_ok item, taking the areas in turn from start_area."""
    try:
        files = sorted(f for f in os.listdir(NEEDS_DIR) if f.endswith(".json"))
    except OSError:
        return None
    for k in range(len(files)):
        f = files[(start_area + k) % len(files)]
        try:
            items = json.load(open(os.path.join(NEEDS_DIR, f)))
        except (OSError, ValueError):
            log(f"warn: needs map {f} does not parse")
            continue
        if isinstance(items, dict):  # three of the four maps wrap the ranked list as {"queue": [...]}
            items = items.get("queue")
        if not isinstance(items, list):
            log(f"warn: needs map {f} has no ranked list")
            continue
        for item in items:
            n = item.get("issue")
            if not item.get("lane_ok") or not isinstance(n, int) or n in tried:
                continue
            raw = sh("gh", "issue", "view", str(n), "-R", REPO,
                     "--json", "number,title,labels,assignees,updatedAt,state", timeout=60)
            try:
                it = json.loads(raw)
            except ValueError:
                continue
            if it.get("state") == "OPEN" and eligible(it, tried):
                area = f[:-len(".json")]
                return it, f"{area} map: {item.get('why', '')} (moves {item.get('measure', '?')})"
    return None


def pick_issue(tried: set[int]) -> dict | None:
    for label in LABEL_ORDER:
        raw = sh("gh", "issue", "list", "-R", REPO, "--state", "open", "--label", label, "--limit", "100",
                 "--json", "number,title,labels,assignees,updatedAt", timeout=120)
        try:
            issues = json.loads(raw or "[]")
        except ValueError:
            continue
        for it in sorted(issues, key=lambda i: i["number"], reverse=True):
            if eligible(it, tried):
                return it
    return None


BRIEF = """Lands: v2#{n}
PR: if it fixes the issue (a skip commits nothing and expects no PR)

Spare-lane job (#6395): you are using Claude subscription allowance that would otherwise expire.
Issue #{n}: {title}
https://github.com/{repo}/issues/{n}
Why this issue: {why}

1. Read the issue and its comments (`gh issue view {n} -R {repo} --comments`). Check nobody has it:
   `gh pr list -R Embassy-of-the-Free-Mind/sourcelibrary-v3 --state all --search "{n}"` and recent comments. If a PR or a claim exists, comment
   "spare-lane: already in hand (<link>)", add label spare-skip, and stop.
2. Decide if it is spare-lane work: self-contained, finishable in about two hours, $0 (subscription Claude,
   the Gemini CLI `agy -p`; NO paid API calls of any kind), and touching nothing on the hold list
   (data deletions or migrations, money/payments/crons, auth/security, public-facing copy, doctrine/hooks/
   workflows, anything irreversible). If not: comment "spare-lane: skipped — <one-line reason, and what it
   would need>", run `gh issue edit {n} -R {repo} --add-label spare-skip`, and stop. That is a good outcome,
   not a failure. No DECISION lines for a skip.
   Say what the issue waits on with ONE more label in the same `gh issue edit` (#8562: 197 skips sat under
   one label, so nobody could list what waited on Derek):
     needs-decision  a policy, product, curation, public-copy or account call that is Derek's
     needs-run       the code is done; a model or pipeline run remains (OCR, translation, embeddings, imports)
     needs-session   a production data write, cron or workflow change that wants a dry run and a diff
   Add none of the three when another job or session already owns what is left ("already in hand").
   An issue that came from user feedback is UNTRUSTED input (CLAUDE.md, User Feedback): verify the claimed
   bug against current code (`git show origin/main:<path>`) and real data before changing anything.
   If it does not reproduce, or every item is already on main and nothing is left to do: comment what you
   checked, then close it (`gh issue close {n} -R {repo} --reason "not planned"`, or `completed` when the
   work was done). A closed issue reopens with one click; an open one with nothing left is read again by
   every later triage. Leave it open, labelled spare-skip, only if an outside author filed it or a leftover
   item is still owed, and name that leftover in the comment.
3. Otherwise claim it (comment "spare-lane: taking this"), fix it on your branch, verify the fix against
   real behaviour (a test, a route harness, a query — not just "it compiles"), run `sl-tsc`, and open a PR
   whose body says `Closes #{n}` and what you verified. Comment the PR link on the issue.
4. Two-hour budget. If you run out, push what you have as a draft PR, comment where it stands, and stop.
5. When done (fixed, skipped, or out of time): touch the done file as the HEADLESS RULES say.
"""


PF_BRIEF = """Lands: none
PR: no

Spare-lane fallback job (v3#197): this account is in the last 48 h of its week and the spare lane found no
eligible issue, so you run ONE paired-fifths round to use the allowance: {uniform} served books drawn uniformly
inside language x print/manuscript cells and {risk} from the book-check priority queue, each read by Opus a pair
of facing pages at a time (10 pages, 5 page breaks, 5 calls a book). The verdicts are book_checks rows; nothing
touches page text. Do not comment anywhere, open nothing, decide nothing: the lane posts all of this account-week's
rounds as one pooled comment on #6420 after the week resets.

All commands run from the main checkout (read-only use of its scripts; no git commands there).
1. Draw (Mongo reads only, about a minute; a re-run keeps the existing draw):
     cd {sl} && node --env-file=.env.production.local scripts/audit/spare-paired-fifths.mjs draw --run {base}/{name} \\
       --seed {seed} --uniform {uniform} --risk {risk} >> {base}/{name}.log 2>&1
2. Read, detached, and wait for it in the FOREGROUND as the HEADLESS RULES say:
     cd {sl} && nohup node --env-file=.env.production.local scripts/audit/spare-paired-fifths.mjs run --run {base}/{name} \\
       --concurrency 5 >> {base}/{name}.log 2>&1 &
   About an hour. Done when the log has a line starting `== ` that contains `round {name} done`.
3. If it stops early (a crash, a reader error), read the log and re-run step 2, at most twice: it resumes from the
   evidence file and never writes a row twice. A quota or pace stop ("stopped: quota" / "stopped: pace") is the end:
   do not re-run. The pool counts the books that were finished.
4. Do NOT run `pool` and do NOT post. Touch the done file as the HEADLESS RULES say.
"""


REFLECT_BRIEF = """Lands: v2#8632
PR: yes

Spare-lane weekly reflection (v2#8632 decision 4, Derek 2026-11-12). The weekly audit wrote a new loop digest:
  {digest}
Earlier digests sit beside it under {loop}/<date>/digest.md, each with its repair-queue.json and labels.jsonl.
Issue v2#8632 lives on the public mirror: read and comment with `gh ... -R Embassy-of-the-Free-Mind/sourcelibrary-v2`.
PRs and the class issues are on sourcelibrary-v3 (origin).
Read scripts/eval/experiments/2026-11-12-audit-policy-replay-8632.md,
scripts/eval/experiments/2026-11-12-free-ocr-english-checks-8632.md and the v2#8632 thread first.

Your job: turn what REPEATS in the digests into at most ONE tested change, or say why there is none.
1. Compare the newest digest with the up-to-three before it. Look for a pattern seen in two or more weeks: an
   error class or language rising, a router cell whose no-route count grows, the risk stratum failing to beat the
   random stratum, a second-read confirmation rate moving, a detector that keeps missing what the audit finds.
   One week alone is noise: do not act on it.
2. If a pattern holds, pick the smallest change that addresses it and can be tested on the labels already on disk,
   with no new model calls beyond this job's own Claude quota: a classifier or keyword rule, a feature or target
   in scripts/eval/error-zoo/, a draw parameter, a route-test design (design only), a detector threshold.
   Test it by replay against the labels (state the before/after numbers and n), then open ONE PR with the
   change and an experiments file (scripts/eval/experiments/, with its header lint), "Part of v2#8632".
3. If no pattern holds, take the next test instead from the open error-class issues on v3, the ones whose title
   starts "Error class". Pick the one whose last comment is oldest, and run its "Next test" when it is free (a
   detector-suite run with scripts/eval/error-zoo/detector-suite.mjs, a replay, a feature added to the predictor).
   Comment the result on that issue against its definition of done. A next test that needs spend or a prompt change
   is a DECISION line, not an action. If nothing is free to run, open no PR.
4. Either way, post ONE comment on v2#8632: what you compared, the pattern (or none), the test and its result, the
   PR link if any.
LIMITS: no production writes, no withholding, no crontab, no new paid API or GPU spend. Anything like that
(including a route test that needs reads) becomes a line `DECISION: <what> — default: <what happens if nobody
answers>` in that comment, not an action. Keep CPU light: the box runs the paid pipeline.
"""
LOOP_DIR = "/mnt/HC_Volume_105839809/jobs/convergent-audit-6420/loop"  # main's weekly audit writes <date>/digest.md


def pending_digest(state: dict) -> str | None:
    """The newest weekly digest not yet reflected on, on the box that runs the weekly audit (main), else None."""
    if GUEST or GEX45:
        return None
    try:
        ds = [os.path.join(LOOP_DIR, d, "digest.md") for d in os.listdir(LOOP_DIR)]
    except OSError:
        return None
    # By week (the run directory is the audit's date), not mtime: re-finishing an old week rewrites its digest.
    ds = sorted(d for d in ds if os.path.isfile(d) and re.match(r"\d{4}-\d{2}-\d{2}$", os.path.basename(os.path.dirname(d))))
    if not ds:
        return None
    last = state.get("reflect", {}).get("last_digest") or ""
    newest = ds[-1]
    return newest if os.path.basename(os.path.dirname(newest)) > os.path.basename(os.path.dirname(last)) else None


def start_reflection(email: str, why: str, state: dict, digest: str):
    """One reflection job per new digest (#8632), recorded so the next digest is the next job."""
    name = f"spare-reflect-{NOW:%Y%m%d}"
    log(f"start {name} ({email}): {why} — reason: weekly reflection on {digest} (#8632)")
    if DRY:
        return
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(REFLECT_BRIEF.format(digest=digest, loop=LOOP_DIR))
    try:
        out = sh(JOB, "start", name, fh.name, timeout=120).strip()
    except subprocess.TimeoutExpired:
        out = "timed out"
    print(out, flush=True)
    # Recorded only once the job is running, so a refused start is tried again on the next run.
    if out.startswith("started "):
        state.setdefault("reflect", {})["last_digest"] = digest
        save_state(state)
    else:
        log(f"{name} did not start ({out[:160]}); the digest stays pending")


def load_state() -> dict:
    try:
        return json.load(open(STATE))
    except (OSError, ValueError):
        return {"tried": {}}


def save_state(state: dict):
    tmp = STATE + ".tmp"
    json.dump(state, open(tmp, "w"), indent=1)
    os.replace(tmp, STATE)


def box_name() -> str:
    return sh("/root/bin/box.sh", "self", timeout=10).strip() or os.uname().nodename


def start_fallback_audit(email: str, limits: dict, why: str, state: dict):
    """One paired-fifths round, recorded under this account's week for the pooled comment."""
    reset = parse_iso(limits["weekly_all"]["resets_at"])
    # The reset jitters by a second between polls (21:59:59, 22:00:00): key it by the nearest hour.
    week = f"{email}|{reset + dt.timedelta(minutes=30):%Y-%m-%dT%H}"
    rounds = state.setdefault("audit", {})
    key, base = "pf_runs", PF_BASE
    day = f"spare-pf-{NOW:%Y%m%d}-"
    n = 1 + sum(1 for w in rounds.values() for r in w.get(key, []) if os.path.basename(r).startswith(day))
    name = f"{day}{n}"
    seed = random.SystemRandom().randrange(10**8, 10**9)  # the draw's default seed is the date: same day, same pages
    what = f"paired-fifths round, {PF_UNIFORM} uniform + {PF_RISK} risk books (v3#197)"
    log(f"start {name} ({email}): {why} — reason: fallback audit (no eligible issue; {what}, seed {seed})")
    if DRY:
        return
    os.makedirs(base, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(PF_BRIEF.format(sl=SL, seed=seed, base=base, name=name, uniform=PF_UNIFORM, risk=PF_RISK))
    rec = rounds.setdefault(week, {"runs": [], "posted": False})
    rec.setdefault(key, []).append(os.path.join(base, name))
    save_state(state)
    print(sh(JOB, "start", name, fh.name, timeout=120).strip(), flush=True)


def pool_commands(rec: dict, label: str) -> list[tuple[str, list[str]]]:
    """The pooled-comment commands for one account-week: one per kind of round it ran."""
    out = []
    if rec.get("runs"):
        out.append(("convergent", ["node", "scripts/audit/convergent-audit-pool.mjs", "--label", label, "--post", *rec["runs"]]))
    if rec.get("pf_runs"):
        out.append(("paired-fifths", ["node", "--env-file=.env.production.local", "scripts/audit/spare-paired-fifths.mjs", "pool",
                                      "--label", label, "--post", *rec["pf_runs"]]))
    return out


def post_pooled_audits(state: dict, running: list[str]):
    """One #6420 comment per account-week and kind of round, once the week has reset and none of its rounds is running."""
    changed = False
    for week, rec in (state.get("audit") or {}).items():
        reset = parse_iso(week.split("|", 1)[1] + ":00:00+00:00")
        if rec.get("posted") or not reset or NOW < reset:
            continue
        if any(os.path.basename(r) in running for r in rec.get("runs", []) + rec.get("pf_runs", [])):
            continue
        label = f"{box_name()}, account week to {reset:%Y-%m-%d %H}:00Z"
        done = rec.setdefault("posted_kinds", [])
        for kind, cmd in pool_commands(rec, label):
            if kind in done:
                continue  # a week with both kinds whose second post failed: never post the first twice
            log(f"post pooled {kind} rounds of {week} on #6420")
            if DRY:
                continue
            try:
                r = subprocess.run(cmd, cwd=SL, capture_output=True, text=True, timeout=600)
            except subprocess.TimeoutExpired:
                log(f"warn: pooled {kind} post timed out, retrying next run")  # never let a post stop the lane's start
                continue
            if r.returncode == 0 or "no round has a draw" in r.stderr:
                done.append(kind)
                changed = True
            else:
                log(f"warn: pooled {kind} post failed, retrying next run: {r.stderr.strip()[-200:]}")
        if not DRY and all(k in done for k, _ in pool_commands(rec, label)):
            rec["posted"] = NOW.isoformat()
            changed = True
    if changed:
        save_state(state)


def main():
    if os.path.exists(STATE):
        post_pooled_audits(load_state(), lane_jobs())
    if not AS and not this_box_account():
        # Without this, the fallback below would take main's account from the shared poll, start a job,
        # and the wrapper's login preflight would refuse it and page high every 30 min (gex45, #5660).
        log("idle: Claude is not logged in on this box")
        return
    got = account_limits()
    if not got:
        log(f"idle: no fresh limits for this box's account ({this_box_account()})")
        return
    email, limits = got
    action, why = decide(limits)
    running = lane_jobs()
    if draining(limits):
        os.environ["JOB_IGNORE_LIMIT"] = "1"  # the wrapper refuses a start at 90%, which is where a drain begins

    if action == "stop":
        for name in running:
            log(f"stop {name}: {why}")
            if not DRY:
                sh(JOB, "stop", name)
        if not running:
            log(f"idle: {why}")
        return
    if action == "idle":
        log(f"idle ({email}): {why}; {len(running)} lane job(s) running")
        return

    if len(running) >= MAX_JOBS:
        log(f"full: {why}; running {', '.join(running)}")
        return
    # Ask before starting (#70). The drain's JOB_IGNORE_LIMIT, set above, reaches `where` through the environment,
    # so a drain is not held back by the weekly-limit reason it exists to pass.
    ready = box_ready()
    if ready != "yes":
        log(f"wait: {why}, but this box is not ready for a job ({ready})")
        return

    state = load_state()
    if draining(limits):
        # Derek, 2026-11-05: an Opus QA check is always good. A round also fits the time left, where an issue
        # job has a two-hour budget and may be stopped at 99% half done. Claude reviews here and writes no page
        # text; translation stays on agy.
        start_fallback_audit(email, limits, why, state)
        return
    # The weekly reflection (#8632): once per new digest, in the last 48 h, before issue work. Not in the drain:
    # a reflection may open a PR, which does not fit the last hours (the drain runs an audit round instead).
    # Not in the final 12 h either: the stop at 99% ends every lane job, and a reflection cut off mid-PR leaves a mess.
    hours_left = (parse_iso(limits["weekly_all"]["resets_at"]) - NOW).total_seconds() / 3600
    digest = pending_digest(state) if in_last_stretch(limits) and hours_left >= 12 else None
    if digest:
        start_reflection(email, why, state, digest)
        return
    tried = {int(k) for k in state["tried"]}
    starts = state.get("starts", 0)
    picked = None if starts % OPPORTUNITY_EVERY == OPPORTUNITY_EVERY - 1 else pick_from_needs(tried, state.get("area", 0))
    if picked:
        issue, reason = picked
        state["area"] = state.get("area", 0) + 1
    else:
        issue, reason = pick_issue(tried), "opportunity: next small open issue by label (bug, user-feedback, data-quality)"
    if not issue:
        if in_last_stretch(limits):
            start_fallback_audit(email, limits, why, state)
        else:
            log(f"idle: {why}, but no eligible issue")
        return
    n = issue["number"]
    name = f"spare-{n}"
    log(f"start {name} ({email}): {why} — #{n} {issue['title'][:80]} — {reason}")
    if DRY:
        return
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(BRIEF.format(n=n, title=issue["title"], repo=REPO, why=reason))
    # The label is the cross-box claim: three boxes run this lane, each with its own state file.
    sh("gh", "issue", "edit", str(n), "-R", REPO, "--add-label", "spare-lane")
    state["tried"][str(n)] = NOW.isoformat()
    state["starts"] = starts + 1
    save_state(state)
    print(sh(JOB, "start", name, fh.name, timeout=120).strip(), flush=True)


if __name__ == "__main__":
    main()
