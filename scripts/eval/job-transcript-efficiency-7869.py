#!/usr/bin/env python3
# Job transcript efficiency (#7869): did the fresh-session (#7872) and auto-compact (#8018) settings shrink the
# context a job's turns carry, and how much of a box's Opus goes to main-session turns that only wait or merge.
# PRIOR ART: ~/sourcelibrary-ops/bin/opus-usage-by-job.py — same dedup (message id + request id), same weighting
# (out*5 + in + cache_write*1.25 + cache_read*0.1), but per job only; it has no per-turn context, no before/after
# split, no compaction count and no turn classes, which are what this question needs. Its weighting is kept so the
# two scripts' totals agree.
#
#   ssh root@<box> python3 - [since] [cut] < scripts/eval/job-transcript-efficiency-7869.py > box.json
# since: ISO start (default 7 days ago); cut: the before/after line (default 2026-11-03T20:10, #8018 merged).
# Reads only /root/.claude*/projects/*worktrees*job-* transcripts (jobs, not interactive or lane sessions).
import json, os, glob, re, sys, collections, datetime as dt

now = dt.datetime.now(dt.timezone.utc)
since = sys.argv[1] if len(sys.argv) > 1 else (now - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M")
cut = sys.argv[2] if len(sys.argv) > 2 else "2026-11-03T20:10"
W = lambda u: u["out"] * 5 + u["in"] + u["cw"] * 1.25 + u["cr"] * 0.1
# A main-session turn is WAIT when every tool call in it is one of these: polling CI or a runner, sleeping, merging,
# reading a log tail, listing processes. Judgement turns (reading, writing, editing, deciding) are everything else.
WAIT_RE = re.compile(r"gh (pr|run) (checks|watch|view|merge)|safe-merge|\bsleep\b|until |tail -[fn]|\bps |pgrep|"
                     r"claude-job\.sh (ctx|note)|cat /root/claude-jobs/.*inbox|gh issue comment|git push|gh pr create|"
                     r"vercel ls|touch /root/claude-jobs/")

def blank():
    return dict(w_main=0.0, w_sub=0.0, w_sub_sonnet=0.0, w_wait=0.0, turns=0, wait_turns=0, sessions=set(),
                ctx_before=[], ctx_after=[], compactions=0, first="z", last="", w_before=0.0, w_after=0.0)

jobs = collections.defaultdict(blank)
seen = set()
for h in [os.path.expanduser("~/.claude")] + glob.glob("/root/.claude-*"):
    for f in glob.glob(h + "/projects/*/*.jsonl") + glob.glob(h + "/projects/*/*/subagents/*.jsonl"):
        proj = f.split("/projects/")[1].split("/")[0]
        m = re.search(r"worktrees-job-(.+)$", proj) or re.search(r"worktrees-(.+)$", proj)
        if not m or "job" not in proj: continue
        key, issub = m.group(1), "/subagents/" in f
        try: lines = open(f, errors="ignore").readlines()
        except OSError: continue
        for line in lines:
            try: d = json.loads(line)
            except ValueError: continue
            ts = d.get("timestamp", "")
            if ts < since: continue
            j = jobs[key]
            if d.get("isCompactSummary") or (d.get("type") == "system" and d.get("subtype") == "compact_boundary"):
                j["compactions"] += 1; continue
            msg = d.get("message") or {}
            u, mdl = msg.get("usage"), msg.get("model", "")
            if not u: continue
            k = (msg.get("id"), d.get("requestId"))
            if k[0] and k in seen: continue
            seen.add(k)
            uu = dict(**{"in": u.get("input_tokens", 0)}, cr=u.get("cache_read_input_tokens", 0),
                      cw=u.get("cache_creation_input_tokens", 0), out=u.get("output_tokens", 0))
            w = W(uu)
            if issub or d.get("isSidechain"):
                if "sonnet" in mdl: j["w_sub_sonnet"] += w
                elif "opus" in mdl or "fable" in mdl: j["w_sub"] += w
                continue
            if "opus" not in mdl and "fable" not in mdl and "sonnet" not in mdl: continue
            j["w_main"] += w; j["turns"] += 1; j["sessions"].add(d.get("sessionId"))
            ctx = uu["in"] + uu["cr"] + uu["cw"]
            (j["ctx_after"] if ts >= cut else j["ctx_before"]).append(ctx)
            j["w_after" if ts >= cut else "w_before"] += w
            j["first"], j["last"] = min(j["first"], ts), max(j["last"], ts)
            tools = [c for c in msg.get("content") or [] if isinstance(c, dict) and c.get("type") == "tool_use"]
            cmds = [str((c.get("input") or {}).get("command", "")) for c in tools]
            if tools and all(c.get("name") == "Bash" for c in tools) and all(WAIT_RE.search(c) for c in cmds):
                j["w_wait"] += w; j["wait_turns"] += 1

# A job's wrapper log says which settings it ran with (#7872/#8018 add "fresh session at" and "auto-compact").
logd = next((p for p in ["/var/log/sourcelibrary/claude-jobs", "/data/scratch/sl/logs/claude-jobs"] if os.path.isdir(p)), None)
out = []
for k, j in jobs.items():
    log = open(os.path.join(logd, k + ".log"), errors="ignore").read() if logd and os.path.exists(os.path.join(logd, k + ".log")) else ""
    out.append(dict(job=k, w_main=j["w_main"], w_sub_opus=j["w_sub"], w_sub_sonnet=j["w_sub_sonnet"], w_wait=j["w_wait"],
                    turns=j["turns"], wait_turns=j["wait_turns"], sessions=len(j["sessions"]), compactions=j["compactions"],
                    ctx_before=j["ctx_before"], ctx_after=j["ctx_after"], w_before=j["w_before"], w_after=j["w_after"],
                    first=j["first"][:16], last=j["last"][:16], new_settings="fresh session at" in log,
                    compact_setting="auto-compact at" in log, fresh_restarts=log.count("] fresh session "),
                    main_model=("sonnet" if "main: sonnet" in log else "opus")))
json.dump(dict(host=os.uname().nodename, since=since, cut=cut, now=now.isoformat(), jobs=out), sys.stdout)
