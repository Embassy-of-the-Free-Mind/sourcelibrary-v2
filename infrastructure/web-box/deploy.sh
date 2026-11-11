#!/usr/bin/env bash
# Build and roll out one commit on the reader-origin box (#8384). Installed as
# /usr/local/bin/sl-web-deploy; the sl-web-deploy timer runs it every 5 minutes.
#
#   sl-web-deploy                 # the commit origin/release points at; no-op if already live
#   sl-web-deploy <sha> [--force] # a named commit (stage-0 testing only)
#
# Why release and not main: production is the `release` branch (#7008). A box page must
# load its own CSS and JS (trap 1), and readers move between box and Vercel pages, so the
# box builds exactly what Vercel builds, from the same commit, at about the same time.
#
# The build compiles only (no prerender) with the write guard in BUILD mode
# (GUARD_MODE=build): no socket to Atlas or Supabase at all, so a box build puts no load on
# production. Book pages are generated on demand anyway (generateStaticParams returns []);
# pages that do prerender on Vercel render on demand here, and the box serves none of them
# (the Caddyfile answers /book/* and /_box/* only). About 40 s, against 4–5 min in full.
#
# Assets: every release's .next/static is copied into one cumulative folder that Caddy
# serves at /_box/_next/static/*, so a tab holding the previous release's HTML still finds
# its chunks (the box's own skew protection). Folders older than 7 days are pruned.
set -euo pipefail
REPO="${SL_WEB_REPO:-https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git}"
ROOT=/srv/sl-web
PORTS="${SL_WEB_PORTS:-3101 3102 3103 3104}"
LOG="$ROOT/log/deploy.log"
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 0; }
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
as_web() { runuser -u slweb -- "$@"; }

[ -d "$ROOT/src/.git" ] || as_web git clone --quiet --filter=blob:none --no-checkout "$REPO" "$ROOT/src"
as_web git -C "$ROOT/src" fetch --quiet origin release main
# A named commit (stage-0 testing) may sit on a feature branch.
[ -n "${1:-}" ] && as_web git -C "$ROOT/src" fetch --quiet origin "+refs/heads/*:refs/remotes/origin/*"
SHA="${1:-$(as_web git -C "$ROOT/src" rev-parse origin/release)}"
SHA="$(as_web git -C "$ROOT/src" rev-parse "$SHA^{commit}")"
FORCE="${2:-}"
LIVE="$( [ -L "$ROOT/current" ] && basename "$(readlink -f "$ROOT/current")" || echo none)"
if [ "$LIVE" = "$SHA" ] && [ "$FORCE" != "--force" ]; then exit 0; fi
log "deploy $SHA (live: $LIVE)"

REL="$ROOT/releases/$SHA"
if [ ! -f "$REL/.built" ]; then
  rm -rf "$REL"
  as_web git -C "$ROOT/src" worktree prune
  as_web git -C "$ROOT/src" worktree add --quiet --detach "$REL" "$SHA"
  cd "$REL"
  # npm ci in this release's own folder only (never a shared tree).
  as_web env npm_config_cache="$ROOT/npm-cache" npm ci --no-audit --no-fund --loglevel=error >>"$LOG" 2>&1
  # The build sees the runtime allowlist plus GUARD_MODE=build (no data sockets).
  # A systemd EnvironmentFile (unquoted values may hold spaces), so not `source`d.
  # PATH and HOME stay the deploy's own (runuser lives in /usr/sbin).
  while IFS= read -r kv; do
    case "$kv" in ''|PATH=*|HOME=*) ;; *) export "$kv" ;; esac
  done < /etc/sl-web/env
  export GUARD_MODE=build GUARD_LOG="$ROOT/log/guard-build.jsonl" GUARD_APP_DIR="$REL"
  t0=$(date +%s)
  # Compile only, no prerender (`--experimental-build-mode=compile`): every route then
  # renders on demand. A full `next build` prerenders ~1,050 pages against production data;
  # with data sockets refused, 23+ of them throw and the build fails (measured 2026-11-07).
  # The prebuild step is `npm run build`'s: it generates src/lib/vendor/lamejs-bundle.js.
  runuser -u slweb --preserve-environment -- sh -c \
    'node scripts/build-lamejs-bundle.js && ./node_modules/.bin/next build --experimental-build-mode=compile' >>"$LOG" 2>&1 \
    || { log "BUILD FAILED for $SHA; live release unchanged"; exit 1; }
  log "built $SHA in $(( $(date +%s) - t0 ))s"
  touch "$REL/.built"
fi

# Cumulative static folder for /_box/_next/static (see header).
install -d -o slweb -g slweb "$ROOT/static/_next/static"
as_web cp -a --update=none "$REL/.next/static/." "$ROOT/static/_next/static/"
find "$ROOT/static/_next/static" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + || true

ln -sfn "$REL" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"

# Rolling restart: one process at a time, each must answer before the next goes down,
# so Caddy always has three upstreams.
for p in $PORTS; do
  systemctl restart "sl-web@$p"
  ok=0
  for _ in $(seq 1 60); do
    # A public file: proves the process serves without spending an Atlas read.
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: sourcelibrary.org' "http://localhost:$p/favicon.ico" || true)
    [ "$code" = 200 ] && { ok=1; break; }
    sleep 2
  done
  [ "$ok" = 1 ] || { log "port $p did not come up on $SHA (last $code); stopping the roll"; exit 1; }
done
log "live $SHA on ports $PORTS"

# Keep the three newest releases.
ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$ROOT/current")/" = "$old" ] && continue
  as_web git -C "$ROOT/src" worktree remove --force "$old" || rm -rf "$old"
done
