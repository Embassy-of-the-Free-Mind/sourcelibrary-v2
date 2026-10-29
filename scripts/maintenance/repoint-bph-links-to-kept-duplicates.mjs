#!/usr/bin/env node
/**
 * Re-point EFM catalogue links that name a book hidden as a duplicate to the copy
 * the duplicate sweep kept (#7702 item 2).
 *
 * PRIOR ART: scripts/maintenance/translate-ja-state-shelfmark.mjs — the bph_works bulk-writer
 * pattern copied here (backup, a revision row per record BEFORE the live write, re-read to
 * verify). scripts/maintenance/hide-efm-duplicates.mjs hides the duplicates; it does not touch
 * the catalogue links, which is how they came to point at hidden books.
 *
 * WHY. The EFM catalogue's "read online" link is bph_works.sl_book_id (or sl_external_book_id).
 * When the duplicate sweep hid a book (`hidden_reason: duplicate`, `duplicate_of: <kept id>`),
 * the catalogue kept pointing at the hidden copy, and the embed 404s it. 14 links on 2026-10-29,
 * Atalanta Fugiens among them. The embed admits a non-EFM book when a catalogue row names it
 * (src/lib/tenant-catalog-books.ts), so re-pointing the row also makes the 6 kept copies that are
 * not EFM books readable on the Embassy site.
 *
 * WHAT IT WRITES. For each bph_works row whose sl_book_id / sl_external_book_id names a hidden
 * book whose duplicate_of is a VISIBLE book: that id and its slug column, set to the kept copy.
 * Nothing else. Revisions first (editor system:repoint-bph-links-to-kept-duplicates, real `from`
 * values), so each change is reversible and the 04:30 integrity check reads it as explained.
 * A backup of every affected row goes to scripts/output/ first. Idempotent.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repoint-bph-links-to-kept-duplicates.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repoint-bph-links-to-kept-duplicates.mjs --apply
 */
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const APPLY = process.argv.includes('--apply');
const EDITOR = 'system:repoint-bph-links-to-kept-duplicates';
const NOTE =
  'The linked Source Library book was hidden as a duplicate; the link now points at the copy ' +
  'that was kept, so the catalogue "read online" link stops returning 404 (#7702).';
const BPH_TENANT_ID = 'bce03f71-c18d-4460-b8ad-224c817f9aa0';

const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db('bookstore');

async function plan() {
  const hidden = await db.collection('books')
    .find({ tenantId: BPH_TENANT_ID, visible: false, duplicate_of: { $exists: true, $ne: null } }, { projection: { id: 1, slug: 1, duplicate_of: 1 } })
    .toArray();
  const keptIds = [...new Set(hidden.map(h => h.duplicate_of))];
  const kept = await db.collection('books')
    .find({ id: { $in: keptIds } }, { projection: { id: 1, slug: 1, visible: 1, pages_count: 1, tenantId: 1 } })
    .toArray();
  const keptById = new Map(kept.map(k => [k.id, k]));
  const hiddenById = new Map(hidden.map(h => [h.id, h]));
  const ids = [...hiddenById.keys()];

  const rows = [];
  for (const col of ['sl_book_id', 'sl_external_book_id']) {
    for (let k = 0; k < ids.length; k += 100) {
      const { data, error } = await sb.from('bph_works')
        .select('ubn, uuid, title, sl_book_id, sl_book_slug, sl_external_book_id, sl_external_slug, field_provenance')
        .in(col, ids.slice(k, k + 100));
      if (error) throw new Error(`bph_works read failed: ${error.message}`);
      for (const r of data) if (!rows.some(x => x.uuid === r.uuid)) rows.push(r);
    }
  }

  const changes = [];
  for (const r of rows) {
    const next = {};
    for (const [idCol, slugCol] of [['sl_book_id', 'sl_book_slug'], ['sl_external_book_id', 'sl_external_slug']]) {
      const h = hiddenById.get(r[idCol]);
      if (!h) continue;
      const k = keptById.get(h.duplicate_of);
      if (!k || k.visible !== true || !(k.pages_count > 0)) {
        console.log(`  SKIP ${r.ubn ?? r.uuid}: kept copy ${h.duplicate_of} of ${h.slug} is missing or not live`);
        continue;
      }
      next[idCol] = k.id;
      next[slugCol] = k.slug;
    }
    if (Object.keys(next).length) changes.push({ row: r, next });
  }
  return changes;
}

const changes = await plan();
console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY RUN (use --apply to write)');
console.log(`Catalogue rows to re-point: ${changes.length}`);
for (const { row, next } of changes) {
  for (const col of Object.keys(next).filter(c => c.endsWith('_id'))) {
    const slugCol = col === 'sl_book_id' ? 'sl_book_slug' : 'sl_external_slug';
    console.log(`  ${row.ubn ?? row.uuid}  ${col}: ${row[slugCol] ?? row[col]}  ->  ${next[slugCol]}   (${(row.title || '').slice(0, 50)})`);
  }
}
if (!changes.length || !APPLY) { await mongo.close(); process.exit(0); }

const stamp = new Date().toISOString().slice(0, 10);
mkdirSync('scripts/output', { recursive: true });
const backupPath = `scripts/output/repoint-bph-links-backup-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify({ generated: new Date().toISOString(), reason: NOTE, rows: changes.map(c => c.row) }, null, 2));
console.log(`Backed up ${changes.length} rows -> ${backupPath}`);

// 1. History first: a failure mid-run leaves an orphaned revision, never an unrecorded edit.
const appliedAt = new Date().toISOString();
const { error: revErr } = await sb.from('bph_works_revisions').insert(changes.map(({ row, next }) => ({
  id: randomUUID(),
  ubn: row.ubn,
  work_uuid: row.uuid,
  change_type: 'edit',
  field_changes: Object.fromEntries(Object.entries(next).map(([f, to]) => [f, { from: row[f], to, source: 'duplicate keeper' }])),
  editor_email: EDITOR,
  proposed_by: null,
  source_pending_id: null,
  applied_at: appliedAt,
  note: NOTE,
})));
if (revErr) throw new Error(`revision insert failed: ${revErr.message}`);
console.log(`Revisions written: ${changes.length}`);

// 2. Live rows, one at a time, merging field_provenance rather than overwriting it.
const entry = { source: 'duplicate keeper', edited_by: EDITOR, edited_at: appliedAt };
for (const { row, next } of changes) {
  const prov = row.field_provenance && typeof row.field_provenance === 'object' ? row.field_provenance : {};
  const { error } = await sb.from('bph_works')
    .update({ ...next, field_provenance: { ...prov, ...Object.fromEntries(Object.keys(next).map(f => [f, entry])) } })
    .eq('uuid', row.uuid);
  if (error) throw new Error(`update failed for ${row.ubn ?? row.uuid}: ${error.message}`);
}

// 3. Verify by re-reading.
const remaining = await plan();
console.log(`Rows still pointing at a hidden duplicate: ${remaining.length} (expect 0)`);
await mongo.close();
process.exit(remaining.length ? 1 : 0);
