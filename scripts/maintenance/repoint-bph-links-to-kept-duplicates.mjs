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

const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db('bookstore');

async function plan() {
  // Start from the catalogue, not from the books: a link can name any library's copy
  // (sl_external_book_id usually names a non-EFM scan). The first version started from
  // hidden EFM books and missed 15 such links (2026-10-29).
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('bph_works')
      .select('ubn, uuid, title, sl_book_id, sl_book_slug, sl_external_book_id, sl_external_slug, field_provenance')
      .or('sl_book_id.not.is.null,sl_external_book_id.not.is.null')
      .order('uuid')
      .range(from, from + 999);
    if (error) throw new Error(`bph_works read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const linked = [...new Set(rows.flatMap(r => [r.sl_book_id, r.sl_external_book_id]).filter(Boolean))];
  const hiddenById = new Map();
  for (let k = 0; k < linked.length; k += 1000) {
    const hidden = await db.collection('books')
      .find({ id: { $in: linked.slice(k, k + 1000) }, visible: false, duplicate_of: { $exists: true, $ne: null } }, { projection: { id: 1, slug: 1, duplicate_of: 1 } })
      .toArray();
    for (const h of hidden) hiddenById.set(h.id, h);
  }

  // The keeper may itself have been hidden as a duplicate later: follow the chain to a live copy.
  async function liveKeeper(h) {
    const seen = new Set([h.id]);
    let id = h.duplicate_of;
    while (id && !seen.has(id)) {
      seen.add(id);
      const k = await db.collection('books').findOne({ id }, { projection: { id: 1, slug: 1, visible: 1, pages_count: 1, duplicate_of: 1 } });
      if (!k) return null;
      if (k.visible === true && k.pages_count > 0) return k;
      id = k.visible === false ? k.duplicate_of : null;
    }
    return null;
  }

  const changes = [];
  for (const r of rows) {
    const next = {};
    for (const [idCol, slugCol] of [['sl_book_id', 'sl_book_slug'], ['sl_external_book_id', 'sl_external_slug']]) {
      const h = hiddenById.get(r[idCol]);
      if (!h) continue;
      const k = await liveKeeper(h);
      if (!k) {
        console.log(`  SKIP ${r.ubn ?? r.uuid}: no live copy along the duplicate_of chain from ${h.slug}`);
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

const stamp = new Date().toISOString().slice(0, 16).replace(':', '');
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
