#!/usr/bin/env bash
# idle-poweroff.sh — make a rented Scaleway GPU turn ITSELF off when it has nothing to do.
#
# WHY (2026-09-26). September's GPUs billed ~12x their busy-rate cost, mostly idle time inside a
# live lease: a job finished or a driving session died and the box sat there until the lease ran
# out. The Hetzner watchdog (scripts/maintenance/gpu-lease-watchdog.mjs) stops expired leases and,
# with a `progress=` tag, idle ones; this is the guard from the INSIDE, so it works for any job.
#
# A guest `shutdown -h` leaves a Scaleway instance "stopped in place" and STILL BILLED. Only the
# provider API's `poweroff` action ends billing, so that is what this calls.
#
# Two modes:
#   idle-poweroff.sh run -- <command...>   run the job, then power off when it exits (any exit code).
#                                          KEEP_ALIVE=1 skips the poweroff (for a debugging session).
#   idle-poweroff.sh watch                 loop: power off after IDLE_MINUTES (default 20) of GPU
#                                          utilisation below IDLE_UTIL % (default 5), once the box has
#                                          been up GRACE_MINUTES (default 15).
#   idle-poweroff.sh install               install `watch` as a systemd service that starts at boot,
#                                          so a box that is powered on and forgotten still turns off.
#
# Needs: /etc/gpu-idle.env with SCW_SECRET_KEY=<key allowed to act on this project's instances>
#        (chmod 600). The server finds its own id and zone from the Scaleway metadata service;
#        SERVER_ID / ZONE in the env override that. Uses curl, python3 and nvidia-smi.
set -euo pipefail

ENV_FILE=${GPU_IDLE_ENV:-/etc/gpu-idle.env}
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
IDLE_MINUTES=${IDLE_MINUTES:-20}
IDLE_UTIL=${IDLE_UTIL:-5}
GRACE_MINUTES=${GRACE_MINUTES:-15}
LOG=${GPU_IDLE_LOG:-/var/log/gpu-idle-poweroff.log}

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG" >&2; }

whoami_scw() {
  if [ -n "${SERVER_ID:-}" ] && [ -n "${ZONE:-}" ]; then return; fi
  local meta
  meta=$(curl -fsS --max-time 5 'http://169.254.42.42/conf?format=json')
  SERVER_ID=${SERVER_ID:-$(printf '%s' "$meta" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')}
  ZONE=${ZONE:-$(printf '%s' "$meta" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("zone") or d.get("location",{}).get("zone_id",""))')}
  [ -n "$SERVER_ID" ] && [ -n "$ZONE" ] || { log "cannot read server id/zone from metadata"; exit 1; }
}

poweroff_api() {
  local why=$1
  [ -n "${SCW_SECRET_KEY:-}" ] || { log "SCW_SECRET_KEY missing in $ENV_FILE — cannot power off ($why)"; exit 1; }
  whoami_scw
  log "POWEROFF $SERVER_ID ($ZONE): $why"
  curl -fsS --max-time 20 -X POST -H "X-Auth-Token: $SCW_SECRET_KEY" -H 'Content-Type: application/json' \
    -d '{"action":"poweroff"}' "https://api.scaleway.com/instance/v1/zones/$ZONE/servers/$SERVER_ID/action" >>"$LOG" 2>&1 \
    || { log "poweroff API call FAILED — the box may still be billing"; exit 2; }
}

gpu_util() { nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -1; }
uptime_min() { awk '{print int($1/60)}' /proc/uptime; }

case "${1:-}" in
  run)
    shift; [ "${1:-}" = "--" ] && shift
    [ $# -gt 0 ] || { echo "usage: $0 run -- <command...>" >&2; exit 64; }
    set +e; "$@"; rc=$?; set -e
    if [ "${KEEP_ALIVE:-0}" = "1" ]; then log "job exited $rc; KEEP_ALIVE=1, not powering off"; exit "$rc"; fi
    poweroff_api "job exited with code $rc: $*"
    exit "$rc"
    ;;
  watch)
    whoami_scw
    log "watching $SERVER_ID ($ZONE): poweroff after ${IDLE_MINUTES} min below ${IDLE_UTIL}% GPU, grace ${GRACE_MINUTES} min"
    idle=0
    while true; do
      sleep 60
      u=$(gpu_util); u=${u:-0}
      if [ "$(uptime_min)" -lt "$GRACE_MINUTES" ]; then idle=0; continue; fi
      if [ "$u" -lt "$IDLE_UTIL" ]; then idle=$((idle + 1)); else idle=0; fi
      if [ "$idle" -ge "$IDLE_MINUTES" ]; then poweroff_api "GPU below ${IDLE_UTIL}% for ${idle} min"; exit 0; fi
    done
    ;;
  install)
    [ "$(id -u)" = 0 ] || { echo "install needs root" >&2; exit 1; }
    install -m 755 "$0" /usr/local/bin/idle-poweroff.sh
    cat >/etc/systemd/system/gpu-idle-poweroff.service <<'UNIT'
[Unit]
Description=Power this rented GPU off through the Scaleway API when it sits idle
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/idle-poweroff.sh watch
Restart=on-failure
RestartSec=60

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload && systemctl enable --now gpu-idle-poweroff.service
    [ -f "$ENV_FILE" ] || echo "WARNING: $ENV_FILE is missing — add SCW_SECRET_KEY=... (chmod 600) or the watcher cannot power off" >&2
    systemctl --no-pager status gpu-idle-poweroff.service | head -5
    ;;
  *) sed -n '2,30p' "$0"; exit 64 ;;
esac
