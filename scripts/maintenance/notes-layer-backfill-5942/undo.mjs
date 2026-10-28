#!/usr/bin/env node
/**
 * Undo one run of backfill.mjs (#5942): put back each page's previous `translation.text` /
 * `translation.text_from` (unset them when there were none) and delete the `page_annotations`
 * docs the run wrote. Dry run unless --apply.
 *
 * PRIOR ART: backfill.mjs in this directory writes the page_revisions rows this reads
 * (field 'translation.text', source 'notes-layer-backfill-5942', run_id).
 *
 * Compare-and-set: a page is restored only while it still holds what the run wrote
 * (text_from.data_hash + parser_version of the row). A page a translation writer has since
 * re-written carries its own text — the run's text is gone, and that page is left alone. The
 * same for annotations: only docs tagged with the run's run_id are deleted.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/maintenance/notes-layer-backfill-5942/undo.mjs --run-id <id> [--ids-file <file>] [--apply]
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const SOURCE = 'notes-layer-backfill-5942';

/** @param {import('mongodb').Db} db */
export async function undoRun(db, { runId, apply = false, pageIds = null }) {
  const q = { source: SOURCE, run_id: runId, field: 'translation.text', aborted: { $exists: false }, undone_at: { $exists: false } };
  if (pageIds) q.page_id = { $in: pageIds };
  const rows = await db.collection('page_revisions').find(q).toArray();
  const t = { rows: rows.length, restored: 0, unset: 0, moved_on: 0, annotations_deleted: 0 };
  for (const row of rows) {
    const filter = { id: row.page_id, 'translation.text_from.data_hash': row.data_hash, 'translation.text_from.parser_version': row.parser_version };
    const update = row.data == null
      ? { $unset: { 'translation.text': '', 'translation.text_from': '' } }
      : { $set: { 'translation.text': row.data, 'translation.text_from': row.prev_text_from } };
    const kind = row.data == null ? 'unset' : 'restored';
    if (!apply) {
      if (await db.collection('pages').countDocuments(filter, { limit: 1 })) t[kind]++; else t.moved_on++;
      continue;
    }
    const r = await db.collection('pages').updateOne(filter, update);
    if (r.matchedCount) t[kind]++; else t.moved_on++;
    const d = await db.collection('page_annotations').deleteMany({ page_id: row.page_id, run_id: runId });
    t.annotations_deleted += d.deletedCount;
    await db.collection('page_revisions').updateOne({ id: row.id }, { $set: { undone_at: new Date() } });
  }
  if (!apply) t.annotations_would_delete = await db.collection('page_annotations').countDocuments({ run_id: runId, ...(pageIds ? { page_id: { $in: pageIds } } : {}) });
  return t;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const runId = arg('--run-id');
  const apply = args.includes('--apply');
  const idsFile = arg('--ids-file');
  if (!runId) { console.error('--run-id <id> is required'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { appName: `${SOURCE}-undo` });
  await client.connect();
  const t = await undoRun(client.db('bookstore'), { runId, apply, pageIds: idsFile ? readFileSync(idsFile, 'utf8').split(/\s+/).filter(Boolean) : null });
  console.log(JSON.stringify({ run_id: runId, apply, ...t }, null, 1));
  await client.close();
}
