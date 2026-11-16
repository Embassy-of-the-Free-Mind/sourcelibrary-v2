#!/bin/bash
# agy-guard: the `agy` on every box's PATH. Heavy Gemini models (Argon, Pro) need an explicit reason and a box-wide
# daily cap; everything else passes straight through to the real CLI.
#
# PRIOR ART: scripts/lib/agy-cli.mjs ledgerGate (#7118) — caps heavy calls per JOB, but only for callers that go
# through that library; ~15 scripts spawn `agy` directly and ad-hoc `agy -p` from a claude job bypasses it. On
# 2026-10-22 argon-high was locked while the ledger held no Argon call. This shim sits on PATH so it sees every caller.
#
# Rules, print mode only (-p/--print/--prompt; an interactive `agy` is a person and passes):
#   - a Gemini model that is not 3.8 Flash low or medium (Argon, Pro, Carbon, Hydrogen, Flash high, and any model agy
#     adds later: an ALLOWLIST since 2026-11-13, v3 #47): refused unless AGY_ALLOW_HEAVY=<issue or reason> is set, and then at most
#     AGY_HEAVY_BOX_CAP (default 40) such calls per UTC day on this box, counted in $AGY_GUARD_DIR/<date>.log.
#   - no --model: gemini-3.8-flash-low is added, so a bare `agy -p` can never land on a heavy default.
# A refusal prints "quota reached" on stderr and exits 75, so agy-cli.mjs and the scripts that copy its QUOTA regex
# stop as they would on a real lockout instead of retrying. A refusal that is a setup mistake rather than spent quota
# (an AGY_HOME with no login, a model that account may not run) says "refused (config)": it still stops the run
# once, and agy-cli.mjs does not record it as the account's pool running out (#7514 review).
#
# Install (per box as root, or on the Mac): scripts/workers/agy-guard.sh --install. Undo: --uninstall.
# The real CLI updates itself in place (Linux ~/.local/bin/agy, Mac /opt/homebrew/bin/agy), so the guard is a
# separate file earlier on PATH, never a replacement of the binary.
if [ "$(uname)" = Darwin ]; then
  REAL="${AGY_REAL:-/opt/homebrew/bin/agy}"; SELF_DIR="$HOME/bin/agy-guard"
  # .zprofile's `brew shellenv` and path_helper re-prepend Homebrew after .zshenv, so login shells need it again.
  RCS="$HOME/.zshenv $HOME/.zprofile $HOME/.zshrc"
  GUARD_DIR="${AGY_GUARD_DIR:-$HOME/.agy-quota/heavy}"
else
  REAL="${AGY_REAL:-/root/.local/bin/agy}"; SELF_DIR=/root/bin/agy-guard; RCS="/root/.bashrc /root/.profile"
  GUARD_DIR="${AGY_GUARD_DIR:-/root/agy-quota/heavy}"
fi
QUOTA_DIR="${AGY_QUOTA_CACHE:-$(dirname "$GUARD_DIR")/quota}"
SLOT_DIR="${AGY_SLOT_DIR:-$(dirname "$GUARD_DIR")/slots}"   # box-wide, so set before AGY_HOME moves GUARD_DIR
CAP="${AGY_HEAVY_BOX_CAP:-40}"
# The models a print call may run with no reason given; every other Gemini model is heavy. It was a blocklist
# ('argon|-pro') until 2026-11-13, when agy listed Gemini 4 Carbon and Hydrogen and neither matched: Carbon measured
# about 0.1 point of the weekly pool a call against Flash low's 0.001 (v3 #47). Keep in step with agy-cli.mjs HEAVY_MODEL.
FREE_GEMINI='^gemini-3\.8-flash-(low|medium)$'
MARK='# agy-guard PATH (#7075)'

if [ "$1" = "--install" ]; then
  mkdir -p "$SELF_DIR" && cp "$0" "$SELF_DIR/agy" && chmod 755 "$SELF_DIR/agy"
  for rc in $RCS; do
    grep -qF "$MARK" "$rc" 2>/dev/null || printf '\nexport PATH="%s:$PATH"  %s\n' "$SELF_DIR" "$MARK" >> "$rc"
  done
  # /usr/local/bin/agy is what a bare cron PATH or a non-login shell finds; point it at the guard too.
  [ -L /usr/local/bin/agy ] && ln -sfn "$SELF_DIR/agy" /usr/local/bin/agy
  echo "agy-guard installed: $SELF_DIR/agy -> $REAL (cap $CAP heavy calls/day)"; exit 0
fi
if [ "$1" = "--uninstall" ]; then
  for rc in $RCS; do sed -i.bak "\|$MARK|d" "$rc" && rm -f "$rc.bak"; done
  [ -L /usr/local/bin/agy ] && ln -sfn "$REAL" /usr/local/bin/agy
  rm -f "$SELF_DIR/agy"; echo "agy-guard removed"; exit 0
fi

# A second Google account: AGY_HOME=<dir> runs the CLI with that HOME, so it reads the login in
# <dir>/.gemini/antigravity-cli/antigravity-oauth-token instead of root's. Quota is per account, so the heavy-call cap
# is counted per account too. Linux only: the Mac keeps its login in the Keychain, which HOME does not change.
# Log an account in once with `HOME=<dir> agy` and finish the browser sign-in.
if [ -n "$AGY_HOME" ]; then
  [ -f "$AGY_HOME/.gemini/antigravity-cli/antigravity-oauth-token" ] || {
    echo "agy-guard: quota reached (refused (config)): AGY_HOME=$AGY_HOME has no login (run: HOME=$AGY_HOME agy)" >&2; exit 75; }
  export HOME="$AGY_HOME"; GUARD_DIR="$GUARD_DIR/$(basename "$AGY_HOME")"
fi

# Keep the login (v3 #69). Between 2026-11-09 and 11-13 the james, milo and default logins on gex45 were found as
# `{"token":null}` (14 bytes) five times, and every lane on that pool skipped until someone copied main's token by
# hand. The CLI logs of the 11-13 09:00:32Z loss show the cause: two `agy -p` calls on one login refreshed the
# access token in the same second (5 min before its expiry), both wrote the file, and from the next call on it read
# null. gex45 runs the most calls per login at once, which is why it is the only box this happens on.
# So before every call: a good token file is copied to antigravity-oauth-token.good when it has changed, and a null
# or short one is replaced by that copy (atomic rename; the old file is kept as .lost). The refresh token inside is
# what matters, and it survives the race, so the CLI refreshes from the copy. At most one restore per login per
# AGY_TOKEN_RESTORE_MIN (10) minutes: a login that is really revoked fails again, and agy-pools.mjs noteAuthLoss
# pages on its next /quota. Log: <agy-quota>/token-keeper.log. AGY_TOKEN_KEEP=0 turns it off.
token_ok() {  # a token file the CLI can use: 100 bytes or more, ends in "}", token not null
  [ -f "$1" ] && [ "$(wc -c < "$1")" -ge 100 ] && [ "$(tr -d '[:space:]' < "$1" | tail -c 1)" = "}" ] \
    && ! grep -q '"token"[[:space:]]*:[[:space:]]*null' "$1"
}
token_keep() {
  [ "${AGY_TOKEN_KEEP:-1}" = 0 ] && return 0
  local tok="$HOME/.gemini/antigravity-cli/antigravity-oauth-token" acct=default
  [ -n "$AGY_HOME" ] && acct=$(basename "$AGY_HOME")
  [ -f "$tok" ] || return 0   # no file login here (the Mac keeps it in the Keychain)
  if token_ok "$tok"; then
    cmp -s "$tok" "$tok.good" && return 0
    # Only when the token changed (about hourly), so the full parse costs nothing: a copy taken while the CLI was
    # mid-write can end in "}" and still be cut off.
    ( umask 077; cp "$tok" "$tok.good.$$" 2>/dev/null && token_ok "$tok.good.$$" \
      && python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["token"]' "$tok.good.$$" 2>/dev/null \
      && mv -f "$tok.good.$$" "$tok.good" )
    rm -f "$tok.good.$$"; return 0
  fi
  token_ok "$tok.good" || return 0
  [ -n "$(find "$tok.restored" -mmin -"${AGY_TOKEN_RESTORE_MIN:-10}" 2>/dev/null)" ] && return 0
  touch "$tok.restored" 2>/dev/null || return 0
  local was; was=$(wc -c < "$tok" | tr -d ' ')
  cp -p "$tok" "$tok.lost" 2>/dev/null
  ( umask 077; cp "$tok.good" "$tok.new.$$" && mv -f "$tok.new.$$" "$tok" ) || { rm -f "$tok.new.$$"; return 0; }
  mkdir -p "$(dirname "$QUOTA_DIR")" 2>/dev/null
  echo "$(date -u +%FT%TZ) $acct restored the last good token over a ${was}-byte file (v3 #69)" >> "$(dirname "$QUOTA_DIR")/token-keeper.log" 2>/dev/null
  echo "agy-guard: login $acct was lost (${was}-byte token file); restored its last good token (v3 #69)" >&2
}
token_keep

print=0; model=''; prev=''
for a in "$@"; do
  case "$a" in -p|--print|--prompt) print=1 ;; --model=*) model="${a#--model=}" ;; esac
  [ "$prev" = "--model" ] && model="$a"
  prev="$a"
done
[ "$print" = 1 ] || exec "$REAL" "$@"

# A Google account suspended for "violation of Terms of Service" (v3 #182). On 2026-11-12 19:12-21:55Z every call on
# the james and milo logins got `PERMISSION_DENIED (code 403): This service has been disabled in this account for
# violation of Terms of Service`, on every box; /quota still answered, so the lanes saw open pools and made ~2,000
# more calls into a suspended account, and nothing paged. Hammering a suspended account is the one thing that could
# turn a temporary suspension into a permanent one. The guard cannot read a call's output (it execs the CLI), but the
# CLI logs every call to $HOME/.gemini/antigravity-cli/log/cli-*.log, so:
#   - if one of this account's logs from the last AGY_TOS_WINDOW_MIN (30) minutes holds that message, the call is
#     refused as "refused (config)": the caller stops its run once, and no quota stop is written for the pool;
#   - one call every AGY_TOS_PROBE_MIN (15) minutes is let through as the probe; when the account works again its
#     clean logs age the bad ones out of the window and calls resume by themselves;
#   - the first refusal pages ntfy (at most once per 6 h per account) and the first clean call after it pages that
#     the suspension lifted. State: $TOS_DIR/<account>.{suspended,probe}. /quota is never refused.
TOS_DIR="${AGY_TOS_DIR:-$(dirname "$QUOTA_DIR")/tos}"
tos_page() {  # title, priority, message
  local s="${AGY_NTFY_SH:-/root/sourcelibrary/scripts/workers/ntfy-send.sh}"
  [ -x "$s" ] || [ -f "$s" ] || return 0
  NTFY_SRC=agy-guard.sh timeout 20 bash "$s" https://ntfy.sh/sourcelibrary-uptime "$1" "$2" warning "$3" >/dev/null 2>&1 || true
}
tos_check() {
  local logdir="$HOME/.gemini/antigravity-cli/log" acct=main hit a
  [ "${AGY_TOS_CHECK:-1}" = 0 ] && return 0
  for a in "$@"; do [ "$a" = /quota ] && return 0; done
  [ -d "$logdir" ] || return 0
  [ -n "$AGY_HOME" ] && acct=$(basename "$AGY_HOME")
  # The newest 200 logs of the window are plenty (a lane writes ~20 a minute at most), and keep the grep cheap.
  hit=$(find "$logdir" -maxdepth 1 -name 'cli-*.log' -mmin -"${AGY_TOS_WINDOW_MIN:-30}" -print 2>/dev/null \
    | xargs -r ls -t 2>/dev/null | head -200 | xargs -r grep -lF 'violation of Terms of Service' 2>/dev/null | head -1)
  mkdir -p "$TOS_DIR" 2>/dev/null || return 0
  if [ -z "$hit" ]; then
    if [ -f "$TOS_DIR/$acct.suspended" ]; then
      rm -f "$TOS_DIR/$acct.suspended" "$TOS_DIR/$acct.probe"
      echo "$(date -u +%FT%TZ) lifted" >> "$TOS_DIR/$acct.log"
      tos_page "agy account $acct works again on $(hostname)" default \
        "No 'violation of Terms of Service' reply in its last ${AGY_TOS_WINDOW_MIN:-30} min of calls; agy-guard lets its calls through again (v3 #182)."
    fi
    return 0
  fi
  if [ ! -f "$TOS_DIR/$acct.suspended" ] || [ -n "$(find "$TOS_DIR/$acct.suspended" -mmin +360 2>/dev/null)" ]; then
    [ -f "$TOS_DIR/$acct.suspended" ] || echo "$(date -u +%FT%TZ) suspended $(basename "$hit")" >> "$TOS_DIR/$acct.log"
    date -u +%FT%TZ > "$TOS_DIR/$acct.suspended"
    tos_page "agy account $acct SUSPENDED by Google (ToS) on $(hostname)" high \
      "Its calls return 'This service has been disabled in this account for violation of Terms of Service' ($hit). agy-guard now refuses its calls on this box and lets one probe through every ${AGY_TOS_PROBE_MIN:-15} min; it pages again when the account works. Do not log in again or move its lanes to another box. Appeal or wait: v3 #182."
  fi
  if [ -z "$(find "$TOS_DIR/$acct.probe" -mmin -"${AGY_TOS_PROBE_MIN:-15}" 2>/dev/null)" ]; then
    touch "$TOS_DIR/$acct.probe"; return 0   # this call is the probe
  fi
  echo "agy-guard: quota reached (refused (config)): account $acct is suspended by Google for 'violation of Terms of Service' (seen in $(basename "$hit")); probing every ${AGY_TOS_PROBE_MIN:-15} min (v3 #182)" >&2
  exit 75
}
tos_check "$@"

# A box-wide cap on agy calls running at once (v3 #70). Every lane picks its own --concurrency and nothing added
# them up: on 2026-11-12 gex45's cron lines asked for 36 calls at once, 22 were running at 1.5-2 GB each, the box sat
# at load 110 on 20 threads with 20 GB in swap, and a lane process got about a quarter of a core.
# This is the one place every caller passes, so the cap lives here: a call that finds the box full waits for room.
#   - Counted, not locked: the cap is the number of real CLI processes on the box right now (same name as the CLI,
#     and not a shell, which is what a waiting copy of this guard is). Nothing is held while a call runs, so nothing
#     leaks when one is killed, and the final `exec` stays: a caller's kill still lands on the CLI itself (#7503).
#   - One caller counts at a time (a lock on $SLOT_DIR/gate, dropped by the exec), so one freed place is not given
#     to every waiter at once.
#   - It never refuses. After AGY_SLOT_WAIT_S (120 s) the call runs anyway and the day's log says `overflow=1`.
#     Callers end a call 360 s after they start it (agy-cli.mjs killAfterMs), so the wait has to leave room to run.
#     Time spent in the WAL drain wait further down counts against the same 120 s.
#   - The free `/quota` read does not wait: gates and people sit on it with short timers.
# How many: AGY_BOX_SLOTS, else the table below (a full page call measured 15-20 CPU-seconds and up to 2 GB; a
# one-word reply 5.5 CPU-seconds and 0.55 GB). A box that is not named has no cap, and 0 turns it off.
# Waits are logged to $SLOT_DIR/<date>.log; tune the table from that file and the box's CPU pressure.
box_slots() {
  [ -n "${AGY_BOX_SLOTS:-}" ] && { echo "$AGY_BOX_SLOTS"; return; }
  case "$(hostname)" in
    gex45-1) echo 12 ;;                    # 20 threads, 62 GB, shared with the GPU stack and six CI runners
    clawdbot) echo 8 ;;                    # main: 16 vCPU, 30 GB
    earthai-live|earthai-l7a) echo 4 ;;    # guests: the box's own service comes first
    *) echo 0 ;;
  esac
}
agy_running() {
  local pids me
  pids=$(pgrep -x "$(basename "$REAL" | cut -c1-15)") || { echo 0; return; }
  me=$(readlink /proc/$$/exe)
  # shellcheck disable=SC2086,SC2046
  readlink $(printf '/proc/%s/exe ' $pids) 2>/dev/null | grep -cvxF "$me"
}
admit() {  # "$@" = the call's arguments. Returns when the call may run; fd 9 may be left open for the exec to close.
  local slots a max waited=0 n nap day
  slots=$(box_slots)
  [ "${slots:-0}" -gt 0 ] 2>/dev/null || return 0
  { [ -r /proc/$$/exe ] && command -v pgrep >/dev/null && command -v flock >/dev/null; } || return 0
  for a in "$@"; do [ "$a" = /quota ] && return 0; done
  { mkdir -p "$SLOT_DIR" 2>/dev/null && [ -w "$SLOT_DIR" ]; } || return 0   # a failed `exec 9>` would end the shell
  max=$(( ${AGY_SLOT_WAIT_S:-120} - ${DRAINED:-0} )); [ "$max" -lt 0 ] && max=0   # both waits together stay inside the caller's timer
  while :; do
    exec 9>"$SLOT_DIR/gate" || return 0
    flock -w 10 9
    n=$(agy_running)
    if [ "${n:-0}" -lt "$slots" ] || [ "$waited" -ge "$max" ]; then
      if [ "$waited" -gt 0 ]; then
        day=$(date -u +%F)
        [ -e "$SLOT_DIR/$day.log" ] || find "$SLOT_DIR" -name '20*.log' -mtime +14 -delete 2>/dev/null
        echo "$(date -u +%FT%TZ) waited=${waited}s running=$n slots=$slots overflow=$([ "${n:-0}" -lt "$slots" ] && echo 0 || echo 1) ppid=$PPID" >> "$SLOT_DIR/$day.log"
      fi
      return 0
    fi
    exec 9>&-
    nap=${AGY_SLOT_POLL_S:-$((3 + RANDOM % 4))}; sleep "$nap"; waited=$((waited + nap))
  done
}

# Keep agy's history database from filling the disk. agy never checkpoints its SQLite write-ahead log while other
# calls hold the database open, so a job with calls always in flight grows the log without bound: 25 GB on the
# Hetzner root disk on 2026-10-27, which filled it to 100% (the nightly disk-steward.sh checkpoint was too rare).
# It grew ~350 MB a minute under one Tibetan job, and a checkpoint taken while calls are writing returns busy. What
# worked by hand was to hold new calls for a moment so the running ones finish, then checkpoint. So: when the log
# passes AGY_WAL_MAX_MB (4 GB), the first call to see it takes a drain lock (an atomic mkdir), and every call that
# starts while it is held waits; the holder retries a TRUNCATE checkpoint for up to 2 minutes, then releases. The
# wait stays well inside callers' kill timer (agy-cli.mjs: --print-timeout 300s). A checkpoint is SQLite's own
# operation and drops nothing. A lock older than 5 minutes belongs to a dead holder and is cleared.
AGY_DB_DIR="${AGY_DB_DIR:-$HOME/.gemini/antigravity-cli}"
WAL="$AGY_DB_DIR/conversation_summaries.db-wal"; DRAIN="$AGY_DB_DIR/.agy-guard-drain"
[ -n "$(find "$DRAIN" -maxdepth 0 -mmin +5 2>/dev/null)" ] && rmdir "$DRAIN" 2>/dev/null
if [ -n "$(find "$WAL" -size +"${AGY_WAL_MAX_MB:-4096}"M 2>/dev/null)" ] && mkdir "$DRAIN" 2>/dev/null; then
  python3 - "${WAL%-wal}" >> "$AGY_DB_DIR/agy-guard-checkpoint.log" 2>&1 <<'PY'
import os, sqlite3, sys, time
db = sys.argv[1]; before = os.path.getsize(db + '-wal'); t0 = time.time(); r = (1,)
while r[0] and time.time() - t0 < 120:
    c = sqlite3.connect(db, timeout=3); r = c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone(); c.close()
    if r[0]: time.sleep(2)
after = os.path.getsize(db + '-wal') if os.path.exists(db + '-wal') else 0
print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'busy' if r[0] else 'ok', before >> 20, 'MB ->', after >> 20, 'MB after', int(time.time() - t0), 's')
PY
  rmdir "$DRAIN"
fi
n=0; while [ -d "$DRAIN" ] && [ "$n" -lt 45 ]; do sleep 3; n=$((n + 1)); done
DRAINED=$((n * 3))   # seconds this call already waited here; the box cap below waits that much less

# A second account may be held to one model: AGY_HOME/allowed-model names it (jamesdereklomas@: 3.8 Flash low only,
# Derek 2026-10-27, so its pool goes to bulk OCR and translation). A call with no --model gets it; any other is refused.
if [ -n "$AGY_HOME" ] && [ -s "$AGY_HOME/allowed-model" ]; then
  only=$(tr -d '[:space:]' < "$AGY_HOME/allowed-model")
  [ -z "$model" ] && { admit "$@"; exec "$REAL" "$@" --model "$only" 9>&-; }
  if [ "$model" != "$only" ]; then
    echo "agy-guard: quota reached (refused (config)): $(basename "$AGY_HOME") runs $only only, not $model" >&2
    exit 75
  fi
fi

# Claude (and GPT, the same agy pool) only once this account's Gemini pool is empty (#7545; Derek 2026-10-27/28): the
# Gemini WEEKLY bucket must be empty (remaining_fraction under 0.005, AGY_GEMINI_EMPTY in agy-cli.mjs; a spent pool
# keeps a residue such as 0.00028 and never reads exactly 0) and both Claude buckets at least 10%. Read from `/quota` (free),
# cached 10 min in $QUOTA_DIR/<account>.json, the file agy-cli.mjs agyQuota() reads and writes too, so a reset is seen
# within one cache period and the call goes back to Gemini. Fails CLOSED: an unreadable quota refuses. Checked after
# the one-model rule above: an account held to one model (allowed-model) runs that model only, Claude included.
if echo "$model" | grep -qiE '^(claude|gpt)'; then
  acct=main; [ -n "$AGY_HOME" ] && acct=$(basename "$AGY_HOME")
  qf="$QUOTA_DIR/$acct.json"
  # Prints nothing when Claude may run, "stale" when the cache is missing, older than 10 min or dated in the future
  # (a minute of clock skew allowed), else the reason it may not.
  qcheck() { python3 - "$qf" "$acct" <<'PY' 2>/dev/null || echo "quota for $acct unreadable"
import json, os, sys, time
try:
    age = time.time() - os.path.getmtime(sys.argv[1])
except OSError:
    age = None
if age is None or not -60 <= age < 600:
    print('stale'); sys.exit()
try:
    g = {x['name']: {b['window']: b['remaining_fraction'] for b in x['buckets']} for x in json.load(open(sys.argv[1]))['command']['data']['groups']}
except Exception:
    print('quota for %s unreadable' % sys.argv[2]); sys.exit()
gem = next((v for k, v in g.items() if k.lower().startswith('gemini')), {}).get('weekly')
cl = next((v for k, v in g.items() if 'claude' in k.lower()), {})
if not isinstance(gem, (int, float)): print('quota for %s unreadable' % sys.argv[2])
elif gem >= 0.005: print('%s Gemini weekly %.1f%% left' % (sys.argv[2], gem * 100))
else:
    low = [w for w in ('weekly', '5h') if not (isinstance(cl.get(w), (int, float)) and cl[w] >= 0.10)]
    print('%s Claude %s under 10%%' % (sys.argv[2], low[0]) if low else '')
PY
  }
  why=$(qcheck)
  if [ "$why" = stale ]; then
    mkdir -p "$QUOTA_DIR" && "$REAL" -p /quota --output-format json --model gemini-3.8-flash-low > "$qf.tmp$$" 2>/dev/null \
      && grep -q '"remaining_fraction"' "$qf.tmp$$" && mv "$qf.tmp$$" "$qf"
    rm -f "$qf.tmp$$"
    why=$(qcheck); [ "$why" = stale ] && why="quota for $acct unreadable"
  fi
  if [ -n "$why" ]; then
    echo "agy-guard: quota reached (refused (config)): $model runs on agy only once the Gemini pool is empty ($why); use claude -p (#7545)" >&2
    exit 75
  fi
  admit "$@"; exec "$REAL" "$@" 9>&-
fi

if [ -z "$model" ]; then
  echo "agy-guard: no --model given; using gemini-3.8-flash-low" >&2
  admit "$@"; exec "$REAL" "$@" --model gemini-3.8-flash-low 9>&-
fi

if echo "$model" | grep -qiE '^gemini' && ! echo "$model" | grep -qiE "$FREE_GEMINI"; then
  day=$(date -u +%F)
  if [ -z "$AGY_ALLOW_HEAVY" ]; then
    echo "agy-guard: quota reached (refused): $model needs AGY_ALLOW_HEAVY=<issue> — only 3.8 Flash low/medium run without one (v3 #47); heavy models share the account's one Gemini pool" >&2
    exit 75
  fi
  mkdir -p "$GUARD_DIR"
  used=$(cat "$GUARD_DIR/$day.log" 2>/dev/null | wc -l)
  if [ "$used" -ge "$CAP" ]; then
    echo "agy-guard: quota reached (refused): box cap of $CAP heavy calls for $day is used ($AGY_ALLOW_HEAVY)" >&2
    exit 75
  fi
  echo "$(date -u +%FT%TZ),$model,${AGY_JOB:-?},$AGY_ALLOW_HEAVY,$PPID" >> "$GUARD_DIR/$day.log"
fi
admit "$@"; exec "$REAL" "$@" 9>&-
