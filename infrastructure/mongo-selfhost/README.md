# Self-hosted MongoDB (v3 #346, stage 1)

The database production will move to from Atlas: MongoDB Community **9.0.7** (the version Atlas runs) as a
replica set on Hetzner, with MongoDB's search engine (`mongot`) for the four Atlas Search indexes, a
**follower** that keeps it level with Atlas until cutover, a daily dump and Percona backups off Hetzner with a twice-weekly
restore test, and alarms on ntfy. Nothing here writes to Atlas; the cutover (stage 2) has its own go.

No addresses, connection strings or secrets live in this directory. Every script reads them from files on
the box (below). Boxes are named, never addressed.

## What runs where

Replica set `rs0`, three members since 2026-11-17 (part 2 of stage 1):

| Member | Location | Role |
|---|---|---|
| `sl-db-2` (cax41) | Falkenstein | voting, priority 2: the primary when healthy |
| `sl-db-3` (cax41) | Falkenstein | voting, priority 1 |
| `sl-db-1` (cax41) | Helsinki | **hidden**, priority 0, voting: the off-location copy. Backups, the follower and the restore test run here |

A member in a different location from the other two is hidden and never primary: clients would otherwise
pay the 36 ms Helsinki–Falkenstein round trip on every write. It still votes, so losing one Falkenstein box
leaves two of three votes and a primary. Losing Falkenstein as a whole leaves no primary; `sl-db-1` then
holds a current copy and can be forced primary by hand (`rs.reconfig(cfg, {force: true})`).

| Box | What | Unit |
|---|---|---|
| `sl-db-1` (cax41, Helsinki, Ubuntu 24.04 arm64) | `mongod`, member of `rs0` | `mongod.service` |
| | `mongot` 1.70.6 community (search) | `mongot.service` |
| | Percona Backup for MongoDB 2.17.0 agent | `pbm-agent.service` (+ `pbm-agent.override.conf`) |
| | follower, half 1: Atlas change stream → journal | `sl-follower-record.service` |
| | follower, half 2: journal → local `bookstore` | `sl-follower-apply.service` |
| | alarms, every 5 min | `sl-alarms.timer` |
| | daily backup 01:00 UTC, restore test Wed+Sun 03:30 UTC, fallback dump 22:30 UTC | `sl-backup-daily.timer`, `sl-restore-test.timer`, `sl-backup-fallback.timer` |
| `sl-db-2`, `sl-db-3` | `mongod`, `mongot`, `pbm-agent` (each pinned to its own member), alarms | built by `install-member.sh` |

Listeners: `mongod` on 127.0.0.1 and the private-network address only; `mongot` (gRPC 27028, health 8080,
metrics 9946) and the restore-test scratch `mongod` (27217) on 127.0.0.1 only. The Hetzner firewall lets in
ssh from main and cloudlayer and nothing else; do not change it.

### Files on the box

| Path | What |
|---|---|
| `/etc/mongod.conf` | from `conf/mongod.conf` (`${PRIVATE_IP}` filled in) |
| `/etc/mongod.keyfile` | replica-set keyfile (400, mongodb). Copy it to a new member before it joins |
| `/etc/sl-mongo/{admin,app,follower,mongot,monitor,pbm}.pw` | one password per user, generated on the box (`openssl rand -hex 24`), mode 600 |
| `/etc/sl-mongo/atlas.uri` | Atlas connection string for the follower (640 root:slfollow) |
| `/etc/sl-mongo/s3.env` | backup bucket key (Scaleway, scoped to its own project) and bucket name |
| `/etc/sl-mongo/mongorestore.yaml` | admin URI for mongorestore (600) |
| `/etc/default/pbm-agent` | `PBM_MONGODB_URI` for the agent and the `pbm` CLI (600) |
| `/etc/mongot/config.yml`, `/etc/mongot/secrets/passwordFile` | from `conf/mongot-config.yml` |
| `/usr/local/sbin/sl-mongosh` | mongosh as admin; reads the password inside mongosh |
| `/opt/sl-follower/` | `follower/*.mjs` + `npm install` (mongodb driver 6.21.0) |
| `/opt/sl-mongo/{backup,alarms}/` | `backup/*`, `alarms/*` |
| `/var/lib/sl-follower/` | journal, `apply-state.json`, `lag-YYYY-MM-DD.ndjson`, `alerts.ndjson`, `repair/` |
| `/var/lib/sl-backup/` | `last-backup.json`, `manifest-<backup>.json`, `restore-test.json`, `last-fallback.json` |

**Long commands over ssh**: a plain `ssh box 'nohup … &'` hangs holding the session open. Detach fully:
`timeout 15 ssh -n box '(setsid nohup bash -c "…; echo \$? > /var/tmp/x.exit" >/var/tmp/x.log 2>&1 </dev/null &)'`.
`pkill -f`/`pgrep -f` inside an ssh command match that command itself; use a `[b]racket` pattern.
`pbm` on the box needs its environment first: `set -a; . /etc/default/pbm-agent; set +a`.

**Never print a password.** Read config with the secret lines masked, e.g.
`sed -E 's#(://[^:]*:)[^@]*@#\1***@#' /etc/default/pbm-agent`. `pbm` reads `PBM_MONGODB_URI` from the
environment; never pass `--mongodb-uri` (argv shows in `ps`). Stage 0 leaked two passwords by reading config
files whole.

### Users

| User | Roles | Used by |
|---|---|---|
| `admin` | root | humans, restores |
| `follower` | readWrite + dbAdmin on `bookstore`, read `local`, clusterMonitor | the follower, `sync-tools.mjs` |
| `mongot` | searchCoordinator | mongot |
| `pbm` | PBM's documented set incl. `pbmAnyAction` | pbm-agent, backup scripts |
| `monitor` | clusterMonitor, read `local` and `bookstore` | alarms |
| `app` | readWrite on `bookstore` | the app, at cutover |

## Build a box (what was done on `sl-db-1`, 2026-11-16)

1. **Packages** (MongoDB's own arm64 repo for noble; hold the version Atlas runs, even when a newer 9.0.x exists):
   ```bash
   curl -fsSL https://pgp.mongodb.com/server-9.asc | gpg --batch --yes -o /usr/share/keyrings/mongodb-server-9.gpg --dearmor
   echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-9.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/9.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-9.0.list
   apt-get update; V=9.0.7
   apt-get install -y mongodb-org=$V mongodb-org-server=$V mongodb-org-mongos=$V mongodb-org-database=$V mongodb-org-tools=$V mongodb-org-shell=$V mongodb-org-database-tools-extra=$V mongodb-mongosh mongodb-database-tools
   apt-mark hold mongodb-org mongodb-org-server mongodb-org-mongos mongodb-org-database mongodb-org-tools mongodb-org-shell
   ```
   Trap: `apt-cache policy … | head` under `set -o pipefail` kills the script (SIGPIPE).
2. **Replica set**: keyfile; passwords into `/etc/sl-mongo/*.pw`; start once without `security:`;
   `rs.initiate({_id:'rs0', members:[{_id:0, host:'<private address>:27017'}]})` (the private address, so
   later members can reach it); create `admin`; add `security:` and restart. Then the other users.
   `blockCompressor: zstd` saves disk against Atlas's snappy; `cacheSizeGB: 12` leaves room for mongot's
   6 GB heap and the restore-test scratch instance.
3. **mongot**: the community tarball (`mongot_community_1.70.6_linux_aarch64.tgz`), signature checked against
   MongoDB's Atlas Search key (`https://pgp.mongodb.com/atlas-search.asc`, fingerprint
   `55C5 8636 FD6C EE2B 789B 6F49 516C 2412 904B 6C26`), unpacked to `/opt/mongot-1.70.6`, symlink `/opt/mongot`,
   system user `mongot`, `systemd/mongot.service`.
4. **PBM**: `percona-backup-mongodb_2.17.0-1.noble_arm64.deb` from `repo.percona.com`, SHA-256 checked against
   the repo's `Packages` index; `/etc/default/pbm-agent`; `systemd/pbm-agent.override.conf` (the package's unit
   names user `mongod`, which Ubuntu's MongoDB package does not create; ours is `mongodb`).
5. **Reboot once before loading data** and check `systemctl is-active mongod mongot pbm-agent`.
   (`sl-db-1`: all three came back by themselves, 2026-11-16 09:06.)
6. **Node 22** (NodeSource) and the follower in `/opt/sl-follower`; system user `slfollow`; the two follower units.
7. `conf/logrotate-sl-mongo` → `/etc/logrotate.d/sl-mongo`.

## Initial load

From our restic backups on main, streamed over ssh into `mongorestore` on the box, one stream at a time,
nothing unpacked on main (`nice -n 19 ionice -c3`), **all collections** (personal data included; this is the
production copy). Order: daily `books` snapshot, Monday "everything else" archive (excluding the collections
that have their own snapshot), then the Sunday corpus-text archives (`first_translation_attempts`,
`gallery_images`, `entities`, `chapter_texts`, `page_revisions`, `pages`). The stage 0 driver
(sl-web-1:`/root/stage0/RUNBOOK.md`) is the template; use the newest snapshot of each tag.
Trap: restic under systemd has no `$HOME`; set `XDG_CACHE_HOME` or it runs without a cache.

## The follower

`mongosync` cannot be used: its licence covers migrating *into* Atlas and syncing between Atlas clusters,
and a self-managed destination must be Enterprise. So the follower is ours, in two halves joined by a journal
on disk:

- **`record.mjs`** holds the **one** change stream on Atlas's `bookstore` (whole database,
  `showExpandedEvents`, zlib wire compression) and appends one line per event: cluster time, operation,
  collection, `_id`, and for DDL the operation description. It never carries documents or update
  descriptions. The resume token is saved only after the events it covers are on disk.
- **`apply.mjs`** reads the journal in order. Data events between two DDL events fold into "sync these
  `_id`s"; for each it reads the **current** document from Atlas by `_id` (secondaryPreferred, causally after
  the newest event in the batch, at most 4 reads at once) and replaces the local copy, or deletes it if
  Atlas no longer has it. Replaying any stretch twice, or from before a dump was taken, converges. DDL is
  applied in order: `create` (views and capped collections included), `createIndexes`/`dropIndexes`
  (TTL included), `modify` (collMod, e.g. a TTL change), `rename` (pending ids follow the new name), `drop`.
  It **pages and stops** on `dropDatabase`, `invalidate`, a rename out of `bookstore` or an event type it
  does not know; it **pages and goes on** for Atlas Search index changes (mirror them on mongot by hand)
  and sharding events. A unique-key conflict (two documents swapping a key) is resolved by rewriting the
  stale local holder from Atlas.
- Tests: `tests/mongo-selfhost-follower.test.ts` (event planning) and `follower/e2e-test.sh` (the real
  recorder and applier between two scratch servers on the box: inserts, updates, deletes, replace, index
  create/drop, TTL change, capped create, rename, drop, a view, and a key swap; prints `E2E PASS`).

Operate:
```bash
systemctl status sl-follower-record sl-follower-apply
tail -5 /var/log/sl-follower/apply.log
jq '{applied_through, behind_s, last_batch_lag}' /var/lib/sl-follower/apply-state.json
jq '{last_event_t, heartbeat, gaps}' /var/lib/sl-follower/journal/recorder-state.json
```
Lag (event cluster time → applied) is logged per batch in `lag-YYYY-MM-DD.ndjson` with a sample of
per-event lags.

**Gap.** If Atlas's oplog rolls past the saved token (follower down longer than the oplog window, about
24 h on 2026-11-16), the recorder records `gap_open` and exits 3; the unit stays down and the alarm pages.
Recover: start a fresh stream (`START_AT` inside the window, state file moved aside), then queue the gap's
documents with `sync-tools.mjs gap-repair --since <gap start>` and confirm with `sync-tools.mjs verify`.
The same tool closed the gap of the initial load (Sunday corpus dumps start before the oldest point the
oplog still held).

**Applier stopped on an event** (`stopped_reason` in `apply-state.json`, exit 2): read the reason in
`alerts.ndjson`, act by hand, clear `stopped_reason`, start the unit.

**Convergence check**: `cd /opt/sl-follower && node sync-tools.mjs verify --out /var/lib/sl-follower/verify-<date>.json`
compares, for every collection: options, counts, index lists (TTL options included), and a field-for-field
sample (1,000 random documents; every document under 10,000), re-checking differences after 90 s so lag
is told apart from a bug.

**Whole-collection check** (`sync-tools.mjs hash-diff <coll>… [--dry-run]`): every document on both sides
is reduced server-side to `{_id, $toHashedIndexKey($$ROOT)}`, in `_id` ranges, so only ids and 8-byte hashes
cross the wire (all 36.2M `pages`: about 0.8 GB from Atlas, ~30 min). Differing ids are queued for the
applier. Use it when a sample finds a difference that lag does not explain: the initial load's gap repair
can only find documents through an indexed timestamp, and a field changed without one (on 2026-11-15,
`pages.read_count` and image upgrades) is invisible to it.

Traps met building it:
- **Never filter `_id` by type on Atlas** (`{_id: {$not: {$type: 'objectId'}}}`): the planner cannot bound
  it and FETCHes every document. On `pages` it ran 17 min on the Atlas secondary before it was killed. The
  tools bound each id type by range instead (`$gte`/`$lt` of the type's min and max).
- Atlas's timestamp indexes are descending; a `hint` must name them as they are (`{updated_at: -1}`).
- The applier's batch of ids is sliced (2,000 at a time): one 20,000-id `chapter_texts` batch ran the
  2 GB heap out, and the OOM'd process stayed systemd-`active`. The alarm watches the heartbeat, not the unit.

## Search

Four indexes from the Atlas definitions (`$listSearchIndexes` → `latestDefinition`), created with
`createSearchIndex` against the local `mongod` once the data is loaded; `pages_search` takes about 40 min.
The definitions are in `/opt/mongot-dl/search-defs-local.json` on the box. After they are READY,
`touch /var/lib/sl-alarms/search-expected` arms the not-READY alarm. A search index changed on Atlas is not
mirrored automatically: the follower pages, and the index is updated here by hand.

## Backups

- **Daily** (`backup/backup-daily.sh`): `pbm backup` (logical, zstd level 9) to a private bucket at
  Scaleway (Amsterdam, `ONEZONE_IA`, own project, a key that can touch that project only). Right after, it
  counts every collection **at the backup's own consistency point** (snapshot read at `last_write_ts`) into
  `manifests/<backup>.json` beside the backup. Retention: newest 7 plus the newest of each of the last 4 ISO
  weeks; oplog slices older than the oldest kept backup go with it.
- **Point in time**: PITR (1-minute oplog slices) is switched on after the first full backup.
  Restore to a time: `pbm config --set pitr.enabled=false`, then
  `pbm restore -y --time=<UTC> [--ns=db.coll] --wait` (`-y` is required without a tty).
- **Restoring the fallback dump: do NOT use `mongorestore --oplogReplay`.** On 9.0 its `applyOps` stops at the
  first update of a document the dump does not hold, and a fuzzy dump always has some: a document updated and
  then deleted while the dump ran is missing from the dump, and its delete comes later in the same oplog
  (`Update of non-mod failed`; the first two full restore tests, 2026-11-16, after all 107.69M documents were
  in). `oplogApplicationMode: "InitialSync"` does not help. It also refuses `--nsInclude`/`--nsExclude`. Instead,
  as `restore-test.sh` does, in one download:
  ```
  aws s3 cp s3://$S3_BUCKET/fallback/<name>.archive.gz - | gunzip \
    | python3 backup/archive-tee.py meta.json oplog.bson \
    | mongorestore --config <yaml> --archive --drop --nsExclude 'admin.system.*' --nsExclude bookstore.presence
  node backup/oplog-replay.mjs oplog.bson <uri-file> bookstore.presence
  META=meta.json ONLY=bookstore.presence EPHEMERAL=bookstore.presence mongosh ... backup/build-indexes.js
  ```
  `archive-tee.py` passes the archive through and writes its prelude (each collection's options and indexes)
  and its captured oplog to files. `oplog-replay.mjs` replays that oplog with initial-sync rules: an update of a
  missing document is skipped (counted as `missing`), inserts replace, two-phase index builds become one
  `createIndexes`; anything else that fails stops it. Sign in as `__system` with the target's keyfile
  (`authSource=local`); with production's users left out (`admin.system.*`), recreate the users you need.
- **The dump holds no search indexes.** `mongodump` does not write `__mdb_internal_search` (mongot's catalog of
  index definitions and state), though the manifest counts it; the restore test leaves it out of the comparison
  (`NOT_DUMPED`). The definitions are saved beside each dump as `manifests/search-defs-<name>.json`
  (`$listSearchIndexes` → `latestDefinition`); after a restore, `createSearchIndex` each one and wait for READY
  (see Search; `pages_search` takes about 40 min).
- **`bookstore.presence` is left out and recreated empty** (`build-indexes.js` with `ONLY`). It is the "readers
  here now" heartbeat (TTL of minutes) with a unique `visitor_id` that moves to a new `_id` when a visitor
  returns, so a fuzzy dump plus replay cannot satisfy its unique index. It refills within minutes. For the PBM
  path, pass `--ns` with every other namespace from the manifest (PBM has no exclude flag).
- **Daily fallback** (`backup/fallback-dump.sh`, 22:30 UTC): a `mongodump --oplog --gzip --archive` of the
  whole set, streamed to the bucket (`fallback/<name>.archive.gz`, newest 7 kept), with its own count manifest
  (`manifests/fallback-<name>.json`, taken at the cluster time `mongodump` exited; `hot` records the inserts
  and deletes of the 60 s before it, the most a restored count may differ by).
- **PBM cannot restore its own backup on 9.0 (2026-11-16).** Three restores of backup
  `2026-11-16T13:21:59Z` stopped in oplog replay with `Update of non-mod failed` (scratch `mongod` log), each
  time on an update of a document whose insert *is* in the backup's oplog (checked in the bucket) but was not
  applied: the agent log shows replay starting from a chunk well after the backup's `first_write_ts`. PBM 2.17
  does not list 9.0 as supported. So the **fallback dump is the backup of record** and the restore test
  (Wed and Sun) restores it; PBM keeps running (daily base + PITR slices) and can be tested by hand with
  `METHOD=pbm restore-test.sh`, until a PBM release supports 9.0. Do not rely on a PBM point-in-time restore.
- **Restore test** (Wed and Sun 03:30 UTC; `backup/restore-test.sh`, `METHOD=fallback` by default): restores the
  newest fallback dump into a scratch `mongod` (127.0.0.1:27217, its own `rs0`, which PBM needs; TTL monitor off
  so aged rows are not deleted under the check) by the procedure above, in one pass (the whole ~40 GB archive is
  downloaded: why it runs twice a week, not nightly), compares every collection's count (within the manifest's
  `hot` tolerance) and index names with the manifest, and pages on any difference or when the newest backup is
  over 26 h old. `METHOD=pbm` restores in chunks of at most 15 GB, by default a rotating seventh of the large
  collections a night (`SCOPE=full|rotate`). On failure the scratch `mongod` and agent logs are kept as
  `/var/lib/sl-backup/restore-test-failed-*.log`. Result: `/var/lib/sl-backup/restore-test.json` and
  `restore-tests/<date>.json` in the bucket.

## Alarms

`alarms/check.sh` every 5 minutes, to `https://ntfy.sh/sourcelibrary-uptime`; each condition pages when it
starts, every 6 h while it lasts, and when it clears.

| Name | Fires when |
|---|---|
| `mongod-down` | `mongod` does not answer a ping |
| `member-down` | a member is not PRIMARY/SECONDARY/STARTUP2, or the set has no primary (reported by the primary only, so once) |
| `member-behind` | a secondary is more than 5 min behind the primary |
| `follower-stopped` | a follower unit is not active, or a heartbeat is over 3 min old |
| `follower-behind` | the applier is more than 5 min behind the journal |
| `follower-gap` | oplog history lost, or the applier stopped on an event |
| `disk-75` | `/` over 75 % |
| `oplog-window` | the local oplog covers under 24 h (not checked in the set's first 25 h) |
| `backup-old` | newest PBM backup or newest fallback dump over 26 h old |
| `restore-test-failed` | the last restore test failed |
| `mongot-down` | mongot health is not SERVING |
| `search-not-ready` | one of the four search indexes is not READY. The status is the set's: it fires on every member while any one member's `mongot` builds (queries on the others still work) |

Fire one on purpose: `ALARM_TEST=<name> /opt/sl-mongo/alarms/check.sh` (it pages, then pages "cleared").
The same script runs on every member; the follower checks run only where `sl-follower-apply.service` is
installed and the backup checks only where `sl-backup-fallback.timer` is enabled.

## Joining members

`install-member.sh` builds a member box the way `sl-db-1` was built (packages held at 9.0.7, `mongod.conf`
with the box's private address, `mongot` and `pbm-agent` installed but not started, the needrestart rule).
Copy the keyfile and the four password files first (its header lists them; stream them over ssh, never print
them). Then, from the primary:

```js
rs.add({host: '<private address>:27017', votes: 0, priority: 0})   // non-voting while it syncs
```

A syncing member must not count toward the majority, and a two-voter set loses its primary when either box
drops, so add members non-voting and give them votes only when there are three. Initial sync copies
everything from the set (nothing is read from Atlas): `sl-db-2` took 36 min 15 s for 204.6 GB and
`sl-db-3` 30 min 7 s on 2026-11-17. Watch it with `db.adminCommand({replSetGetStatus: 1, initialSync: 1}).initialSyncStatus`.
When it is SECONDARY: `systemctl enable --now mongot pbm-agent` (mongot builds the four search indexes from
its own member; `pages_search` takes about 40 min) and `alarms/check.sh` on its timer. Then reconfigure votes
and priorities (table at the top).

Votes go to one member per `rs.reconfig` (MongoDB refuses more). Giving `sl-db-2` priority 2 makes it take
the primary by itself within seconds; make `sl-db-1` hidden only after that (a hidden member must have priority 0).
The PBM agent URI names only `127.0.0.1:27017`: with `directConnection=true` the agent on a secondary exits
(`get config server connection URI: no documents`), with `replicaSet=rs0` it does not stay on its own member.

**Failover test, 2026-11-17:** `rs.stepDown(60)` on `sl-db-2`; `sl-db-3` was primary 8 ms later, and `sl-db-2`
took it back by priority 70 s later. A write client (insert + secondary read every 100 ms, 2,326 operations)
and a reader-page client through the app (478 pages) saw no errors; the slowest write was 173 ms (normal 80–95 ms).
The follower carried on with no restart. An unplanned loss of the primary takes longer: about 10–12 s
(`electionTimeoutMillis` 10 s), during which writes wait and retry.

The follower writes to the set, not to one box: `sl-follower-apply` runs with `LOCAL_REPLSET=rs0` and
`LOCAL_HOST` as the seed list of all three members, so it follows the primary through a failover.

## Point-in-time restore

`backup/pitr-restore.sh` restores the whole set as it was at a chosen minute, from the off-site copy only:
the newest daily dump before that minute, then PBM's one-minute oplog slices replayed up to it (PBM's own
`restore --time` does not work on 9.0). The result is a scratch `mongod` on `127.0.0.1:27217`.

```bash
UNTIL=2026-11-17T10:57:00Z CHECK=/path/check.js KEEP=1 /opt/sl-mongo/backup/pitr-restore.sh
```

Drill 2026-11-17 on `sl-db-3` (before it joined), to 10:57:00Z: base dump of 22:30Z (107.9M documents), its
oplog, then 695 slices (817K entries); 2 h 43 min in all, about 40 GB downloaded, all four marker documents right.
Almost all of the time is the dump restore and its index builds; the slices took 38 min. A time inside the slice gap of
2026-11-16 14:28–14:31Z cannot be restored.

## Patching

Unattended upgrades still install security updates, but `conf/needrestart-sl-mongo.conf`
(`/etc/needrestart/conf.d/sl-mongo.conf`) stops needrestart from restarting `mongod`, `mongot`, `pbm-agent`
and the follower by itself: on 2026-11-17 at 06:16Z a libssl update restarted all of them on `sl-db-1` at
once. Restart by hand, one member at a time, secondaries first, then `rs.stepDown()` on the primary and
restart it last. `needrestart -b` lists what is pending.

## Cost

| Item | Monthly |
|---|---|
| `sl-db-1` cax41 | EUR 48.49 (three boxes: about EUR 145) |
| Backup bucket (Scaleway ONEZONE_IA, ~11 PBM backups + 2 fallback dumps + oplog slices) | see the #346 report for the measured figure |
| Restore-test download (one full backup a night; 75 GB a month free, then EUR 0.01/GB) | see the #346 report |
| Atlas transfer of the follower (ids on the stream, changed documents read once per batch) | see the #346 report |
