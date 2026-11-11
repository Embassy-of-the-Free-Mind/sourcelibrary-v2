#!/usr/bin/env python3
# PRIOR ART: .claude/hooks/branch-guard.sh (one rule, enforced, laptop paths) and Claude Code's auto mode (a general
# classifier that does not know this project's risks). This is the project's own rule layer, for every session on a box.
#
# agent-guard.py — Source Library's own guard on every Claude tool call on a job box (#8614).
#   agent-guard.py pre            PreToolUse hook: reads the call as JSON on stdin, logs it, applies the rules
#   agent-guard.py report [days]  what the rules would have blocked, by rule, with examples (default 7 days)
#   agent-guard.py check '<cmd>'  the rules' verdict on one shell command (testing a rule)
#   agent-guard.py install        add the hook to every Claude config dir's settings.json on this box (idempotent)
#
# Why: agents on these boxes run as root with every shell command allowed, and they read untrusted text (OCR, web
# pages, reader feedback, outside issues). Derek 2026-11-11: secure, and easy for him and for Claude. The plan is in
# the ops repo (security/agent-fleet-security-plan.md): our own rules for what is dangerous HERE, auto mode as the
# general layer, scoped credentials underneath. One week of logs is replayed against each layer before any blocks.
#
# Mode: SHADOW by default. A rule match is logged as "would_block" and the call goes ahead exactly as before. A file
# holding "enforce" at $AGENT_GUARD_MODE_FILE (default /etc/agent-guard.mode) turns matches into denials with the rule
# named. The hook never fails a call: any error in here exits 0 with nothing printed.
#
# The log holds every tool call, one JSON line, with secrets redacted BEFORE writing (URIs with passwords, long
# tokens, KEY=value pairs). Location: /var/log/sourcelibrary/agent-tools/YYYY-MM-DD.jsonl, or $AGENT_GUARD_LOG_DIR.
import json, os, re, socket, sys, time, glob

LOG_DIR = os.environ.get("AGENT_GUARD_LOG_DIR") or next(
    (d for d in ("/var/log/sourcelibrary/agent-tools", "/data/scratch/sl/logs/agent-tools")
     if os.path.isdir(os.path.dirname(d))), "/var/tmp/agent-tools")
MODE_FILE = os.environ.get("AGENT_GUARD_MODE_FILE", "/etc/agent-guard.mode")
PUBLIC_REPOS = ("Embassy-of-the-Free-Mind/sourcelibrary-v2",)
EGRESS_OK = re.compile(r"(^|\.)(github\.com|githubusercontent\.com|sourcelibrary\.org|ntfy\.sh|anthropic\.com|"
                       r"claude\.ai|googleapis\.com|r2\.cloudflarestorage\.com|vercel\.com|openrouter\.ai|localhost|127\.0\.0\.1)$")

# ---- redaction: applied to everything that is logged or shown ----
REDACT = [
    (re.compile(r"(mongodb(?:\+srv)?://)[^@\s/]+@"), r"\1***@"),
    (re.compile(r"(https?://)[^/\s:@]+:[^@\s/]+@"), r"\1***@"),
    (re.compile(r"\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z0-9_]*)=(\S+)"), r"\1=***"),
    (re.compile(r"(Bearer\s+)\S+", re.I), r"\1***"),
    (re.compile(r"\b(?:sk-|ghp_|gho_|github_pat_|xox[bp]-|AKIA)[A-Za-z0-9_\-]{8,}"), "<token>"),
    (re.compile(r"\b[A-Za-z0-9_\-]{40,}\b"), "<long>"),
]
def redact(s):
    for rx, rep in REDACT:
        s = rx.sub(rep, s)
    return s

# ---- the rules: what is dangerous on THESE boxes ----
DB_DESTRUCTIVE = re.compile(r"\.(deleteMany|drop|dropDatabase|dropCollection|renameCollection|dropIndexes)\s*\(|"
                            r"\bdb\.dropDatabase\b|\bmongosh\b.*--eval.*\b(remove|deleteMany|drop)\b")
RM_RF = re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force)\b[^;&|]*?"
                   r"(\s/(\s|$|\*)|\s~/?(\s|$)|/root/?(\s|$)|/root/sourcelibrary/?(\s|$)|/mnt/HC_Volume_\d+/?(jobs|worktrees)?/?(\s|$)|"
                   r"/data/?(\s|$)|/data/scratch/?(sl/?)?(\s|$)|/root/\.claude[^/\s]*/?(\s|$))")
SSH_AUTH = re.compile(r"authorized_keys|sshd_config|/etc/ssh/|(^|[;&|(]\s*|\s)crontab\s+(?!-l\b)[-/\w$]|/etc/cron|"
                      r"/var/spool/cron|/etc/sudoers|(^|[;&|]\s*)(usermod|passwd)\b")
SECRET_READ = re.compile(r"(\b(cat|head|tail|less|more|grep|sed|awk|strings|xxd|base64|cp|scp|rsync|curl|\.|source)\s[^|;&\n]*"
                         r"((?<![\w.])\.env(?!\.(example|sample|template))(\.[a-z.]+)?\b|\.sl-internal-key\b|\.credentials\.json|/proc/[^/\s]+/environ|id_(ed25519|rsa|mesh|xfer)\b(?!\.pub)|"
                         r"storagebox_ed25519\b(?!\.pub)))|(^|[;&|]\s*)(env|printenv|set)\s*($|[;&|>])")
FORCE_PUSH = re.compile(r"\bgit\s+push\b[^;&|]*\s(--force(?!-with-lease)\b|-f\b)")
PUBLIC_POST = re.compile(r"\bgh\s+(issue|pr|api)\b[^;&|]*\b(create|comment|edit|review|-X\s*(POST|PATCH))\b")
INFRA = re.compile(r"\b(?!(127|10|0)\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|"
                   r"SHA256:[A-Za-z0-9+/]{20,}|authorized_keys|ssh-(ed25519|rsa) AAAA|\broot key\b|unrestricted (root )?key|private key", re.I)
EGRESS = re.compile(r"\b(curl|wget)\s(?:[^;&|\n$(]*\s)?(-d|--data[a-z-]*|-F|--form|-T|--upload-file|-X\s*(POST|PUT))\b")
URL_HOST = re.compile(r"https?://([^/\s:'\"]+)")
APPLY = re.compile(r"\s--apply\b")

def file_text(cmd):
    """Text of any --body-file / -F file / --input file the command names (to check a public post's body)."""
    out = []
    for m in re.finditer(r"(?:--body-file|--input|-F\s+body=@|--field\s+body=@)[=\s]+([^\s;&|]+)", cmd):
        p = os.path.expanduser(m.group(1).strip("'\""))
        try:
            with open(p, errors="replace") as f:
                out.append(f.read(200_000))
        except Exception:
            pass
    return "\n".join(out)

HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
def strip_heredocs(cmd):
    """The command without heredoc bodies: text being WRITTEN to a file is not a command (replay 2026-11-11: most
    false matches were state files and PR bodies that quoted commands)."""
    return HEREDOC.sub("<<HEREDOC", cmd)

def rules_bash(full, env=os.environ):
    hits = []
    cmd = strip_heredocs(full)
    if DB_DESTRUCTIVE.search(cmd): hits.append("db-destructive")
    if RM_RF.search(cmd + " "): hits.append("rm-rf-shared")
    if SSH_AUTH.search(cmd) and not re.match(r"^\s*(crontab\s+-l|cat\s+/etc/crontab|ls\b|grep\b[^|]*-c\b)", cmd):
        hits.append("auth-or-cron")
    # Reading key NAMES (grep -c, grep -o '^NAME') is not reading secrets; --env-file= passes them without showing them.
    sr = re.sub(r"--env-file=\S+", "", cmd)
    sr = re.sub(r"\bgrep\s+(-[a-zA-Z]*c[a-zA-Z]*\s|-[a-zA-Z]*o[a-zA-Z]*\s+['\"]\^\[?[A-Z_])[^|;&\n]*", "", sr)
    if SECRET_READ.search(sr): hits.append("secret-read")
    if FORCE_PUSH.search(cmd): hits.append("force-push")
    if PUBLIC_POST.search(cmd):
        target_public = (not re.search(r"(-R|--repo)[=\s]+\S+", cmd)) or any(r in cmd for r in PUBLIC_REPOS)
        if re.search(r"repos/(?!Embassy-of-the-Free-Mind/sourcelibrary-v2)", cmd) and "gh api" in cmd:
            target_public = False
        body = full + "\n" + file_text(cmd)
        if target_public and INFRA.search(body): hits.append("public-infra-leak")
    if EGRESS.search(cmd):
        hosts = URL_HOST.findall(cmd)
        if hosts and any(not EGRESS_OK.search(h.lower()) for h in hosts): hits.append("egress-upload")
    if APPLY.search(cmd) and not (env.get("JOB_NAME") or re.search(r"--(job|reason)[=\s]", cmd)):
        hits.append("apply-without-run-name")
    return hits

def rules_write(path):
    if re.search(r"authorized_keys|sshd_config|/etc/ssh/|/etc/cron|/var/spool/cron|/etc/sudoers", path): return ["auth-or-cron"]
    if re.search(r"/\.claude[^/]*/settings(\.local)?\.json$|/agent-guard\.(py|mode)$|/etc/agent-guard", path): return ["guard-tamper"]
    if re.search(r"\.env(\.[a-z.]+)?$|\.credentials\.json$", path): return ["secret-write"]
    return []

def judge(tool, tin, env=os.environ):
    if tool == "Bash":
        return rules_bash(tin.get("command", ""), env)
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        return rules_write(tin.get("file_path", "") or tin.get("notebook_path", ""))
    if tool == "Read" and re.search(r"\.env(\.[a-z.]+)?$|\.credentials\.json$|/proc/[^/]+/environ$|/id_(ed25519|rsa|mesh|xfer)$",
                                    tin.get("file_path", "")):
        return ["secret-read"]
    return []

def summary(tool, tin):
    if tool == "Bash": s = tin.get("command", "")
    elif "file_path" in tin: s = tin["file_path"]
    elif "url" in tin: s = tin["url"]
    elif "pattern" in tin: s = tin["pattern"]
    else: s = json.dumps(tin)[:300]
    return redact(s)[:600]

def mode():
    try:
        return "enforce" if open(MODE_FILE).read().strip() == "enforce" else "shadow"
    except Exception:
        return "shadow"

def pre():
    try:
        ev = json.load(sys.stdin)
        tool, tin = ev.get("tool_name", ""), ev.get("tool_input") or {}
        hits = judge(tool, tin)
        m = mode()
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "box": socket.gethostname(),
               "job": os.environ.get("JOB_NAME", ""), "session": ev.get("session_id", ""),
               "config": os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude"), "cwd": ev.get("cwd", ""),
               "tool": tool, "call": summary(tool, tin), "rules": hits, "mode": m,
               "action": ("deny" if m == "enforce" else "would_block") if hits else "allow"}
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(os.path.join(LOG_DIR, time.strftime("%Y-%m-%d", time.gmtime()) + ".jsonl"), "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if hits and m == "enforce":
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                  "permissionDecisionReason": "agent-guard: " + ", ".join(hits) + ". See ops security/agent-fleet-"
                  "security-plan.md. If this is intended, ask Derek; do not work around it."}}))
    except Exception:
        pass
    return 0

def report(days):
    since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days * 86400))
    by_rule, n, sessions = {}, 0, set()
    for p in sorted(glob.glob(os.path.join(LOG_DIR, "*.jsonl"))):
        if os.path.basename(p)[:10] < since: continue
        for line in open(p, errors="replace"):
            try: r = json.loads(line)
            except Exception: continue
            n += 1; sessions.add(r.get("session"))
            for rule in r.get("rules", []):
                by_rule.setdefault(rule, []).append(r)
    print(f"{n} tool calls in {len(sessions)} sessions since {since} ({LOG_DIR}); mode now: {mode()}")
    for rule, rs in sorted(by_rule.items(), key=lambda kv: -len(kv[1])):
        print(f"\n{rule}: {len(rs)}")
        seen = set()
        for r in rs[-40:][::-1]:
            k = r["call"][:120]
            if k in seen: continue
            seen.add(k)
            print(f"  {r['ts']} {r.get('job') or r['session'][:8]}  {r['call'][:160]}")
            if len(seen) >= 5: break
    if not by_rule: print("no rule matched")

def install():
    hook = {"type": "command", "command": f"python3 {os.path.abspath(__file__)} pre", "timeout": 5}
    home = os.environ.get("AGENT_GUARD_HOME", "/root")
    dirs = sorted({os.path.dirname(p) for p in glob.glob(f"{home}/.claude*/.credentials.json")} |
                  {d for d in glob.glob(f"{home}/.claude*") if os.path.isfile(os.path.join(d, "settings.json"))})
    if os.path.isdir(f"{home}/.claude"): dirs = sorted(set(dirs) | {f"{home}/.claude"})
    for d in dirs:
        p = os.path.join(d, "settings.json")
        try: s = json.load(open(p)) if os.path.exists(p) else {}
        except Exception:
            print(f"skip {p}: does not parse"); continue
        pre_hooks = s.setdefault("hooks", {}).setdefault("PreToolUse", [])
        if any("agent-guard.py" in h.get("command", "") for e in pre_hooks for h in e.get("hooks", [])):
            continue
        pre_hooks.append({"matcher": "*", "hooks": [hook]})
        tmp = p + ".agent-guard.tmp"
        json.dump(s, open(tmp, "w"), indent=2); os.replace(tmp, p)
        print(f"installed in {p}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "pre": sys.exit(pre())
    if cmd == "report": report(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
    elif cmd == "check": print(rules_bash(sys.argv[2]) or "allow")
    elif cmd == "install": install()
    else: print(__doc__ or open(__file__).read().split("\nimport")[0]); sys.exit(2)
