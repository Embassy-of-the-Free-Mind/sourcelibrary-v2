/**
 * versioned-config — a revision trail for `system_config` (#3756 "everything
 * versions").
 *
 * `processing_control` is shared mutable production state with a documented
 * history of being clobbered by concurrent sessions (the June scope-stomp
 * lost a 47-book batch unrecoverably; the relight found seven stale scopes
 * nobody could date). Pages got `page_revisions`; books got book revisions;
 * config had nothing — this closes that.
 *
 * Every write through here snapshots the PRIOR doc to
 * `system_config_revisions` first: { config_id, prior, changed_by, change,
 * created_at }. Reverting = read the snapshot, write it back (through here,
 * so the revert is itself versioned).
 *
 * This is a door, not a wall: raw $set from a session still works and is
 * still wrong. The nightly stage-coverage snapshot provides the safety net —
 * it records dial/pause state every night, so side-door changes are at least
 * observable day-over-day.
 */

/**
 * Versioned update of one system_config doc.
 * @param {import('mongodb').Db} db
 * @param {string} configId    e.g. 'processing_control'
 * @param {object} update      full Mongo update doc ({ $set, $unset, ... })
 * @param {string} changedBy   who/what/why — REQUIRED, shows in the trail
 */
export async function updateConfigVersioned(db, configId, update, changedBy) {
  if (!changedBy) throw new Error('updateConfigVersioned: changedBy is required — the trail is the point');
  const prior = await db.collection('system_config').findOne({ _id: configId });
  await db.collection('system_config_revisions').insertOne({
    config_id: configId,
    prior: prior ?? null,
    change: JSON.parse(JSON.stringify(update)),
    changed_by: changedBy,
    created_at: new Date(),
  });
  return db.collection('system_config').updateOne({ _id: configId }, update, { upsert: true });
}

/** Convenience: versioned $set of top-level fields on processing_control. */
export function setProcessingControl(db, fields, changedBy) {
  return updateConfigVersioned(db, 'processing_control', { $set: { ...fields } }, changedBy);
}
