#!/bin/bash
# Daily fallback backup that does not depend on Percona's tool (#346): mongodump --oplog of the whole
# replica set, streamed to object storage. PBM 2.17 does not list MongoDB 9.0 as supported; this is the
# method stage 0 tested instead (mongodump + oplog, restored with mongorestore --oplogReplay).
# PRIOR ART: stage 0 runbook, pitr-fallback.sh on sl-web-1 (#346); scripts/maintenance/backup-*.sh
# (mongodump into restic on main, for Atlas). Keeps the newest 7. Timer: sl-backup-fallback.timer (daily 22:30 UTC).
# Since 2026-11-16 this is the backup the restore test (Wed and Sun) restores: PBM 2.17 could not restore its own 9.0 backup.
# Restore: aws s3 cp s3://$S3_BUCKET/fallback/<name>.archive.gz - | mongorestore --gzip --archive --oplogReplay ...
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
t0=$(date +%s)
name=$(date -u +%Y-%m-%dT%H%M%SZ)
umask 077
CFG=/run/sl-mongodump.yaml
printf 'uri: mongodb://admin:%s@127.0.0.1:27017/?authSource=admin&directConnection=true\n' "$(cat /etc/sl-mongo/admin.pw)" > "$CFG"
trap 'rm -f "$CFG"' EXIT
# Dumps THIS member (directConnection + nearest): on the hidden Helsinki member, not the primary 36 ms away.
# --oplog needs the whole instance (no --db); local and config are skipped by mongodump itself
# the cluster time the moment mongodump exits: the manifest counts every collection at it (manifest.js AT_TS)
END_TS=$STATE/fallback-$name.end-ts
{ nice -n 10 mongodump --config "$CFG" --oplog --gzip --archive --quiet --readPreference=nearest; rc=$?
  sl_mongosh "const t=db.adminCommand({replSetGetStatus:1}).optimes.appliedOpTime.ts; print(t.getHighBits()+' '+t.getLowBits())" > "$END_TS"; exit $rc; } \
  | $S3 cp --only-show-errors --storage-class ONEZONE_IA --expected-size 120000000000 - "s3://$S3_BUCKET/fallback/$name.archive.gz"
st=("${PIPESTATUS[@]}")
if [ "${st[0]}" != 0 ] || [ "${st[1]}" != 0 ]; then page 4 "fallback backup failed" "mongodump|upload exit ${st[*]} for $name"; exit 1; fi
read -r et ei < "$END_TS" && [ -n "$ei" ] || { page 4 "fallback backup failed" "no end time recorded for $name"; exit 1; }
sl_mongosh "const BACKUP='fallback/$name', AT_TS=Timestamp({t:$et,i:$ei}); $(cat "$HERE/manifest.js")" > "$STATE/manifest-fallback-$name.json" \
  && python3 -c "import json;json.load(open('$STATE/manifest-fallback-$name.json'))" \
  && $S3 cp --only-show-errors "$STATE/manifest-fallback-$name.json" "s3://$S3_BUCKET/manifests/fallback-$name.json" \
  || { page 4 "fallback backup failed" "manifest for fallback $name failed"; exit 1; }
rm -f "$END_TS"
# mongodump does not write __mdb_internal_search (mongot's catalog), so the search index definitions travel
# beside the dump; a restore recreates them with createSearchIndex (README, Backups). A failure here pages but
# keeps the dump.
sl_mongosh "const out=[]; for (const d of db.adminCommand({listDatabases:1, nameOnly:true}).databases.map(x => x.name)) {
  if (['admin','local','config','__mdb_internal_search'].includes(d)) continue;
  for (const c of db.getSiblingDB(d).getCollectionInfos({type:'collection'}).map(x => x.name)) {
    for (const ix of db.getSiblingDB(d).getCollection(c).aggregate([{\$listSearchIndexes:{}}]).toArray())
      out.push({db: d, coll: c, name: ix.name, type: ix.type || 'search', definition: ix.latestDefinition}); } }
print(JSON.stringify(out));" > "$STATE/search-defs-$name.json" \
  && python3 -c "import json,sys;assert json.load(open('$STATE/search-defs-$name.json'))" \
  && $S3 cp --only-show-errors "$STATE/search-defs-$name.json" "s3://$S3_BUCKET/manifests/search-defs-$name.json" \
  || page 3 "fallback backup: search definitions" "could not save the search index definitions beside $name"
rm -f "$STATE/search-defs-$name.json"
size=$($S3API head-object --bucket "$S3_BUCKET" --key "fallback/$name.archive.gz" --query ContentLength --output text)
for old in $($S3 ls "s3://$S3_BUCKET/fallback/" | awk '{print $4}' | grep '\.archive\.gz$' | sort | head -n -7); do $S3 rm --only-show-errors "s3://$S3_BUCKET/fallback/$old"; $S3 rm --only-show-errors "s3://$S3_BUCKET/manifests/fallback-${old%.archive.gz}.json" || true; $S3 rm --only-show-errors "s3://$S3_BUCKET/manifests/search-defs-${old%.archive.gz}.json" 2>/dev/null || true; rm -f "$STATE/manifest-fallback-${old%.archive.gz}.json"; log "retention: removed $old"; done
echo "{\"at\":\"$(date -u +%FT%TZ)\",\"ok\":true,\"name\":\"$name\",\"size\":$size,\"secs\":$(( $(date +%s) - t0 ))}" > "$STATE/last-fallback.json"
log "fallback $name: $size bytes in $(( $(date +%s) - t0 )) s"
