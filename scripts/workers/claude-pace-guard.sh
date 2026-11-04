#!/bin/bash
# claude-pace-guard: the `claude` a job box finds first on PATH. It paces print-mode calls (`claude -p`) to the
# box account's weekly budget, so a fan-out cannot drain a week in a day; everything else passes straight through.
#
# PRIOR ART: scripts/workers/agy-guard.sh — the same shape for Gemini (a PATH shim that sees every caller). And
# job-where.sh / claude-job.sh `start`, which refuse a NEW job on an account at >= 90% weekly but cannot slow the
# jobs already running. On 2026-10-27 the five accounts together spent ~8.6%/h against a summed budget of ~1.9%/h:
# milolomas (main) went 66% -> 76% of its week in two hours with 2d20h to its reset, from two Opus fan-outs.
#
# Rule, print mode only (an interactive `claude` is a person and passes; so does a job's own agent loop, which runs
# with --continue/--resume, because an agent holding a slot while its children wait for one would deadlock):
#   budget = (100 - week%) / hours to the week's reset          (what is left, spread evenly)
#   burn   = week% gained over the last 3 hours, per hour         (from this box's meter, sampled here)
#   slots  = PACE_MAX_SLOTS (12) when burn <= budget or unknown, else max(PACE_MIN_SLOTS (2), MAX * budget / burn)
# A call takes one of `slots` flock slots per account and holds it while it runs; when all are taken it waits.
# A job's main session (claude-job.sh sets CLAUDE_PACE_AGENT=1 on it) takes a slot from a SEPARATE pool of the same
# size, so an over-pace account runs at most `slots` main sessions per box and the rest wait at their next stage
# start, while the children of the running ones still get their own pool and cannot deadlock behind them (#7869).
# Burn comes from the densest samples there are: climits' 5-min history.jsonl beside the meter (main), else the
# meter's own burn_pct_per_h (box.sh push-limits adds it), else this box's samples, needing 30 min of them.
# When the meter cannot speak for this login (climits' own grant revoked, mesh down), the week comes from the login's
# usage endpoint, at most every 5 min, with its access token as it stands: never refreshed here, because a refresh
# rotates the token under the running CLI (#8168). The login is what a box always has while its jobs can run at all.
# Waiting spends nothing. A caller that kills a waiting call after its own timeout gets a failure and retries, so
# drivers should still lower their own parallelism — this is the backstop that holds when they do not.
#
# Off for one call: CLAUDE_PACE_OFF=1. Install (per box as root): --install. Undo: --uninstall.
# Installs at /usr/local/bin/claude, which precedes /usr/bin and /root/.local/bin in job PATHs on the boxes, so running jobs pick it up
# on their next spawn without a restart. The real CLI stays where its installer put it.
# The real CLI: the apt/npm install on main, the native installer's ~/.local/bin on the other boxes. Job PATHs put
# /usr/local/bin ahead of /root/.local/bin, so the shim is found first either way.
REAL="${CLAUDE_REAL:-}"
[ -n "$REAL" ] || for c in /usr/bin/claude /root/.local/bin/claude; do [ -x "$c" ] && REAL=$c && break; done
SELF=/usr/local/bin/claude
DIR="${CLAUDE_PACE_DIR:-/root/claude-pace}"
METER="${CLAUDE_PACE_METER:-/root/.claude-limits/latest.json}"

if [ "$1" = "--install" ]; then
  [ -x "$REAL" ] || { echo "real claude not found at $REAL"; exit 1; }
  mkdir -p "$DIR" && cp "$0" "$DIR/claude-pace-guard.sh" && chmod 755 "$DIR/claude-pace-guard.sh"
  ln -sfn "$DIR/claude-pace-guard.sh" "$SELF"
  echo "claude-pace-guard installed: $SELF -> $REAL (max ${PACE_MAX_SLOTS:-12}, min ${PACE_MIN_SLOTS:-2} slots)"; exit 0
fi
if [ "$1" = "--uninstall" ]; then
  [ -L "$SELF" ] && rm -f "$SELF"; echo "claude-pace-guard removed ($REAL is used directly)"; exit 0
fi

print=0; agent=0
for a in "$@"; do
  case "$a" in -p|--print) print=1 ;; -c|--continue|-r|--resume|--resume=*) agent=1 ;; esac
done
# A job's main session (claude-job.sh sets CLAUDE_PACE_AGENT=1 on that one call) is an agent loop: its first and
# fresh sessions start without --continue, so on main they held a CHILD slot for hours and their own per-call
# children queued behind them, and on the guests they ran the real CLI and were never paced at all (#7869). It
# takes a main-pool slot instead; the flag is dropped here so its children are paced in the child pool.
pool=slot
if [ -n "${CLAUDE_PACE_AGENT:-}" ]; then unset CLAUDE_PACE_AGENT; pool=main; agent=0; print=1; fi
{ [ "$print" = 1 ] && [ "$agent" = 0 ] && [ -z "${CLAUDE_PACE_OFF:-}" ] && command -v flock >/dev/null; } || exec "$REAL" "$@"

# Decide the slot count for this account (cached a minute; one python start per call is cheap next to a model call).
decide() { python3 - "$METER" "$DIR" "${CLAUDE_CONFIG_DIR:-$HOME}" <<'PY'
import json, os, socket, sys, time, urllib.request, datetime as dt
meter, d, cfg = sys.argv[1:4]
MAX, MIN = int(os.environ.get("PACE_MAX_SLOTS", 12)), int(os.environ.get("PACE_MIN_SLOTS", 2))
try:
    email = json.load(open(os.path.join(cfg, ".claude.json")))["oauthAccount"]["emailAddress"].lower()
except Exception:
    print("unknown", MAX, "no-account"); sys.exit()
os.makedirs(d, exist_ok=True)
cache = os.path.join(d, email + ".slots")
try:
    if time.time() - os.path.getmtime(cache) < 60:
        print(email, open(cache).read().strip()); sys.exit()
except OSError:
    pass
def t(s):
    try: return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception: return None
now = dt.datetime.now(dt.timezone.utc)
def write(path, text):   # several calls decide at once: a shared .tmp lost the replace, and the race read as fail-open
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f: f.write(text)
    os.replace(tmp, path)
def from_meter():
    m = json.load(open(meter))
    seen = t(m.get("checked_at") or "")
    if seen is None or seen.tzinfo is None: raise ValueError("checked_at-unparseable")
    # A meter that stopped arriving (box mesh down, climits token expired) reads as one frozen sample, which aged
    # out of the 3h window and said burn-unknown forever, indistinguishable from a quiet account (#7869).
    age_m = (now - seen).total_seconds() / 60
    if age_m > 30: raise ValueError(f"meter-stale:{age_m:.0f}m")
    acc = next((a for a in m.get("accounts", []) if a.get("email", "").lower() == email), None)
    if acc is None: raise ValueError("account-not-in-meter")
    if not acc.get("ok"): raise ValueError("account-not-ok-in-meter")  # climits could not read it: re-login there
    return m["checked_at"], next(l for l in acc["limits"] if l["key"].startswith("weekly_all")), ""
def from_login():
    # PRIOR ART: scripts/eval/lane-judge-sampler.mjs claudeMeter, the same read. A failed read is cached too, so a
    # 429 is not asked again every minute.
    f = os.path.join(d, email + ".usage")
    try:
        r = json.load(open(f)) if time.time() - os.path.getmtime(f) < 300 else None
    except (OSError, ValueError):
        r = None
    if r is None:
        try:
            for c in (os.path.join(cfg, ".credentials.json"), os.path.join(cfg, ".claude", ".credentials.json")):
                if os.path.exists(c): break
            o = json.load(open(c))["claudeAiOauth"]
            if not o.get("expiresAt", 0) > (time.time() + 60) * 1000: raise ValueError("token-expired")
            req = urllib.request.Request(os.environ.get("CLAUDE_PACE_USAGE_URL", "https://api.anthropic.com/api/oauth/usage"),
                                         headers={"Authorization": "Bearer " + o["accessToken"], "anthropic-beta": "oauth-2025-04-20"})
            w = json.load(urllib.request.urlopen(req, timeout=10))["seven_day"]
            r = {"at": now.isoformat(), "percent": w["utilization"], "resets_at": w["resets_at"]}
        except Exception as e:
            r = {"error": type(e).__name__ + ":" + str(e)[:40]}
        write(f, json.dumps(r))
    if "error" in r: raise ValueError("login-unread:" + r["error"])
    return r["at"], {"key": "weekly_all:all", "percent": r["percent"], "resets_at": r["resets_at"]}, ",src=login"
out = (MAX, "no-meter")
try:
    try:
        at, w, via = from_meter()
    except Exception as e:
        try:
            at, w, via = from_login()
        except Exception as e2:
            raise ValueError(f"{e}+{e2}")
    seen = t(at)
    pct, reset = w.get("percent") or 0, t(w.get("resets_at") or "")
    # Keep our own samples: a box that only receives the meter (no climits history) still gets a burn rate.
    hist = os.path.join(d, email + ".hist")
    rows = [l.split() for l in open(hist)] if os.path.exists(hist) else []
    if not rows or rows[-1][0] != at:
        rows.append([at, str(pct)])
        rows = rows[-200:]
        write(hist, "".join(f"{a} {b}\n" for a, b in rows))
    # This box's samples exist only for minutes a paced call ran, so after any quiet gap the 3h window held one
    # sample and said burn-unknown for the first hour of the next burst (gex45, 2026-11-04: 15:00 -> 08:55 gap,
    # dereklomas at 4%/h read unknown until 09:55). Where climits runs (main) its 5-min history is read every time.
    rows = [r for r in rows if len(r) == 2]
    try:
        with open(os.path.join(os.path.dirname(meter), "history.jsonl"), "rb") as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - 256 * 1024))
            for line in f.read().decode(errors="replace").splitlines()[1:]:
                try: r = json.loads(line)
                except ValueError: continue
                v = (r.get("limits") or {}).get(w["key"])
                if r.get("email", "").lower() == email and v is not None: rows.append([r["t"], str(v)])
    except OSError:
        pass
    rows.sort(key=lambda r: t(r[0]) or now)
    left_h = (reset - now).total_seconds() / 3600 if reset else 0
    if left_h > 0:
        budget = max(0.0, 100 - pct) / left_h
        base = None
        for ts, p in rows:                       # oldest sample in the last 3h with no reset after it
            tt, p = t(ts), float(p)
            if tt is None or tt.tzinfo is None or (now - tt).total_seconds() > 3 * 3600: continue
            if p > pct: base = None; continue
            if base is None: base = (tt, p)
        span = (seen - base[0]).total_seconds() / 3600 if base and seen else 0
        burn, src = None, ""
        if span >= 0.5: burn = (pct - base[1]) / span
        elif w.get("burn_pct_per_h") is not None:   # main's 3h rate from climits history, added by box.sh push-limits
            burn, src = float(w["burn_pct_per_h"]), ",src=meter"
        if burn is not None:
            slots = MAX if burn <= budget else max(MIN, int(MAX * budget / burn))
            out = (slots, f"burn={burn:.2f}%/h,budget={budget:.2f}%/h,week={pct}%{src}{via}")
        else:
            out = (MAX, f"burn-unknown:span={span:.2f}h,samples={len(rows)}{via}")
except Exception as e:
    out = (MAX, f"meter-error:{type(e).__name__}:{str(e)[:120]}".replace(" ", "_"))
write(cache, f"{out[0]} {out[1]}\n")
# Fail-open stays (a blind meter must not stop work), but it is written down where `claude-job.sh where` and a
# person can see it: one line a minute at most, because the cache above runs this at most once a minute.
# failopen.log alone is a record nobody reads: 281 lines in 6.5 h went unnoticed on cloudlayer (#8168). So a guard that
# has failed open for over an hour pages, and again each day it lasts. "Over an hour" means calls kept coming through
# it: a gap of an hour between decisions is a quiet account, which is spending nothing, so the clock starts again.
def page(title, prio, body):
    try:
        urllib.request.urlopen(urllib.request.Request(os.environ.get("CLAUDE_PACE_NTFY", "https://ntfy.sh/sourcelibrary-uptime"),
                               data=body.encode(), headers={"Title": title, "Priority": prio}), timeout=5)
        return True
    except Exception:
        return False
state, tnow = os.path.join(d, email + ".failopen"), time.time()
try:
    since, last, paged = (float(x) for x in open(state).read().split())
except (OSError, ValueError):
    since, last, paged = tnow, tnow, 0
box = socket.gethostname()
if out[1].startswith("burn="):
    if os.path.exists(state):
        if paged: page(f"Pace guard back: {email} on {box}", "low", f"Paced again: {out[1]}")
        os.remove(state)
else:
    with open(os.path.join(d, "failopen.log"), "a") as f: f.write(f"{now:%FT%TZ} {email} {out[1]}\n")
    if tnow - last > 3600: since, paged = tnow, 0
    if tnow - since > 3600 and tnow - paged > 86400 and page(f"Pace guard failing open: {email} on {box}", "high",
            f"For {(tnow - since) / 3600:.1f} h this account's `claude -p` calls have run at {out[0]} slots with no pacing. "
            f"Why: {out[1]}. account-not-ok plus login-unread means climits and the box's login are both blind: "
            f"run `climits add {email}` on main and check the login on {box}. /root/claude-pace/failopen.log has the record (#8168)."):
        paged = tnow
    write(state, f"{since} {tnow} {paged}\n")
print(email, *out)
PY
}
read -r acct slots why < <(decide)
slots=${slots:-12}

# Take a slot: try each lock file without blocking; if all are held, wait and try again. The lock fd is closed for
# the child (9>&-), so the slot frees when THIS call ends, not when some grandchild the CLI left behind does.
mkdir -p "$DIR/$acct"; waited=0
while :; do
  for i in $(seq 1 "$slots"); do
    exec 9>"$DIR/$acct/$pool.$i"
    if flock -n 9; then
      [ "$waited" -gt 0 ] && echo "$(date -u +%FT%TZ) waited=${waited}s pool=$pool slots=$slots $why ppid=$PPID" >> "$DIR/$acct.waits.log"
      "$REAL" "$@" 9>&-; rc=$?; exec 9>&-; exit $rc
    fi
    exec 9>&-
  done
  # Said once, then every 10 min, so a job log that goes quiet while its main session waits says why.
  [ $((waited % 600)) = 0 ] && echo "claude-pace-guard: $acct over its weekly pace ($why); waiting for one of $slots $pool slots (${waited}s so far)" >&2
  sleep 5; waited=$((waited + 5))
  # Re-decide each minute: the account may have slowed, or its week reset, while this call waited.
  [ $((waited % 60)) = 0 ] && read -r _ slots why < <(decide) && slots=${slots:-12}
done
