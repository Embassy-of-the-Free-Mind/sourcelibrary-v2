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
# A job's main session (claude-job.sh sets CLAUDE_PACE_AGENT=1 on that one call) is an agent loop too, but its
# first and fresh sessions start without --continue, so they held a slot for hours and their own per-call
# children queued behind them (#7869). The flag is dropped here so those children are paced as usual.
if [ -n "${CLAUDE_PACE_AGENT:-}" ]; then agent=1; unset CLAUDE_PACE_AGENT; fi
{ [ "$print" = 1 ] && [ "$agent" = 0 ] && [ -z "${CLAUDE_PACE_OFF:-}" ] && command -v flock >/dev/null; } || exec "$REAL" "$@"

# Decide the slot count for this account (cached a minute; one python start per call is cheap next to a model call).
read -r acct slots why < <(python3 - "$METER" "$DIR" "${CLAUDE_CONFIG_DIR:-$HOME}" <<'PY'
import json, os, sys, time, datetime as dt
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
out = (MAX, "no-meter")
try:
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
    w = next(l for l in acc["limits"] if l["key"].startswith("weekly_all"))
    pct, reset = w.get("percent") or 0, t(w.get("resets_at") or "")
    # Keep our own samples: a box that only receives the meter (no climits history) still gets a burn rate.
    hist = os.path.join(d, email + ".hist")
    rows = [l.split() for l in open(hist)] if os.path.exists(hist) else []
    if not rows:  # first call: seed from the box's climits history where it has one (main), else start sampling now
        try:
            for line in open(os.path.join(os.path.dirname(meter), "history.jsonl")).readlines()[-2000:]:
                r = json.loads(line)
                v = (r.get("limits") or {}).get(w["key"])
                if r.get("email", "").lower() == email and v is not None: rows.append([r["t"], str(v)])
        except Exception:
            pass
    if not rows or rows[-1][0] != m["checked_at"]:
        rows.append([m["checked_at"], str(pct)])
        rows = rows[-200:]
        with open(hist + ".tmp", "w") as f: f.write("".join(f"{a} {b}\n" for a, b in rows))
        os.replace(hist + ".tmp", hist)
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
        if span >= 1: burn = (pct - base[1]) / span
        elif w.get("burn_pct_per_h") is not None:   # climits' own 3h rate from its 5-min history (job-where.sh reads it)
            burn, src = float(w["burn_pct_per_h"]), ",src=meter"
        if burn is not None:
            slots = MAX if burn <= budget else max(MIN, int(MAX * budget / burn))
            out = (slots, f"burn={burn:.2f}%/h,budget={budget:.2f}%/h,week={pct}%{src}")
        else:
            out = (MAX, f"burn-unknown:span={span:.2f}h,samples={len(rows)}")
except Exception as e:
    out = (MAX, f"meter-error:{type(e).__name__}:{str(e)[:60]}".replace(" ", "_"))
open(cache, "w").write(f"{out[0]} {out[1]}\n")
# Fail-open stays (a blind meter must not stop work), but it is written down where `claude-job.sh where` and a
# person can see it: one line a minute at most, because the cache above runs this at most once a minute.
if not out[1].startswith("burn="):
    with open(os.path.join(d, "failopen.log"), "a") as f: f.write(f"{now:%FT%TZ} {email} {out[1]}\n")
print(email, *out)
PY
)
slots=${slots:-12}

# Take a slot: try each lock file without blocking; if all are held, wait and try again. The lock fd is closed for
# the child (9>&-), so the slot frees when THIS call ends, not when some grandchild the CLI left behind does.
mkdir -p "$DIR/$acct"; waited=0; logged=0
while :; do
  for i in $(seq 1 "$slots"); do
    exec 9>"$DIR/$acct/slot.$i"
    if flock -n 9; then
      [ "$waited" -gt 0 ] && echo "$(date -u +%FT%TZ) waited=${waited}s slots=$slots $why ppid=$PPID" >> "$DIR/$acct.waits.log"
      "$REAL" "$@" 9>&-; rc=$?; exec 9>&-; exit $rc
    fi
    exec 9>&-
  done
  [ "$logged" = 0 ] && echo "claude-pace-guard: $acct over its weekly pace ($why); waiting for one of $slots slots" >&2 && logged=1
  sleep 5; waited=$((waited + 5))
done
