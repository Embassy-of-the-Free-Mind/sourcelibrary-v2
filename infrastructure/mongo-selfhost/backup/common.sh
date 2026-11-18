#!/bin/bash
# Shared helpers for the self-hosted MongoDB backup scripts (#346). Sourced, not run.
# PRIOR ART: scripts/maintenance/backup-*.sh (mongodump into restic, read back) — they back up Atlas from
# main; these back up the self-hosted replica set to object storage off Hetzner, so they share no code.
#
# Secrets never appear in argv or output: passwords are read from mode-600 files under /etc/sl-mongo,
# mongosh reads them itself (sl_mongosh), PBM reads its URI from /etc/default/pbm-agent.
set -uo pipefail
NTFY=${NTFY:-https://ntfy.sh/sourcelibrary-uptime}
STATE=/var/lib/sl-backup
mkdir -p "$STATE"
# A caller that already points PBM at another cluster (restore-test.sh -> pbm-setup.sh, the scratch cluster)
# keeps it: re-reading /etc/default/pbm-agent here once sent the scratch config to the production set and
# switched its PITR off (2026-11-16).
_pbm_uri_keep=${PBM_MONGODB_URI:-}
set -a; . /etc/sl-mongo/s3.env; . /etc/default/pbm-agent; set +a
[ -n "$_pbm_uri_keep" ] && PBM_MONGODB_URI=$_pbm_uri_keep
# Scaleway allows 1,000 parts per multipart upload; the aws CLI sizes parts for 10,000, so a streamed upload
# (fallback dump, ~30 GB) would stop at part 1,001. 128 MB parts cap one object at ~128 GB.
export AWS_CONFIG_FILE=$STATE/aws-cli.config
printf '[default]\ns3 =\n  multipart_chunksize = 128MB\n  max_concurrent_requests = 4\n' > "$AWS_CONFIG_FILE"
S3="aws --endpoint-url $S3_ENDPOINT s3"
S3API="aws --endpoint-url $S3_ENDPOINT s3api"
HOST=$(hostname -s)

log() { echo "[$(date -u +%FT%TZ)] $*"; }
page() { # page <priority 1-5> <title> <body>
  curl -s -m 20 -H "Title: $HOST: $2" -H "Priority: $1" -H "Tags: floppy_disk" -d "$3 (v3 #346; infrastructure/mongo-selfhost/README.md)" "$NTFY" >/dev/null || true; }
# PBM reads PBM_MONGODB_URI from the environment; never pass it as --mongodb-uri (ps shows argv: the stage 0 leak)
pbmc() { pbm "$@"; }
# mongosh as admin against a port (default 27017), JS in $1; the password is read inside mongosh
sl_mongosh() { local js=$1 port=${2:-27017}
  mongosh --quiet "mongodb://127.0.0.1:$port/?directConnection=true" \
    --eval "db.getSiblingDB('admin').auth('admin', fs.readFileSync('${ADMIN_PW_FILE:-/etc/sl-mongo/admin.pw}','utf8').trim()); void 0" --eval "$js"; }
