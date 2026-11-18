// mongosh script: create the collections and secondary indexes recorded in a mongodump archive's prelude
// (#346; README "Backups"). The restore test uses it to recreate EPHEMERAL collections empty, with their
// indexes, after a restore that left them out; with no ONLY it builds every index (after --noIndexRestore).
// Env: META = archive-tee.py's metadata output; EPHEMERAL = namespaces to empty first (their unique keys cannot
// survive a fuzzy dump plus replay; they refill by themselves); ONLY = limit to these namespaces.
// Skips views, system.* collections, and collections the oplog replay dropped; fails on any other error.
// PRIOR ART: none — mongorestore builds indexes itself unless --noIndexRestore, and no repo script rebuilds
// indexes from an archive (looked in scripts/maintenance and infrastructure/).
const meta = JSON.parse(fs.readFileSync(process.env.META, 'utf8'));
const ephemeral = new Set((process.env.EPHEMERAL || '').split(',').filter(Boolean));
const only = new Set((process.env.ONLY || '').split(',').filter(Boolean));
let built = 0, colls = 0;
for (const [ns, raw] of Object.entries(meta)) {
  const i = ns.indexOf('.'); const d = ns.slice(0, i), c = ns.slice(i + 1);
  if (only.size && !only.has(ns)) continue;
  if (!raw || c.startsWith('system.') || ['local', 'config'].includes(d)) continue;
  const md = EJSON.parse(raw);
  if (md.type === 'view' || (md.options && md.options.viewOn)) continue;
  const sdb = db.getSiblingDB(d);
  if (sdb.getCollectionInfos({ name: c }).length === 0) {
    if (!only.size) continue; // dropped during the dump window
    sdb.createCollection(c, md.options || {}); // left out of the restore: recreate it
  }
  if (ephemeral.has(ns)) sdb.getCollection(c).deleteMany({});
  const specs = (md.indexes || []).filter(x => x.name !== '_id_').map(x => { const s = { ...x }; delete s.v; delete s.ns; return s; });
  if (!specs.length) continue;
  const r = sdb.runCommand({ createIndexes: c, indexes: specs });
  if (!r.ok) throw new Error(`createIndexes on ${ns} failed: ${r.errmsg || JSON.stringify(r)}`);
  built += specs.length; colls++;
}
print(JSON.stringify({ built, colls }));
