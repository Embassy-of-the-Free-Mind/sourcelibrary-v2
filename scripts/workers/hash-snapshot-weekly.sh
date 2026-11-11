#!/bin/bash
#
# Weekly text hash snapshot with a public timestamp (#8150 slice 10).
#
# Also hashes the Embassy of the Free Mind public site (scripts/maintenance/hash-site.mjs) the same way.
#
# Reads the newest `corpus-text`/`pages` restic snapshot that backup-corpus-text.sh wrote on Sunday 06:00
# (no Atlas read, no new copy of any text), builds the Merkle snapshot, stamps the root with OpenTimestamps,
# uploads the hashes to the private `sl-corpus-snapshots` bucket under hash-snapshots/text/<date>/, and
# upgrades the timestamps of earlier snapshots that are still pending. See scripts/maintenance/hash-snapshot.mjs.
#
# Cron (main): Monday 01:30, after Sunday's dump has finished uploading.
#   30 1 * * 1 flock -n /tmp/sl-hash-snapshot.lock /root/sourcelibrary/scripts/workers/hash-snapshot-weekly.sh
#
# Local copies live on the Hetzner volume, never the root disk (#6223); the newest KEEP_LOCAL are kept for
# `prove`, older ones are deleted only once their upload and a Bitcoin-confirmed root.ots are in R2.
set -uo pipefail
REPO_DIR="${REPO_DIR:-/root/sourcelibrary}"
BASE="${SL_HASH_SNAPSHOT_DIR:-/mnt/HC_Volume_105839809/hash-snapshots}"
KEEP_LOCAL="${KEEP_LOCAL:-3}"
LOG="${LOG:-/var/log/sourcelibrary/hash-snapshot.log}"
mkdir -p "$(dirname "$LOG")" "$BASE"
log() { echo "[$(date -Is)] $1" >> "$LOG"; }
cd "$REPO_DIR" || exit 1
# shellcheck disable=SC1091
source /root/.config/restic-hetzner.env
NODE=(node --max-old-space-size=4096 --env-file="$REPO_DIR/.env.production.local" scripts/maintenance/hash-snapshot.mjs)

log "=== hash snapshot start ==="
snap_json=$(restic snapshots --tag corpus-text,pages --latest 1 --json 2>>"$LOG")
snap_id=$(echo "$snap_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s||"[]");if(a[0])console.log(a[0].short_id)})')
snap_day=$(echo "$snap_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s||"[]");if(a[0])console.log(a[0].time.slice(0,10))})')
if [ -z "$snap_id" ]; then log "FAIL: no corpus-text/pages restic snapshot"; exit 1; fi
DIR="$BASE/$snap_day"
failed=0

if [ -f "$DIR/manifest.json" ]; then
  log "snapshot $snap_day ($snap_id) already built"
else
  rm -rf "$DIR"  # a half-built dir from a crashed run: no manifest means nothing in it was published
  log "building $snap_day from restic $snap_id"
  restic dump "$snap_id" /pages.archive.gz 2>>"$LOG" | gunzip | "${NODE[@]}" build --archive - --dir "$DIR" --source "restic:$snap_id/pages.archive.gz" 2>>"$LOG"
  st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" -ne 0 ] || [ "${st[1]}" -ne 0 ] || [ "${st[2]}" -ne 0 ]; then
    log "FAIL build: restic=${st[0]} gunzip=${st[1]} node=${st[2]}"; rm -rf "$DIR"; exit 1
  fi
fi

[ -f "$DIR/root.ots" ] || "${NODE[@]}" stamp --dir "$DIR" 2>>"$LOG" || { log "WARN: stamp failed (calendars down?); retried next run"; failed=$((failed + 1)); }

# Embassy of the Free Mind public site: pages + images from its sitemap (no access to the site needed).
SITE_DIR="$BASE/site/$(date -u +%F)"
SITE=(node --env-file="$REPO_DIR/.env.production.local" scripts/maintenance/hash-site.mjs)
if [ ! -f "$SITE_DIR/manifest.json" ]; then
  rm -rf "$SITE_DIR"
  "${SITE[@]}" --sitemap https://www.embassyofthefreemind.com/sitemap.xml --dir "$SITE_DIR" 2>>"$LOG" || { log "FAIL site snapshot"; rm -rf "$SITE_DIR"; failed=$((failed + 1)); }
fi
if [ -f "$SITE_DIR/manifest.json" ]; then
  [ -f "$SITE_DIR/root.ots" ] || "${NODE[@]}" stamp --dir "$SITE_DIR" 2>>"$LOG" || failed=$((failed + 1))
fi
for d in "$BASE"/site/*/; do
  d="${d%/}"; [ -f "$d/manifest.json" ] || continue
  [ -f "$d/root.ots" ] && "${NODE[@]}" upgrade --dir "$d" 2>>"$LOG"
  "${SITE[@]}" upload --dir "$d" 2>>"$LOG" || { log "FAIL site upload $d"; failed=$((failed + 1)); }
done

# Upgrade every local snapshot whose stamp has not reached Bitcoin yet, then (re)upload: manifest and hash
# files are written once (If-None-Match); each new root.ots version gets its own key.
for d in "$BASE"/*/; do
  d="${d%/}"; [ -f "$d/manifest.json" ] || continue
  [ -f "$d/root.ots" ] && "${NODE[@]}" upgrade --dir "$d" 2>>"$LOG"
  "${NODE[@]}" upload --dir "$d" 2>>"$LOG" || { log "FAIL upload $d"; failed=$((failed + 1)); }
done

# Local retention: keep the newest KEEP_LOCAL; an older one goes only when its stamp is complete.
mapfile -t dirs < <(ls -1d "$BASE"/????-??-?? 2>/dev/null | sort -r)
for ((i = KEEP_LOCAL; i < ${#dirs[@]}; i++)); do
  d="${dirs[$i]}"
  if "${NODE[@]}" upgrade --dir "$d" 2>&1 | grep -q 'bitcoin attestation present' && "${NODE[@]}" upload --dir "$d" 2>>"$LOG"; then log "local copy of $(basename "$d") removed (in R2, confirmed)"; rm -rf "$d"; fi
done

if [ "$failed" -ne 0 ]; then log "=== hash snapshot FINISHED WITH $failed problem(s) ==="; exit 1; fi
log "=== hash snapshot OK — $snap_day ($snap_id) ==="
