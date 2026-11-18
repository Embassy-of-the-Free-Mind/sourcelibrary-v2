#!/bin/bash
# Point-in-time restore (#346): the state of the whole set at UNTIL, from the off-site copy only.
#   UNTIL=2026-11-17T10:57:00Z [PORT=27217] [DIR=/var/lib/sl-pitr] [CHECK=file.js] [KEEP=1] pitr-restore.sh
# Base: the newest fallback dump (mongodump --oplog, daily) whose oplog ends before UNTIL, restored as the restore
# test does (archive-tee.py | mongorestore, then oplog-replay.mjs over the dump's own oplog). Then PBM's 1-minute
# oplog slices (pbmPitr/) from the dump's last entry up to UNTIL are downloaded, checked for continuity, and
# replayed with the same initial-sync rules (AFTER_TS < ts <= UNTIL_TS). The result is a running scratch mongod
# on 127.0.0.1:PORT (its own keyfile; production's users, so the admin password is the set's) that holds the set
# as it was at UNTIL; KEEP=0 tears it down after CHECK. Search indexes are not restored (README, Backups).
#
# Why not `pbm restore --time`: PBM 2.17 cannot restore its own 9.0 backups (README); its slices, though, are
# plain BSON oplog entries (zstd), and replaying them over the fallback dump is exactly what PBM would do.
# PRIOR ART: restore-test.sh (same scratch set and restore pipeline, but it stops at the dump's end and compares
# with the manifest); stage 0's pitr-fallback.sh on sl-web-1 replayed a dump's oplog only, to the dump's end.
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
: "${UNTIL:?UNTIL=<UTC time to restore to> is required}"
PORT=${PORT:-27217}; DIR=${DIR:-/var/lib/sl-pitr}; RUN=/run/sl-pitr; KEEP=${KEEP:-1}
EPHEMERAL=${EPHEMERAL:-bookstore.presence}
until_s=$(date -u -d "$UNTIL" +%s) || exit 64
t0=$(date +%s)
fail() { log "FAILED: $*"; exit 1; }
teardown() {
  mongosh --quiet "mongodb://127.0.0.1:$PORT/?directConnection=true" --eval "db.getSiblingDB('admin').auth('admin', fs.readFileSync('$RUN/admin.pw','utf8').trim()); db.adminCommand({shutdown:1, force:true})" >/dev/null 2>&1
  sleep 3; pkill -f "[m]ongod --config $RUN/mongod.conf" 2>/dev/null; rm -rf "$DIR"; }
[ "$KEEP" = 1 ] || trap teardown EXIT
[ "$PORT" != 27017 ] || fail "PORT 27017 is the live member; a restore goes to a scratch port"

# 1. base: the newest dump whose manifest point (a second after its oplog ends) is before UNTIL
mkdir -p "$RUN"; chown root:mongodb "$RUN"; chmod 750 "$RUN"
arch=""
for a in $($S3 ls "s3://$S3_BUCKET/fallback/" | awk '{print $4}' | grep '\.archive\.gz$' | sort -r); do
  n=${a%.archive.gz}
  $S3 cp --only-show-errors "s3://$S3_BUCKET/manifests/fallback-$n.json" "$RUN/manifest.json" 2>/dev/null || continue
  et=$(python3 -c "import json;print(json.load(open('$RUN/manifest.json'))['last_write_ts']['t'])")
  [ "$et" -lt "$until_s" ] && { arch=$a; name=$n; break; }
done
[ -n "$arch" ] || fail "no fallback dump ends before $UNTIL"
log "base: fallback $name (ends $(date -u -d @"$et" +%FT%TZ)); target $UNTIL"
# the slices must reach UNTIL before we download 40 GB
last_slice=$($S3 ls "s3://$S3_BUCKET/pbm/pbmPitr/rs0/$(date -u -d "$UNTIL" +%Y%m%d)/" | awk '{print $4}' | sort | tail -1)
last_end=$(echo "$last_slice" | sed -E 's/^[0-9]+-[0-9]+\.([0-9]{8})([0-9]{2})([0-9]{2})([0-9]{2})-[0-9]+\.oplog.*/\1 \2:\3:\4/')
[ -n "$last_slice" ] && [ "$(date -u -d "$last_end" +%s)" -ge "$until_s" ] || fail "PBM oplog slices do not reach $UNTIL yet (newest: ${last_slice:-none})"

# 2. scratch set, as restore-test.sh builds it (loopback, own keyfile, TTL monitor off)
pkill -f "[m]ongod --config $RUN/mongod.conf" 2>/dev/null; rm -rf "$DIR"; mkdir -p "$DIR/db" "$DIR/slices"; chown -R mongodb: "$DIR"
(umask 077; openssl rand -base64 756 > "$RUN/keyfile"; tr -d '\n' < /etc/sl-mongo/admin.pw > "$RUN/admin.pw")
chown mongodb: "$RUN/keyfile"; chmod 400 "$RUN/keyfile"
cat > "$RUN/mongod.conf" <<EOF
storage: { dbPath: $DIR/db, wiredTiger: { engineConfig: { cacheSizeGB: ${CACHE_GB:-4} }, collectionConfig: { blockCompressor: zstd } } }
systemLog: { destination: file, path: $DIR/mongod.log }
net: { port: $PORT, bindIp: 127.0.0.1 }
replication: { replSetName: rs0pitr, oplogSizeMB: 2048 }
security: { authorization: enabled, keyFile: $RUN/keyfile }
processManagement: { fork: true, timeZoneInfo: /usr/share/zoneinfo }
setParameter: { ttlMonitorEnabled: false }
EOF
sudo -u mongodb mongod --config "$RUN/mongod.conf" >/dev/null || fail "scratch mongod did not start: $(tail -c 300 "$DIR/mongod.log")"
mongosh --quiet "mongodb://127.0.0.1:$PORT/?directConnection=true" --eval "rs.initiate({_id:'rs0pitr',members:[{_id:0,host:'127.0.0.1:$PORT'}]}); while(!db.hello().isWritablePrimary) sleep(500); db.getSiblingDB('admin').createUser({user:'admin',pwd:fs.readFileSync('$RUN/admin.pw','utf8').trim(),roles:['root']}); void 0" >/dev/null || fail "scratch init failed"
(umask 077; printf 'mongodb://__system:%s@127.0.0.1:%s/?authSource=local&directConnection=true\n' \
  "$(python3 -c "import sys,urllib.parse;print(urllib.parse.quote(''.join(open(sys.argv[1]).read().split()),safe=''))" "$RUN/keyfile")" "$PORT" > "$RUN/replay.uri"
 printf 'uri: %s\n' "$(cat "$RUN/replay.uri")" > "$RUN/mongorestore.yaml")

# 3. the dump, then its own oplog
excl=(--nsExclude 'admin.system.*'); for e in ${EPHEMERAL//,/ }; do excl+=(--nsExclude "$e"); done
$S3 cp --only-show-errors "s3://$S3_BUCKET/fallback/$arch" - | gunzip \
  | python3 "$HERE/archive-tee.py" "$RUN/archive-meta.json" "$DIR/oplog.bson" 2> "$RUN/tee.log" \
  | mongorestore --config "$RUN/mongorestore.yaml" --archive --drop "${excl[@]}" --numParallelCollections=4 > "$RUN/restore.log" 2>&1
st=("${PIPESTATUS[@]}"); [ "${st[*]}" = "0 0 0 0" ] || fail "restore of $arch failed (s3 gunzip tee mongorestore: ${st[*]}): $(grep -v -i 'password\|uri' "$RUN/restore.log" | tail -2 | tr '\n' ' ')"
log "restored: $(grep -a -o '[0-9]* document(s) restored successfully' "$RUN/restore.log" | tail -1)"
node "$HERE/oplog-replay.mjs" "$DIR/oplog.bson" "$RUN/replay.uri" "$EPHEMERAL" > "$RUN/replay-dump.json" 2> "$RUN/replay.err" || fail "dump oplog replay failed: $(tail -c 300 "$RUN/replay.err")"
log "dump oplog: $(cat "$RUN/replay-dump.json")"
dump_last=$(python3 -c "import json;print(json.load(open('$RUN/replay-dump.json'))['last'] or '')")
[ -n "$dump_last" ] || fail "could not read the dump oplog's last timestamp"

# 4. PBM slices covering (dump_last, UNTIL], in order and without a hole
python3 - "$dump_last" "$until_s" > "$RUN/slices.txt" <<EOF || fail "slice listing failed"
import subprocess, sys, re, datetime
last_t = int(sys.argv[1].split(':')[0]); until = int(sys.argv[2])
def epoch(s): return int(datetime.datetime.strptime(s, '%Y%m%d%H%M%S').replace(tzinfo=datetime.timezone.utc).timestamp())
keys = []
d = datetime.datetime.fromtimestamp(last_t, datetime.timezone.utc).date()
while d <= datetime.datetime.fromtimestamp(until, datetime.timezone.utc).date():
    out = subprocess.run("$S3 ls s3://$S3_BUCKET/pbm/pbmPitr/rs0/%s/" % d.strftime('%Y%m%d'), shell=True, capture_output=True, text=True).stdout
    for line in out.splitlines():
        k = line.split()[-1]
        m = re.match(r'(\d{14})-(\d+)\.(\d{14})-(\d+)\.oplog', k)
        if m: keys.append((epoch(m.group(1)), int(m.group(2)), epoch(m.group(3)), int(m.group(4)), d.strftime('%Y%m%d') + '/' + k))
    d += datetime.timedelta(days=1)
keys.sort()
pick = [k for k in keys if k[2] >= last_t and k[0] <= until]
if not pick or pick[0][0] > last_t: sys.exit('no slice covers the dump end')
for a, b in zip(pick, pick[1:]):
    if (b[0], b[1]) != (a[2], a[3]): sys.exit('hole in the slices between %s and %s' % (a[4], b[4]))
if pick[-1][2] < until: sys.exit('slices end before UNTIL')
for k in pick: print(k[4])
EOF
log "$(wc -l < "$RUN/slices.txt") PBM slices from $(head -1 "$RUN/slices.txt") to $(tail -1 "$RUN/slices.txt")"
: > "$DIR/slices.bson"
while read -r k; do
  case "$k" in *.zst) dec="zstd -dc" ;; *.gz) dec="gunzip -c" ;; *.snappy|*.s2|*.lz4) fail "slice compression of $k not handled" ;; *) dec=cat ;; esac
  $S3 cp --only-show-errors "s3://$S3_BUCKET/pbm/pbmPitr/rs0/$k" - | $dec >> "$DIR/slices.bson" || fail "slice $k"
done < "$RUN/slices.txt"
AFTER_TS=$dump_last UNTIL_TS="$until_s:4294967295" node "$HERE/oplog-replay.mjs" "$DIR/slices.bson" "$RUN/replay.uri" "$EPHEMERAL" > "$RUN/replay-pitr.json" 2>> "$RUN/replay.err" \
  || fail "slice replay failed: $(tail -c 300 "$RUN/replay.err")"
log "slices: $(cat "$RUN/replay-pitr.json")"
META="$RUN/archive-meta.json" ONLY="$EPHEMERAL" EPHEMERAL="$EPHEMERAL" ADMIN_PW_FILE=$RUN/admin.pw sl_mongosh "load('$HERE/build-indexes.js')" "$PORT" > "$RUN/indexes.log" 2>&1 \
  || fail "recreating $EPHEMERAL failed: $(tail -c 300 "$RUN/indexes.log")"
log "restored to $UNTIL in $(( $(date +%s) - t0 )) s; scratch set on 127.0.0.1:$PORT (admin = the set's admin password)"
[ -n "${CHECK:-}" ] && { ADMIN_PW_FILE=$RUN/admin.pw sl_mongosh "load('$CHECK')" "$PORT" || fail "CHECK $CHECK failed"; }
exit 0
