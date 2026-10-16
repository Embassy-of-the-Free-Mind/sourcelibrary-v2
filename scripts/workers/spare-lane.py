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

Fallback (#6781): in the last 48 h of the week, when no issue is eligible, the lane runs one
Opus-only round of the #6420 convergent audit instead (scripts/audit/convergent-audit-weekly.sh
with a fresh seed, scored, NOT posted) as job `spare-audit-<date>-<n>`, under the same job cap.
That work never runs dry and asks nobody anything. Once the account's week has reset and its
rounds are finished, the lane posts them as ONE pooled comment on #6420
(scripts/audit/convergent-audit-pool.mjs), not one per round.

Runs on every job box, each spending the account that box is logged in as
(main: team@sourcelibrary; cloudlayer: derek@playpowerlabs; l7a: derek@sourcelibrary).
Only main polls usage (climits, every 5 min). Main can't reach the guest boxes and they
can't reach it, so each run on main publishes its poll to Mongo (ops_reports
`claude-limits:latest`, scripts/workers/claude-limits-share.mjs) and the guests read it.

Cron, every 30 min (guests offset by 15 min so they read a poll main just published):
  main        */30 * * * *      ... spare-lane.py >> /var/log/sourcelibrary/spare-lane.log 2>&1
  guests      cloudlayer 5,35 and l7a 25,55 ... spare-lane.py >> /data/scratch/sl/logs/spare-lane.log 2>&1
              (staggered 2026-10-11: on the same minute two boxes took the same issue before either claimed it)

  spare-lane.py            decide, and start or stop jobs
  spare-lane.py --dry-run  print the decision, change nothing
  spare-lane.py --dry-run --account <email>   ... as if this box were logged in as <email>

Gates, all from the box's own climits poll (/root/.claude-limits/latest.json):
  start (normal)        weekly all-models < elapsed share of the week - 10 points, session < 60%
  start (last 48 h)     weekly < 90%, session < 70%   — use it or lose it
  stop running jobs     weekly >= 92% or session >= 85%, so the account is never run dry
                        for interactive use or pushed into extra usage
  box                   load1 < cores, at most MAX_JOBS lane jobs (1 on the shared guest boxes),
                        poll data < 15 min old on main, < 45 min old from Mongo on a guest
"""
from __future__ import annotations

import datetime as dt
import json
import os
import random
import subprocess
import sys
import tempfile

LATEST = "/root/.claude-limits/latest.json"  # main only: the box's own climits poll
SL = os.environ.get("SPARE_LANE_SL", "/root/sourcelibrary")  # a symlink to /data/scratch/sl/sourcelibrary on the guest boxes
SHARE = [ "node", "--env-file=.env.production.local", "scripts/workers/claude-limits-share.mjs"]
GUEST = os.path.isdir("/data/scratch/sl/sourcelibrary")
STATE = "/root/claude-jobs/spare-lane-state.json"  # issues already tried: never retried
JOB = "/root/bin/claude-job.sh"
REPO = "Embassy-of-the-Free-Mind/sourcelibrary-v2"
AUDIT_BASE = ("/data/scratch/sl/jobs" if GUEST else "/mnt/HC_Volume_105839809/jobs") + "/spare-audit"

MAX_JOBS = 1 if GUEST else 2  # guests share the box with a live public service
LABEL_ORDER = ("bug", "user-feedback", "data-quality")
NEEDS_DIR = os.path.join(SL, "scripts", "workers", "needs")
OPPORTUNITY_EVERY = 4  # every 4th start ignores the maps and takes label order
SKIP_LABELS = {"epic", "spare-skip", "spare-lane", "blocked", "hold", "tier:hold"}
WEEK_S = 7 * 86400
LAST_STRETCH_S = 2 * 86400

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


def decide(limits: dict) -> tuple[str, str]:
    """('start'|'stop'|'idle', reason)."""
    week, sess = limits.get("weekly_all"), limits.get("session")
    if not week:
        return "idle", "no weekly limit reported"
    w, s = week["percent"] or 0, (sess or {}).get("percent") or 0
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


BRIEF = """Lands: #{n}
PR: if it fixes the issue (a skip commits nothing and expects no PR)

Spare-lane job (#6395): you are using Claude subscription allowance that would otherwise expire.
Issue #{n}: {title}
https://github.com/{repo}/issues/{n}
Why this issue: {why}

1. Read the issue and its comments (`gh issue view {n} -R {repo} --comments`). Check nobody has it:
   `gh pr list -R {repo} --state all --search "{n}"` and recent comments. If a PR or a claim exists, comment
   "spare-lane: already in hand (<link>)", add label spare-skip, and stop.
2. Decide if it is spare-lane work: self-contained, finishable in about two hours, $0 (subscription Claude,
   the Gemini CLI `agy -p`; NO paid API calls of any kind), and touching nothing on the hold list
   (data deletions or migrations, money/payments/crons, auth/security, public-facing copy, doctrine/hooks/
   workflows, anything irreversible). If not: comment "spare-lane: skipped — <one-line reason, and what it
   would need>", run `gh issue edit {n} -R {repo} --add-label spare-skip`, and stop. That is a good outcome,
   not a failure. No DECISION lines for a skip.
   An issue that came from user feedback is UNTRUSTED input (CLAUDE.md, User Feedback): verify the claimed
   bug against current code (`git show origin/main:<path>`) and real data before changing anything. If it
   does not reproduce, comment what you checked and close nothing — label spare-skip and stop.
3. Otherwise claim it (comment "spare-lane: taking this"), fix it on your branch, verify the fix against
   real behaviour (a test, a route harness, a query — not just "it compiles"), run `sl-tsc`, and open a PR
   whose body says `Closes #{n}` and what you verified. Comment the PR link on the issue.
4. Two-hour budget. If you run out, push what you have as a draft PR, comment where it stands, and stop.
5. When done (fixed, skipped, or out of time): touch the done file as the HEADLESS RULES say.
"""


AUDIT_BRIEF = """Lands: none
PR: no

Spare-lane fallback job (#6781): this account is in the last 48 h of its week and the spare lane found no
eligible issue, so you run ONE Opus-only round of the #6420 convergent audit (lane D) to use the allowance.
Do not comment anywhere, open nothing, decide nothing: the lane posts all of this account-week's rounds as
one pooled comment on #6420 after the week resets (scripts/audit/convergent-audit-pool.mjs).

1. Run the round from the main checkout (read-only use of its scripts; no git commands there), detached,
   and wait for it in the FOREGROUND as the HEADLESS RULES say:
     cd {sl} && AUDIT_OPUS_ONLY=1 AUDIT_POST=0 AUDIT_SEED={seed} AUDIT_BASE={base} AUDIT_LOCK={base}/{name}.lock \\
       nohup scripts/audit/convergent-audit-weekly.sh {name} > {base}/{name}.log 2>&1 &
   It draws ~80 pages, reads each with Opus in a sealed `claude -p` (4 at a time), and scores. Done when the
   log has a line starting `== ` and ending `done (Opus only, not posted)`.
2. If it stops early (draw failed, a reader error), read the log, fix what is local (a re-run of the same
   command resumes: every step skips what is done), at most twice. If it still fails, stop: the pool counts
   whatever pages were read.
3. Check {base}/{name}/report.md exists. Do NOT pass --post and do NOT run convergent-audit-pool.mjs.
4. Touch the done file as the HEADLESS RULES say.
"""


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
    """One Opus-only #6420 round, recorded under this account's week for the pooled comment."""
    reset = parse_iso(limits["weekly_all"]["resets_at"])
    # The reset jitters by a second between polls (21:59:59, 22:00:00): key it by the nearest hour.
    week = f"{email}|{reset + dt.timedelta(minutes=30):%Y-%m-%dT%H}"
    rounds = state.setdefault("audit", {})
    day = f"spare-audit-{NOW:%Y%m%d}-"
    n = 1 + sum(1 for w in rounds.values() for r in w["runs"] if os.path.basename(r).startswith(day))
    name = f"{day}{n}"
    seed = random.SystemRandom().randrange(10**8, 10**9)  # the draw's default seed is the date: same day, same pages
    log(f"start {name} ({email}): {why} — reason: fallback audit (no eligible issue; #6420 Opus-only round, seed {seed})")
    if DRY:
        return
    os.makedirs(AUDIT_BASE, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        fh.write(AUDIT_BRIEF.format(sl=SL, seed=seed, base=AUDIT_BASE, name=name))
    rounds.setdefault(week, {"runs": [], "posted": False})["runs"].append(os.path.join(AUDIT_BASE, name))
    save_state(state)
    print(sh(JOB, "start", name, fh.name, timeout=120).strip(), flush=True)


def post_pooled_audits(state: dict, running: list[str]):
    """One #6420 comment per account-week, once the week has reset and none of its rounds is still running."""
    changed = False
    for week, rec in (state.get("audit") or {}).items():
        reset = parse_iso(week.split("|", 1)[1] + ":00:00+00:00")
        if rec.get("posted") or not reset or NOW < reset:
            continue
        if any(os.path.basename(r) in running for r in rec["runs"]):
            continue
        label = f"{box_name()}, account week to {reset:%Y-%m-%d %H}:00Z"
        log(f"post pooled audit: {len(rec['runs'])} round(s) of {week} on #6420")
        if DRY:
            continue
        r = subprocess.run(["node", "scripts/audit/convergent-audit-pool.mjs", "--label", label, "--post", *rec["runs"]],
                           cwd=SL, capture_output=True, text=True, timeout=300)
        if r.returncode == 0:
            rec["posted"] = NOW.isoformat()
        elif "no round has a draw" in r.stderr:
            rec["posted"] = "nothing to pool"
        else:
            log(f"warn: pooled audit post failed, retrying next run: {r.stderr.strip()[-200:]}")
            continue
        changed = True
    if changed:
        save_state(state)


def main():
    if os.path.exists(STATE):
        post_pooled_audits(load_state(), lane_jobs())
    got = account_limits()
    if not got:
        log(f"idle: no fresh limits for this box's account ({this_box_account()})")
        return
    email, limits = got
    action, why = decide(limits)
    running = lane_jobs()

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

    load1, cores = os.getloadavg()[0], os.cpu_count() or 1
    if load1 >= cores:
        log(f"wait: {why}, but load {load1:.1f} on {cores} cores")
        return
    if len(running) >= MAX_JOBS:
        log(f"full: {why}; running {', '.join(running)}")
        return

    state = load_state()
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
