#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/apply-byline-proposals-3894.mjs — the write shape copied here (dry run by default,
// merge-on-id backup with --revert, sweep_log row per book before the write, one field_provenance row per field), but
// it writes VALUES from a proposals file; nothing there reads field_provenance_history. scripts/lib/catalogue-fields.mjs
// buildAttestation() stamps an unstamped value from an external record, not from our own history, and refuses fields
// outside CATALOGUE_FIELDS (contributing_library, chapters). scripts/audit/field-provenance.ts counts history but
// writes nothing.
/**
 * #8024 — put back the `field_provenance.<field>` stamps that cover writes erased.
 *
 * WHY. Until v2#8025, `buildCoverUpdate()` returned `field_provenance: { thumbnail }` and every caller `$set` it,
 * which replaced the whole map: one cover write erased every other stamp on the book. `ensure-cover` runs on a
 * book's first view, so the loss kept growing. The append-only `field_provenance_history` was not touched, so the
 * erased stamp is still there, as the last history entry of its field.
 *
 * WHAT IT RESTORES. For each book whose history holds a field with no current stamp, the LAST history entry of that
 * field, copied back verbatim to `field_provenance.<field>` with one added key, `restored_from_history`. Only when:
 *   - the value that entry stamped is KNOWN, and
 *   - the book's current value still EQUALS it (the stamp still describes the value next to it), and
 *   - `field_provenance.<field>` is still absent at write time (compare-and-set on both).
 * Anything else is reported, never written: a stamp that is wrong is worse than a stamp that is missing.
 *
 * HOW THE STAMPED VALUE IS KNOWN. A history entry records `previous_value`, not the value it wrote, so it comes from:
 *   1. a reconstructed attestation (`reconstructed: true`, #7673): the write replaced nothing, previous_value IS the value;
 *   2. an entry carrying `value`;
 *   3. a `field_provenance` collection row for the same book, field and run (written after a successful write);
 *   4. a `sweep_log` row for the same book and sweep/run (or, for an entry with no run, the same script), written
 *      within 6 h of the entry: detail.value, detail.after or detail.to;
 *   5. `harvest-holding-libraries.mjs` entries: the HTML-stripped `raw_upstream`, the exact transform that script wrote.
 * No record → status `no_value_record` (e.g. `chapters`, whose previous_value is only a count).
 *
 * It does NOT push a history entry: the restored stamp already IS the last entry. A revert unsets only stamps that
 * carry this run's `restored_from_history.run`.
 *
 * Usage (cwd = main checkout, for the env file):
 *   node --env-file=.env.production.local <path>/scripts/maintenance/restore-erased-stamps-8024.mjs [--out=report.json]
 *   ... --apply            write (Derek sees the dry-run count first, #8024)
 *   ... --revert [--apply] unset what --apply restored, from the backup
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUN = 'restore-erased-stamps-8024';
const SCRIPT = 'scripts/maintenance/restore-erased-stamps-8024.mjs';

/** Where each stamped field's value lives on the book. Fields not listed are top-level. */
export const VALUE_PATH = Object.freeze({ contributing_library: 'image_source.contributing_library' });

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export const valueOf = (book, field) => getPath(book, VALUE_PATH[field] || field);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ms = (d) => (d ? new Date(d).getTime() : NaN);

/** The transform harvest-holding-libraries.mjs applied to IA's `contributor` before writing it (git 3d601958b). */
export function cleanIaContributor(s) {
  if (typeof s !== 'string') return null;
  const text = s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return text || null;
}

/** A side row may only vouch for an entry written within this window of it. */
const SIDE_WINDOW_MS = 6 * 3600 * 1000;

/**
 * The value a history entry stamped, or undefined when nothing records it.
 * @param {object} entry   the history entry
 * @param {string} field
 * @param {{prov: object[], sweeps: object[]}} side  this book's `field_provenance` and `sweep_log` rows
 * @returns {{value: unknown, via: string} | undefined}
 */
export function stampedValue(entry, field, side = { prov: [], sweeps: [] }) {
  if (entry.reconstructed === true && 'previous_value' in entry) return { value: entry.previous_value, via: 'reconstructed' };
  if ('value' in entry) return { value: entry.value, via: 'entry.value' };
  const at = ms(entry.date);
  const near = (t) => Number.isFinite(at) && Number.isFinite(ms(t)) && Math.abs(ms(t) - at) <= SIDE_WINDOW_MS;
  const nearest = (rows, ts) => rows.filter((r) => near(r[ts])).sort((a, b) => Math.abs(ms(a[ts]) - at) - Math.abs(ms(b[ts]) - at))[0];
  const runs = new Set([entry.run, entry.sweep].filter(Boolean));
  const fromSweep = (s, how) => {
    if (s) for (const k of ['value', 'after', 'to']) if (k in s.detail) return { value: s.detail[k], via: `sweep_log.detail.${k}${how}` };
    return undefined;
  };
  const objDetail = (r) => r.detail && typeof r.detail === 'object';
  if (runs.size) {
    const p = nearest(side.prov.filter((r) => r.field === field && runs.has(r.run) && 'value' in r), 'created_at');
    if (p) return { value: p.value, via: 'field_provenance_row' };
    const hit = fromSweep(nearest(side.sweeps.filter((r) => runs.has(r.sweep) && objDetail(r)), 'timestamp'), '');
    if (hit) return hit;
  } else if (typeof entry.script === 'string' && entry.script) {
    // No run on the entry (e.g. fix-era-year.mjs): a sweep row stamped with the same script, written beside it.
    const base = entry.script.split('/').pop();
    const hit = fromSweep(nearest(side.sweeps.filter((r) => r.script === base && objDetail(r)), 'timestamp'), ' (by script)');
    if (hit) return hit;
  }
  if (field === 'contributing_library' && /harvest-holding-libraries/.test(entry.script || '') && typeof entry.raw_upstream === 'string') {
    return { value: cleanIaContributor(entry.raw_upstream), via: 'raw_upstream' };
  }
  return undefined;
}

/**
 * Pure: every erased stamp on one book, and what to do with it.
 * @returns {Array<{field, status: 'restorable'|'value_changed'|'no_value_record', entry, via?, stamped?, current}>}
 */
export function planBook(book, side) {
  const fp = book.field_provenance || {};
  const out = [];
  for (const [field, arr] of Object.entries(book.field_provenance_history || {})) {
    if (!Array.isArray(arr) || !arr.length || fp[field] != null) continue;
    const entry = arr[arr.length - 1];
    const current = valueOf(book, field);
    const sv = stampedValue(entry, field, side);
    if (!sv) out.push({ field, status: 'no_value_record', entry, current });
    else if (same(sv.value, current) && current != null && current !== '') out.push({ field, status: 'restorable', entry, via: sv.via, stamped: sv.value, current });
    else out.push({ field, status: 'value_changed', entry, via: sv.via, stamped: sv.value, current });
  }
  return out;
}

/** Pure: the guarded `updateOne` that restores the restorable stamps of one book, or null. */
export function buildRestoreUpdate(book, plan, now = new Date()) {
  const ok = plan.filter((p) => p.status === 'restorable');
  if (!ok.length) return null;
  const filter = { _id: book._id };
  const $set = {};
  for (const p of ok) {
    filter[`field_provenance.${p.field}`] = { $exists: false };
    filter[VALUE_PATH[p.field] || p.field] = p.current;
    $set[`field_provenance.${p.field}`] = {
      ...p.entry,
      restored_from_history: { run: RUN, script: SCRIPT, issue: 8024, at: now, via: p.via, why: 'erased by a whole-map cover write (v2#8025)' },
    };
  }
  return { filter, update: { $set } };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const { MongoClient, ObjectId } = await import('mongodb');
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const APPLY = process.argv.includes('--apply');
  const REVERT = process.argv.includes('--revert');
  const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || null;
  const BACKUP = join(HERE, 'backups', `${RUN}.json`);

  const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await mc.connect();
  const db = mc.db('bookstore');
  const books = db.collection('books');

  if (REVERT) {
    if (!existsSync(BACKUP)) { console.error('no backup'); process.exit(1); }
    const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
    let n = 0;
    for (const e of entries) for (const field of e.fields) {
      if (!APPLY) continue;
      // The backup is JSON, so an ObjectId `_id` comes back a string: look the book up by id OR either _id form.
      const ids = [{ id: e.book_id }, { _id: e.book_id }, ...(ObjectId.isValid(e.book_id) ? [{ _id: new ObjectId(e.book_id) }] : [])];
      const r = await books.updateOne({ $or: ids, [`field_provenance.${field}.restored_from_history.run`]: RUN }, { $unset: { [`field_provenance.${field}`]: '' } });
      n += r.modifiedCount;
    }
    console.log(APPLY ? `reverted ${n} stamps` : `would revert ${entries.reduce((s, e) => s + e.fields.length, 0)} stamps on ${entries.length} books (add --apply)`);
    await mc.close(); return;
  }

  const projection = { id: 1, title: 1, author: 1, display_title: 1, published: 1, year: 1, chapters: 1, 'image_source.contributing_library': 1, field_provenance: 1, field_provenance_history: 1 };
  const candidates = [];
  for await (const b of books.find({ field_provenance_history: { $exists: true } }, { projection }).batchSize(1000)) {
    const fp = b.field_provenance || {};
    if (Object.entries(b.field_provenance_history || {}).some(([f, a]) => Array.isArray(a) && a.length && fp[f] == null)) candidates.push(b);
  }
  const ids = candidates.map((b) => b.id ?? String(b._id));
  const prov = await db.collection('field_provenance').find({ book_id: { $in: ids } }, { projection: { book_id: 1, field: 1, run: 1, value: 1, created_at: 1 } }).toArray();
  const sweeps = await db.collection('sweep_log').find({ book_id: { $in: ids } }, { projection: { book_id: 1, sweep: 1, script: 1, detail: 1, timestamp: 1 } }).toArray();
  const group = (rows) => rows.reduce((m, r) => (m.get(r.book_id)?.push(r) ?? m.set(r.book_id, [r]), m), new Map());
  const provBy = group(prov), sweepBy = group(sweeps);

  const perField = {};
  const report = [];
  const backupRows = [];
  let wroteBooks = 0, wroteStamps = 0, raced = 0;
  for (const b of candidates) {
    const id = b.id ?? String(b._id);
    const plan = planBook(b, { prov: provBy.get(id) || [], sweeps: sweepBy.get(id) || [] });
    for (const p of plan) {
      const s = perField[p.field] ??= { books: 0, restorable: 0, value_changed: 0, no_value_record: 0, via: {} };
      s.books++; s[p.status]++;
      if (p.via) s.via[p.via] = (s.via[p.via] || 0) + 1;
    }
    report.push({ book_id: id, fields: plan.map((p) => ({ field: p.field, status: p.status, via: p.via ?? null, script: p.entry.script ?? null, entry_date: p.entry.date, stamped: p.stamped, current: Array.isArray(p.current) ? `[${p.current.length} items]` : p.current })) });
    const built = buildRestoreUpdate(b, plan);
    if (!built || !APPLY) continue;
    const fields = plan.filter((p) => p.status === 'restorable').map((p) => p.field);
    const row = { book_id: id, fields, at: new Date().toISOString() };
    // Backup and sweep_log row BEFORE the write, so an interrupted run is still revertible and explained.
    backupRows.push(row);
    mkdirSync(dirname(BACKUP), { recursive: true });
    const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')).entries : [];
    writeFileSync(BACKUP, JSON.stringify({ run: RUN, entries: [...prior.filter((e) => e.book_id !== id), row] }, null, 1));
    await recordSweepAction(db, { sweep: RUN, book_id: id, action: 'stamp-restored-from-history', detail: { fields, issue: 8024 } });
    const r = await books.updateOne(built.filter, built.update);
    if (r.modifiedCount !== 1) { raced++; continue; }
    wroteBooks++; wroteStamps += fields.length;
    const now = new Date();
    for (const p of plan.filter((x) => x.status === 'restorable')) {
      await db.collection('field_provenance').insertOne({ book_id: id, field: p.field, value: p.current, previous_value: p.current, source: 'field_provenance_history', method: `restore last history entry (${p.via})`, run: RUN, created_at: now });
    }
  }

  const totals = Object.values(perField).reduce((t, s) => ({ restorable: t.restorable + s.restorable, value_changed: t.value_changed + s.value_changed, no_value_record: t.no_value_record + s.no_value_record }), { restorable: 0, value_changed: 0, no_value_record: 0 });
  const booksRestorable = report.filter((r) => r.fields.some((f) => f.status === 'restorable'));
  console.log(`books with an erased stamp: ${candidates.length} · with at least one restorable: ${booksRestorable.length}`);
  console.log('field                 books  restorable  value_changed  no_value_record  via');
  for (const [f, s] of Object.entries(perField).sort((a, b) => b[1].books - a[1].books)) {
    console.log(`${f.padEnd(21)} ${String(s.books).padStart(5)}  ${String(s.restorable).padStart(10)}  ${String(s.value_changed).padStart(13)}  ${String(s.no_value_record).padStart(15)}  ${JSON.stringify(s.via)}`);
  }
  console.log(`total stamps: restorable ${totals.restorable}, value_changed ${totals.value_changed}, no_value_record ${totals.no_value_record}`);
  console.log(APPLY ? `\nWROTE: ${wroteStamps} stamps on ${wroteBooks} books; raced ${raced}` : '\ndry run: nothing written (add --apply)');
  if (OUT) writeFileSync(OUT, JSON.stringify({ run: RUN, at: new Date().toISOString(), apply: APPLY, per_field: perField, totals, books: report }, null, 1));
  await mc.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
