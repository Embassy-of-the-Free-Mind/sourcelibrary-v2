#!/bin/bash
# Restore test (#346; timer Wed+Sun 03:30 UTC): restore the NEWEST backup from object storage into a scratch mongod
# (port 27217, loopback only, TTL monitor off) and compare every collection's count and index names with
# the manifest recorded at the backup's own consistency point. Pages on failure, and when the newest
# backup is more than 26 hours old.
# METHOD=fallback (default): the mongodump --oplog archive (fallback-dump.sh, daily), restored with
#   mongorestore --oplogReplay. METHOD=pbm: the Percona backup, restored with pbm restore. On 2026-11-16 PBM
#   2.17 could not restore its own 9.0 backup: its oplog replay skipped part of the backup's oplog and stopped
#   on an update of a document whose insert it had not applied (three runs, three documents; README).
# PRIOR ART: the stage 0 restore drill (#346) compared against Atlas's live counts and lost TTL rows;
# scripts/maintenance/backup-*.sh read a restic snapshot back but never restore it into a server.
#
# Scope (egress): METHOD=fallback always restores the whole archive in one pass (~40 GB of egress a test, the
# reason the timer runs twice a week, not nightly). METHOD=pbm restores in chunks of at most CHUNK_GB, counted
# then dropped, and by default a rotating seventh of the large collections each night (everything on Sundays or
# with no full test in 8 days); SCOPE=full|rotate overrides.
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
PORT=27217
DIR=/var/lib/sl-restoretest
RUN=/run/sl-restoretest
CHUNK_GB=${CHUNK_GB:-15}
t0=$(date +%s)
RESULT="$STATE/restore-test.json"
fail() { log "FAILED: $*"; keep_logs; finish false "$*"; page 4 "restore test FAILED" "$*"; exit 1; }
finish() { python3 - "$1" "$2" > "$RESULT.tmp" <<EOF
import json, sys
print(json.dumps({"at": "$(date -u +%FT%TZ)", "ok": sys.argv[1] == "true", "note": sys.argv[2], "backup": "${name:-}", "scope": "${SCOPE:-}", "secs": $(( $(date +%s) - t0 )), "checked": ${checked:-0}, "mismatches": json.load(open("$RUN/mismatches.json")) if __import__("os").path.exists("$RUN/mismatches.json") else []}))
EOF
  mv "$RESULT.tmp" "$RESULT"; $S3 cp --only-show-errors "$RESULT" "s3://$S3_BUCKET/restore-tests/$(date -u +%F).json" || true; }
# PBM reports a failed oplog apply as a bare "applyOps had one or more errors"; the reason is in the scratch
# mongod's log, which teardown deletes. Keep the last of both logs beside the result.
keep_logs() { for f in mongod.log pbm-agent.log; do [ -f "$DIR/$f" ] && tail -c 2000000 "$DIR/$f" > "$STATE/restore-test-failed-$f"; done; true; }
teardown() {
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null
  mongosh --quiet "mongodb://127.0.0.1:$PORT/?directConnection=true" --eval "db.getSiblingDB('admin').auth('admin', fs.readFileSync('$RUN/admin.pw','utf8').trim()); db.adminCommand({shutdown:1, force:true})" >/dev/null 2>&1
  sleep 3; pkill -f "[m]ongod --config $RUN/mongod.conf" 2>/dev/null; rm -rf "$DIR"
}
trap teardown EXIT
METHOD=${METHOD:-fallback}

# 1. newest backup and its manifest
case "$METHOD" in
  pbm) name=$(pbmc list -o json 2>/dev/null | python3 -c 'import json,sys;s=[x for x in json.load(sys.stdin)["snapshots"] if x.get("status")=="done"];print(sorted(x["name"] for x in s)[-1] if s else "")')
       mkey="manifests/$name.json"; when=$name ;;
  fallback) arch=$($S3 ls "s3://$S3_BUCKET/fallback/" | awk '{print $4}' | grep '\.archive\.gz$' | sort | tail -1)
       name=${arch%.archive.gz}; mkey="manifests/fallback-$name.json"
       when=$(echo "$name" | sed -E 's/T([0-9]{2})([0-9]{2})([0-9]{2})Z/T\1:\2:\3Z/') ;;
  *) fail "METHOD must be fallback or pbm, not $METHOD" ;;
esac
[ -n "$name" ] || fail "no completed $METHOD backup to restore"
age_h=$(( ( $(date +%s) - $(date -d "$when" +%s) ) / 3600 ))
[ "$age_h" -ge 26 ] && page 4 "newest backup is ${age_h} h old" "newest $METHOD backup $name; the daily backup has not succeeded for over a day"
# the scratch mongod runs as mongodb and reads its config and keyfile here; the password files stay root 600
mkdir -p "$RUN"; chown root:mongodb "$RUN"; chmod 750 "$RUN"; rm -f "$RUN/mismatches.json"
M="$RUN/manifest.json"
$S3 cp --only-show-errors "s3://$S3_BUCKET/$mkey" "$M" || fail "manifest for $name missing in the bucket ($mkey)"
log "restore test ($METHOD) of $name (${age_h} h old)"

# 2. scratch cluster
rm -rf "$DIR"; mkdir -p "$DIR/db"; chown -R mongodb: "$DIR"
(umask 077; openssl rand -base64 756 > "$RUN/keyfile"; openssl rand -hex 24 | tr -d '\n' > "$RUN/admin.pw"; openssl rand -hex 24 | tr -d '\n' > "$RUN/pbm.pw")
# a fallback restore brings production's admin.system.users with it and replaces the scratch users; with the same
# admin password the restoring session and the checks after it still authenticate. The set stays loopback-only.
[ "$METHOD" = fallback ] && (umask 077; tr -d '\n' < /etc/sl-mongo/admin.pw > "$RUN/admin.pw")
chown mongodb: "$RUN/keyfile"; chmod 400 "$RUN/keyfile"
cat > "$RUN/mongod.conf" <<EOF
storage: { dbPath: $DIR/db, wiredTiger: { engineConfig: { cacheSizeGB: 2 }, collectionConfig: { blockCompressor: zstd } } }
systemLog: { destination: file, path: $DIR/mongod.log }
net: { port: $PORT, bindIp: 127.0.0.1 }
# same set name as production: PBM lists and restores a backup only into a set of the name it was taken from.
# It is a separate set all the same: its own keyfile, loopback only, its own port, never in rs0's member list.
replication: { replSetName: rs0, oplogSizeMB: 2048 }
security: { authorization: enabled, keyFile: $RUN/keyfile }
processManagement: { fork: true, timeZoneInfo: /usr/share/zoneinfo }
setParameter: { ttlMonitorEnabled: false }
EOF
sudo -u mongodb mongod --config "$RUN/mongod.conf" >/dev/null || fail "scratch mongod did not start: $(tail -c 300 "$DIR/mongod.log" 2>/dev/null)"
# first user through the localhost exception
mongosh --quiet "mongodb://127.0.0.1:$PORT/?directConnection=true" --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:$PORT'}]}); while(!db.hello().isWritablePrimary) sleep(500); db.getSiblingDB('admin').createUser({user:'admin',pwd:fs.readFileSync('$RUN/admin.pw','utf8').trim(),roles:['root']}); void 0" >/dev/null || fail "scratch replica set init failed"
ADMIN_PW_FILE=$RUN/admin.pw sl_mongosh "const a=db.getSiblingDB('admin'); a.createRole({role:'pbmAnyAction',privileges:[{resource:{anyResource:true},actions:['anyAction']}],roles:[]}); a.createUser({user:'pbm',pwd:fs.readFileSync('$RUN/pbm.pw','utf8').trim(),roles:[{db:'admin',role:'readWrite',collection:''},{db:'admin',role:'backup'},{db:'admin',role:'clusterMonitor'},{db:'admin',role:'restore'},{db:'admin',role:'pbmAnyAction'}]}); a.grantRolesToUser('admin',['pbmAnyAction']); /* mongorestore --oplogReplay needs anyAction */ void 0" $PORT >/dev/null || fail "scratch users failed"

# 3. a PBM agent for the scratch cluster, on the same storage (PITR stays off there); or mongorestore's config
if [ "$METHOD" = fallback ]; then
  # mongorestore signs in as the internal __system user (the scratch keyfile), not as a user in admin.system.users:
  # the archive carries production's users and --drop replaces them mid-restore, which signs out a session that
  # logged in as one of them, so the oplog replay at the end failed "applyOps requires authentication" (2026-11-16).
  (umask 077; printf 'uri: mongodb://__system:%s@127.0.0.1:%s/?authSource=local&directConnection=true\n' \
    "$(python3 -c "import sys,urllib.parse;print(urllib.parse.quote(''.join(open(sys.argv[1]).read().split()),safe=''))" "$RUN/keyfile")" "$PORT" > "$RUN/mongorestore.yaml")
else
export PBM_MONGODB_URI="mongodb://pbm:$(cat "$RUN/pbm.pw")@127.0.0.1:$PORT/?authSource=admin&replicaSet=rs0&directConnection=true"
# every pbm call from here on must reach the scratch cluster, never the production set on 27017 (a restore there would overwrite it)
pbmc() { case "$PBM_MONGODB_URI" in *"@127.0.0.1:$PORT/"*) pbm "$@" ;; *) fail "PBM is not pointed at the scratch cluster; refusing pbm $1" ;; esac; }
sudo -u mongodb --preserve-env=PBM_MONGODB_URI pbm-agent > "$DIR/pbm-agent.log" 2>&1 & AGENT_PID=$!
sleep 5
"$HERE/pbm-setup.sh" >/dev/null || fail "pbm config on the scratch cluster failed"
for i in $(seq 1 60); do pbmc list -o json 2>/dev/null | grep -q "\"$name\"" && break; [ "$i" = 3 ] && pbmc config --force-resync >/dev/null 2>&1; sleep 10; done
pbmc list -o json 2>/dev/null | grep -q "\"$name\"" || fail "scratch PBM does not see backup $name"
fi

# 4. chunks by live storage size, restore, compare, drop
sl_mongosh "const m=JSON.parse(fs.readFileSync('$M','utf8')); const out=[];
for (const [d, cs] of Object.entries(m.dbs)) for (const c of Object.keys(cs)) {
  let s = 0; try { const st = db.getSiblingDB(d).getCollection(c).aggregate([{\$collStats:{storageStats:{}}}]).toArray()[0].storageStats; s = Number(st.storageSize) + Number(st.totalIndexSize);  /* Longs: + would join them as strings */ } catch (e) {}
  out.push([d + '.' + c, s]); }
print(JSON.stringify(out));" > "$RUN/sizes.json" || fail "could not size collections"
SCOPE=${SCOPE:-}
# mongorestore refuses --oplogReplay with --nsInclude, and the archive streams whole whatever is chosen: the
# fallback restores in ONE pass (the whole archive), so the box needs room for a second copy.
if [ "$METHOD" = fallback ]; then
  SCOPE=full; CHUNK_GB=100000
  need_kb=$(( $(du -sk /var/lib/mongodb | cut -f1) * 3 / 2 )); free_kb=$(df -k --output=avail / | tail -1)
  [ $(( free_kb - need_kb )) -gt $(( 60 * 1024 * 1024 )) ] || fail "not enough disk for a one-pass restore: $(( free_kb / 1048576 )) GB free, needs $(( need_kb / 1048576 )) GB and 60 GB to spare"
fi
if [ -z "$SCOPE" ]; then
  last_full=$(python3 -c "import json;print(json.load(open('$STATE/last-full-restore-test.json'))['at'])" 2>/dev/null || echo 1970-01-01)
  if [ "$(date -u +%u)" = 7 ] || [ $(( $(date +%s) - $(date -d "$last_full" +%s) )) -gt $(( 8 * 86400 )) ]; then SCOPE=full; else SCOPE=rotate; fi
fi
log "scope: $SCOPE"
# EPHEMERAL: collections a restore leaves out and recreates empty. `presence` is the "readers here now"
# heartbeat (TTL of minutes) with a UNIQUE visitor_id that moves to a new _id when a visitor comes back; a
# logical backup dumps it fuzzily, so replaying the backup's oplog over the dump inserts an old _id whose
# visitor_id the dump already holds under a newer one, and the next update of that _id fails the whole
# restore (2026-11-16, first full test). The same holds for a real restore: see the README.
EPHEMERAL=${EPHEMERAL:-bookstore.presence}
# NOT_DUMPED: databases mongodump never writes, though the manifest counts them. `__mdb_internal_search` is
# mongot's own catalog (search index definitions and state); a real restore recreates the search indexes from
# manifests/search-defs-<name>.json beside the dump (README, Backups) and mongot rebuilds it (2026-11-17, third
# full test).
NOT_DUMPED=${NOT_DUMPED:-__mdb_internal_search}
python3 - "$CHUNK_GB" "$SCOPE" "${SMALL_GB:-1}" "$(date -u +%u)" "$EPHEMERAL" "$NOT_DUMPED" > "$RUN/chunks.txt" <<'EOF'
import json, sys
lim = float(sys.argv[1]) * 2**30
scope, small, dow = sys.argv[2], float(sys.argv[3]) * 2**30, int(sys.argv[4])
skip = set(x for x in sys.argv[5].split(',') if x)
skipdb = set(x for x in sys.argv[6].split(',') if x)
items = [x for x in json.load(open('/run/sl-restoretest/sizes.json')) if x[0] not in skip and x[0].split('.')[0] not in skipdb]
if scope != 'full':
    large = sorted(ns for ns, s in items if s >= small)
    pick = set(ns for k, ns in enumerate(large) if k % 7 == dow % 7)
    items = [x for x in items if x[1] < small or x[0] in pick]
items = sorted(items, key=lambda x: -x[1])
chunks, cur, tot = [], [], 0
for ns, s in items:
    if cur and tot + s > lim: chunks.append(cur); cur, tot = [], 0
    cur.append(ns); tot += s
if cur: chunks.append(cur)
for c in chunks: print(",".join(c))
EOF
[ $? = 0 ] || fail "chunk planning failed"
[ -s "$RUN/chunks.txt" ] || fail "chunk plan is empty: nothing would be restored"
log "$(wc -l < "$RUN/chunks.txt") chunks"
checked=0
echo "[]" > "$RUN/mismatches.json"
while read -r nslist; do
  if [ "$METHOD" = pbm ]; then
    pbmc restore "$name" --ns="$nslist" -y --wait > "$RUN/restore.log" 2>&1 || fail "pbm restore of [$nslist] failed: $(tail -2 "$RUN/restore.log" | tr '\n' ' ')"
  else
    # mongorestore --oplogReplay cannot be used here: on 9.0 its applyOps stops at the first update of a
    # document the fuzzy dump does not hold (updated, then deleted, while the dump ran; 2026-11-16, twice), and
    # it refuses namespace filters. So one download feeds archive-tee.py, which passes the archive to
    # mongorestore (no replay: filters allowed, production's users and EPHEMERAL left out) and writes the
    # captured oplog to a file; oplog-replay.mjs then replays it with initial-sync rules; EPHEMERAL is then
    # recreated empty with its indexes from the archive's prelude.
    excl=(--nsExclude 'admin.system.*'); for e in ${EPHEMERAL//,/ }; do excl+=(--nsExclude "$e"); done
    $S3 cp --only-show-errors "s3://$S3_BUCKET/fallback/$arch" - | gunzip \
      | python3 "$HERE/archive-tee.py" "$RUN/archive-meta.json" "$DIR/oplog.bson" 2> "$RUN/tee.log" \
      | mongorestore --config "$RUN/mongorestore.yaml" --archive --drop "${excl[@]}" --numParallelCollections=4 > "$RUN/restore.log" 2>&1
    st=("${PIPESTATUS[@]}")
    [ "${st[*]}" = "0 0 0 0" ] || fail "restore of $arch failed (exit s3 gunzip tee mongorestore: ${st[*]}): $(tail -c 200 "$RUN/tee.log") $(grep -v -i 'password\|uri' "$RUN/restore.log" | tail -2 | tr '\n' ' ')"
    log "restored: $(grep -a -o '[0-9]* document(s) restored successfully' "$RUN/restore.log" | tail -1); $(tail -1 "$RUN/tee.log")"
    (umask 077; sed -n 's/^uri: //p' "$RUN/mongorestore.yaml" > "$RUN/replay.uri")
    node "$HERE/oplog-replay.mjs" "$DIR/oplog.bson" "$RUN/replay.uri" "$EPHEMERAL" > "$RUN/replay.json" 2> "$RUN/replay.err" \
      || fail "oplog replay failed: $(tail -c 300 "$RUN/replay.err")"
    log "replay: $(cat "$RUN/replay.json")"
    META="$RUN/archive-meta.json" ONLY="$EPHEMERAL" EPHEMERAL="$EPHEMERAL" ADMIN_PW_FILE=$RUN/admin.pw sl_mongosh "load('$HERE/build-indexes.js')" $PORT > "$RUN/indexes.log" 2>&1 \
      || fail "recreating $EPHEMERAL failed: $(tail -c 300 "$RUN/indexes.log")"
  fi
  ADMIN_PW_FILE=$RUN/admin.pw sl_mongosh "const m=JSON.parse(fs.readFileSync('$M','utf8')); const bad=JSON.parse(fs.readFileSync('$RUN/mismatches.json','utf8')); let n=0;
    for (const ns of '$nslist'.split(',')) { const i = ns.indexOf('.'); const d = ns.slice(0, i), c = ns.slice(i + 1); const want = m.dbs[d][c];
      const coll = db.getSiblingDB(d).getCollection(c);
      if (!db.getSiblingDB(d).getCollectionNames().includes(c)) { bad.push({ns, want: want.n, got: 'missing'}); n++; continue; }
      const got = coll.countDocuments({}); const idx = coll.getIndexes().map(x => x.name).sort();
      // a fallback manifest is taken a moment after the dump's oplog ends: allow the inserts+deletes of that moment
      const tol = (m.hot && m.hot[ns]) || 0;
      if (Math.abs(got - want.n) > tol) bad.push({ns, want: want.n, got, tol});
      if (JSON.stringify(idx) !== JSON.stringify(want.indexes)) bad.push({ns, indexes_want: want.indexes, indexes_got: idx});
      coll.drop(); n++; }
    fs.writeFileSync('$RUN/mismatches.json', JSON.stringify(bad)); print(n);" $PORT > "$RUN/n.txt" || fail "count check failed on [$nslist]"
  checked=$(( checked + $(tail -1 "$RUN/n.txt") ))
  log "chunk ok so far: $checked collections checked"
done < "$RUN/chunks.txt"

nbad=$(python3 -c "import json;print(len(json.load(open('$RUN/mismatches.json'))))")
want=$(tr ',' '\n' < "$RUN/chunks.txt" | grep -c .)
total=$(python3 -c "import json;m=json.load(open('$M'));print(sum(len(c) for c in m['dbs'].values()))")
[ "$checked" -gt 0 ] && [ "$checked" -eq "$want" ] || fail "checked $checked of the $want collections chosen ($SCOPE) from $total in the manifest"
[ "$nbad" -eq 0 ] || fail "$nbad mismatches restoring $name: $(head -c 300 "$RUN/mismatches.json")"
finish true "restored $name ($SCOPE): $checked of $total collections, counts and index names equal to the manifest; left out as ephemeral: ${EPHEMERAL:-none}; not dumped: ${NOT_DUMPED:-none}"
[ "$SCOPE" = full ] && cp "$RESULT" "$STATE/last-full-restore-test.json"
log "PASS: $checked collections in $(( $(date +%s) - t0 )) s"
