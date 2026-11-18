#!/bin/bash
# Daily full logical backup with Percona Backup for MongoDB, its count manifest, and retention (#346).
# PRIOR ART: stage 0 runbook (#346) proved `pbm backup` + PITR on 9.0.7; scripts/maintenance/backup-*.sh
# back up Atlas into restic and do not apply here.
# Keeps the newest 7 backups plus the newest of each of the last 4 ISO weeks; oplog slices older than the
# oldest kept backup are deleted with it. Timer: sl-backup-daily.timer.
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
t0=$(date +%s)
fail() { log "FAILED: $*"; echo "{\"at\":\"$(date -u +%FT%TZ)\",\"ok\":false,\"error\":$(printf '%s' "$*" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" > "$STATE/last-backup-attempt.json"; page 4 "backup failed" "$*"; exit 1; }

name=$(pbmc backup -o json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])') || fail "pbm backup did not start"
log "backup $name started"
while :; do
  st=$(pbmc describe-backup "$name" -o json 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["status"])')
  case "$st" in done) break ;; error|cancelled) fail "backup $name ended $st" ;; esac
  [ $(( $(date +%s) - t0 )) -gt 14400 ] && fail "backup $name still '$st' after 4 h"
  sleep 30
done
size=$(pbmc describe-backup "$name" -o json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["size"])')
log "backup $name done in $(( $(date +%s) - t0 )) s, $size bytes"

# counts at the backup's consistency point: keep snapshot history long enough to read it
sl_mongosh "db.adminCommand({setParameter:1, minSnapshotHistoryWindowInSeconds: 3600})" >/dev/null
umask 077
sl_mongosh "const BACKUP='$name'; $(cat "$HERE/manifest.js")" > "$STATE/manifest-$name.json.tmp"; rc=$?
sl_mongosh "db.adminCommand({setParameter:1, minSnapshotHistoryWindowInSeconds: 300})" >/dev/null
[ $rc -eq 0 ] && python3 -c "import json;json.load(open('$STATE/manifest-$name.json.tmp'))" 2>/dev/null || fail "manifest for $name failed (rc $rc)"
mv "$STATE/manifest-$name.json.tmp" "$STATE/manifest-$name.json"
$S3 cp --only-show-errors "$STATE/manifest-$name.json" "s3://$S3_BUCKET/manifests/$name.json" || fail "manifest upload failed"
# PITR needs a full backup as its base; turn it on once (idempotent)
"$HERE/pbm-setup.sh" --pitr on >/dev/null || page 4 "PITR not enabled" "pbm config --set pitr.enabled=true failed after $name"

# retention
pbmc list -o json 2>/dev/null | python3 -c '
import json, sys, datetime
snaps = [s for s in json.load(sys.stdin)["snapshots"] if s.get("status") == "done"]
snaps.sort(key=lambda s: s["name"])
keep = set(s["name"] for s in snaps[-7:])
weeks = {}
for s in snaps:
    d = datetime.datetime.strptime(s["name"], "%Y-%m-%dT%H:%M:%SZ")
    weeks[d.isocalendar()[:2]] = s["name"]
for w in sorted(weeks)[-4:]: keep.add(weeks[w])
for s in snaps:
    if s["name"] not in keep: print("DEL", s["name"])
print("OLDEST", min(keep) if keep else "")
' > "$STATE/retention.txt"
while read -r verb n; do
  case "$verb" in
    DEL) log "retention: delete $n"; pbmc delete-backup -y "$n" >/dev/null 2>&1 || page 3 "retention" "could not delete backup $n"; rm -f "$STATE/manifest-$n.json"; $S3 rm --only-show-errors "s3://$S3_BUCKET/manifests/$n.json" ;;
    OLDEST) [ -n "$n" ] && { pbmc delete-pitr -y --older-than "$(echo "$n" | sed 's/Z$//')" >/dev/null 2>&1 || true; } ;;
  esac
done < "$STATE/retention.txt"

echo "{\"at\":\"$(date -u +%FT%TZ)\",\"ok\":true,\"name\":\"$name\",\"size\":$size,\"secs\":$(( $(date +%s) - t0 ))}" > "$STATE/last-backup.json"
cp "$STATE/last-backup.json" "$STATE/last-backup-attempt.json"
log "ok"
