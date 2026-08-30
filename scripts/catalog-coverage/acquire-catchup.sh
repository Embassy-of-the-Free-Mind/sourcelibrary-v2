#!/usr/bin/env bash
# Steady-state acquisition runner (#4225). Drains acquisition_queue in bounded batches
# until no pending work remains, then exits. Safe to fire from cron every 20 min —
# flock makes overlapping starts a no-op, and an empty queue costs one count query.
#
# This replaces the ephemeral /tmp/acquire_catchup.sh the old crontab pointed at
# (it vanished from /tmp, silently disabling steady-state acquisition).
#
# Suggested crontab (Hetzner):
#   */20 * * * * /root/sourcelibrary/scripts/catalog-coverage/acquire-catchup.sh >> /var/log/sourcelibrary/acquire.log 2>&1
set -u
cd "$(dirname "$0")/../.." || exit 1
set -a; source .env.production.local; set +a

exec 9>/tmp/sl-acquire.lock
flock -n 9 || exit 0

pending() {
  node -e 'const {MongoClient}=require("mongodb");(async()=>{const c=new MongoClient(process.env.MONGODB_URI);await c.connect();console.log(await c.db("bookstore").collection("acquisition_queue").countDocuments({status:"pending"}));await c.close();})().catch(()=>console.log(""))'
}

while :; do
  P=$(pending)
  [ -n "$P" ] || { echo "$(date -u +%FT%TZ) pending-count failed, stopping"; exit 1; }
  [ "$P" -gt 0 ] || break
  echo "$(date -u +%FT%TZ) pending $P — running batch"
  node scripts/catalog-coverage/acquire-gap-batch.mjs --batch 200 --concurrency 10 || sleep 60
done
echo "$(date -u +%FT%TZ) queue drained"
