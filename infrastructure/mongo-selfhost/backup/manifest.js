// Count every collection AT a backup's consistency point, so a restore can be checked exactly (#346).
// PRIOR ART: none — the stage 0 restore compared against Atlas's live counts, which drift; this reads
// the server's own snapshot at the backup's last_write_ts instead.
// Run by backup-daily.sh as admin with: --eval "const BACKUP='<pbm backup name>'" manifest.js
// Prints one JSON document: { backup, last_write_ts:{t,i}, at, dbs:{ db:{ coll:{ n, indexes:[names], ttl } } } }
// Or, for the mongodump fallback (no PBM record): --eval "const BACKUP='<name>', AT_TS=Timestamp({t,i})" manifest.js
// with the cluster time read the moment mongodump exited. That is a second or so AFTER the dump's own oplog
// ends, so it also records as `hot` {ns: inserts + deletes} in the HOT_S seconds before it: a restored count
// may differ from the manifest by at most that many, and the restore test allows exactly that.
const adm = db.getSiblingDB('admin');
let ts;
if (typeof AT_TS !== 'undefined') ts = AT_TS;
else {
  const b = adm.getCollection('pbmBackups').findOne({ name: BACKUP });
  if (!b || b.status !== 'done') throw new Error(`backup ${BACKUP} not done: ${b && b.status}`);
  ts = b.last_write_ts; // Timestamp, with its ordinal (the JSON from `pbm describe-backup` drops the ordinal)
}
const out = { backup: BACKUP, last_write_ts: { t: ts.getHighBits(), i: ts.getLowBits() }, at: new Date().toISOString(), dbs: {} };
if (typeof AT_TS !== 'undefined') {
  const HOT_S = 60;
  const win = { $gt: Timestamp({ t: ts.getHighBits() - HOT_S, i: 0 }), $lte: ts };
  const oplog = db.getSiblingDB('local').oplog.rs;
  // inserts + deletes per namespace in the window (updates do not move a count): plain entries, plus those
  // grouped into applyOps (transactions, the TTL monitor's batched deletes)
  out.hot = {};
  const add = (ns, n) => { out.hot[ns] = (out.hot[ns] || 0) + n; };
  oplog.aggregate([{ $match: { ts: win, op: { $in: ['i', 'd'] } } }, { $group: { _id: '$ns', n: { $sum: 1 } } }]).forEach((x) => add(x._id, x.n));
  oplog.aggregate([{ $match: { ts: win, op: 'c', 'o.applyOps': { $exists: true } } }, { $unwind: '$o.applyOps' },
    { $match: { 'o.applyOps.op': { $in: ['i', 'd'] } } }, { $group: { _id: '$o.applyOps.ns', n: { $sum: 1 } } }]).forEach((x) => add(x._id, x.n));
}
for (const d of adm.runCommand({ listDatabases: 1, nameOnly: true }).databases.map((x) => x.name)) {
  if (['admin', 'local', 'config'].includes(d)) continue;
  const ddb = db.getSiblingDB(d);
  out.dbs[d] = {};
  for (const c of ddb.getCollectionInfos({ type: 'collection' }, { nameOnly: false })) {
    if (c.name.startsWith('system.')) continue;
    const cmd = { aggregate: c.name, pipeline: [{ $count: 'n' }], cursor: {}, readConcern: { level: 'snapshot', atClusterTime: ts }, hint: { _id: 1 } };
    let r;
    try { r = ddb.runCommand(cmd); } catch (e) { r = { ok: 0, errmsg: e.message }; }
    if (!r.ok && /hint/i.test(r.errmsg || '')) { delete cmd.hint; r = ddb.runCommand(cmd); } // e.g. a clustered collection
    if (!r.ok) throw new Error(`count ${d}.${c.name} at backup time failed: ${r.errmsg}`);
    const idx = ddb.getCollection(c.name).getIndexes();
    out.dbs[d][c.name] = {
      n: r.cursor.firstBatch.length ? r.cursor.firstBatch[0].n : 0,
      indexes: idx.map((x) => x.name).sort(),
      ttl: idx.some((x) => x.expireAfterSeconds !== undefined),
    };
  }
}
print(JSON.stringify(out));
