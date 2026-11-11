#!/usr/bin/env node
/**
 * #6056 metadata round — apply catalogue-field corrections that were checked against the book's own
 * title page / colophon image. Reads a fixes file (one entry per book, each field with the value the
 * record holds now and the value the page shows) and writes only where the record still holds the
 * catalogued value.
 *
 * PRIOR ART: scripts/maintenance/apply-byline-proposals-3894.mjs — the same write legs (books, the
 * `field_provenance` collection, `sweep_log`, the `books_catalog` mirror, revalidate) and the merged
 * backup, but for one field (`author`) from one proposals file. This takes any set of fields per book
 * so one round's verified fixes go through one audited path, and it logs the sweep row BEFORE the write.
 *
 * WHAT IT WRITES, per book whose every `expect` value still matches:
 *   - `books.<field>` → the corrected value (`unset: [...]` removes a field whose value is wrong and no
 *     right value is shown, e.g. a digitisation year standing as `year`).
 *   - `books.field_provenance.<field>` + `field_provenance_history.<field>` (scripts/lib/field-provenance.mjs)
 *     in the same updateOne, for top-level fields. Fields inside `source_work_dates_meta` keep that
 *     object's own shape: the corrected layer carries basis + evidence and the object gets `edited_by`,
 *     which the dating run (#6721) treats as a human edit and skips.
 *   - one `field_provenance` collection row per changed field (before, after, evidence page, method, reader).
 *   - one `sweep_log` row per book, written BEFORE the update.
 *   - `books_catalog` mirror for the mirrored columns (title, display_title, author, language, year,
 *     published), with `updated_at`.
 *   - POST /api/admin/revalidate-book/<id>.
 * SKIPS a book when any `expect` value has changed, or when a field already carries a human edit
 * (embedded stamp or collection row from curator / hand-adjudicated / admin, or `edited_by`).
 *
 * Dry run by default; the dry run writes nothing. The backup merges on book id and the earliest
 * `before` wins, so a second --apply cannot lose the original.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-meta-round-6056.mjs --fixes=<file>
 *   node --env-file=.env.production.local scripts/maintenance/apply-meta-round-6056.mjs --fixes=<file> --apply
 *   node --env-file=.env.production.local scripts/maintenance/apply-meta-round-6056.mjs --fixes=<file> --revert [--apply]
 *   The backup is <fixes dir>/backups/<run>.json unless --backup=<file> is given.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const FIXES = (process.argv.find((a) => a.startsWith('--fixes=')) || '').split('=')[1];
if (!FIXES) { console.error('--fixes=<file> is required'); process.exit(2); }
const spec = JSON.parse(readFileSync(FIXES, 'utf8'));
const RUN = spec.run;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(RUN || '')) throw new Error('fixes file needs a kebab-case `run`');
// Default next to the fixes file, so the backup is committed with the round (scripts/maintenance/backups/ is gitignored).
const BACKUP = (process.argv.find((a) => a.startsWith('--backup=')) || '').split('=')[1] || join(dirname(FIXES), 'backups', `${RUN}.json`);
const MIRRORED = new Set(['title', 'display_title', 'author', 'language', 'year', 'published']);
const HUMAN = /curator|hand-adjudicated|admin|human|manual|editor-ui/i;

const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const norm = (v) => (v === undefined ? null : v);

async function mirror(id, fields) {
  const body = Object.fromEntries(Object.entries(fields).filter(([k]) => MIRRORED.has(k)));
  if (!Object.keys(body).length) return { ok: true, rows: 0, skipped: true };
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
  if (!SUPABASE_URL || !KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
}
async function revalidate(id) {
  if (!process.env.CRON_SECRET) return false;
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  return !!r?.ok;
}
function mergeBackup(rows) {
  const prior = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : { run: RUN, entries: [] };
  const byId = new Map(prior.entries.map((e) => [e.book_id, e]));
  for (const r of rows) if (!byId.has(r.book_id)) byId.set(r.book_id, r);
  mkdirSync(dirname(BACKUP), { recursive: true });
  writeFileSync(BACKUP, JSON.stringify({ run: RUN, entries: [...byId.values()] }, null, 1));
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`no backup at ${BACKUP}`); process.exit(1); }
  const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const e of entries) {
    const b = await books.findOne({ id: e.book_id });
    const drift = Object.keys(e.after).filter((k) => !isDeepStrictEqual(norm(get(b, k)), norm(e.after[k])));
    if (drift.length) { console.log(`skip ${e.book_id}: changed since apply (${drift.join(', ')})`); continue; }
    const set = {}, unset = {};
    for (const [k, v] of Object.entries(e.before)) { if (v == null) unset[k] = ''; else set[k] = v; }
    if (Object.keys(e.before).some((k) => k.startsWith('source_work_dates_meta.'))) unset['source_work_dates_meta.edited_by'] = '';
    console.log(`${APPLY ? 'REVERT' : 'would revert'} ${e.book_id} ${Object.keys(e.before).join(', ')}`);
    if (!APPLY) continue;
    await recordSweepAction(db, { sweep: `${RUN}-revert`, book_id: e.book_id, action: 'catalogue-field-correction-reverted', detail: { restored: e.before } });
    const r = await books.updateOne({ id: e.book_id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (r.modifiedCount) n++;
    await mirror(e.book_id, e.before);
    await revalidate(e.book_id);
  }
  console.log(APPLY ? `reverted ${n} of ${entries.length}` : `dry run: ${entries.length} in backup (add --apply)`);
  await mc.close(); process.exit(0);
}

const backupRows = [], skipped = [];
let wrote = 0, mirrored = 0, reval = 0;
for (const f of spec.fixes) {
  const b = await books.findOne({ id: f.book_id });
  if (!b) { skipped.push([f.book_id, 'not found']); continue; }
  const fields = [...Object.keys(f.set || {}), ...(f.unset || [])];
  const drift = Object.entries(f.expect || {}).filter(([k, v]) => !isDeepStrictEqual(norm(get(b, k)), norm(v)));
  if (drift.length) { skipped.push([f.book_id, `changed since check: ${drift.map(([k]) => `${k}=${JSON.stringify(get(b, k))}`).join('; ')}`]); continue; }
  const missingExpect = fields.filter((k) => !(k in (f.expect || {})));
  if (missingExpect.length) throw new Error(`${f.book_id}: no expect value for ${missingExpect.join(', ')}`);
  const provRows = await db.collection('field_provenance').find({ book_id: f.book_id, field: { $in: fields } }).toArray();
  const human = fields.filter((k) => HUMAN.test(String(b.field_provenance?.[k]?.source || '')) || provRows.some((r) => r.field === k && HUMAN.test(String(r.source || '')))
    || (k.startsWith('source_work_dates_meta') && b.source_work_dates_meta?.edited_by));
  if (human.length) { skipped.push([f.book_id, `human edit on ${human.join(', ')}`]); continue; }

  const before = Object.fromEntries(fields.map((k) => [k, norm(get(b, k))]));
  const after = { ...Object.fromEntries((f.unset || []).map((k) => [k, null])), ...f.set };
  console.log(`${APPLY ? 'WRITE' : 'would write'}  ${f.book_id}  ${String(b.title).slice(0, 44)}`);
  for (const k of fields) console.log(`      ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`);
  backupRows.push({ book_id: f.book_id, before, after, at: new Date().toISOString() });
  if (!APPLY) continue;

  const evidence = { ...f.evidence, class: f.class, method: spec.method, reader: spec.reader };
  await recordSweepAction(db, { sweep: RUN, book_id: f.book_id, action: 'catalogue-field-corrected', detail: { class: f.class, before, after, page_number: f.evidence?.page ?? null } });
  const $set = { ...(f.set || {}) }, $unset = Object.fromEntries((f.unset || []).map((k) => [k, ''])), $push = {};
  for (const k of fields) {
    if (k.includes('.')) continue; // nested layers carry their own basis/evidence (see header)
    const p = provenanceUpdate(k, { source: spec.source, script: basename(fileURLToPath(import.meta.url)), run: RUN, previous_value: before[k], value: after[k], evidence_page: f.evidence?.page ?? null, method: spec.method });
    Object.assign($set, p.$set); Object.assign($push, p.$push);
  }
  if (fields.some((k) => k.startsWith('source_work_dates_meta.'))) $set['source_work_dates_meta.edited_by'] = `${spec.source} (${RUN})`;
  const r = await books.updateOne({ id: f.book_id }, { $set, ...(Object.keys($unset).length ? { $unset } : {}), ...(Object.keys($push).length ? { $push } : {}) });
  if (r.modifiedCount !== 1) { console.log(`   !! modifiedCount ${r.modifiedCount}`); continue; }
  wrote++;
  const now = new Date().toISOString();
  for (const k of fields) {
    await db.collection('field_provenance').insertOne({ book_id: f.book_id, field: k, value: after[k], previous_value: before[k], source: spec.source, run: RUN, evidence, created_at: now });
  }
  const m = await mirror(f.book_id, after);
  if (m.ok && m.rows > 0) mirrored++;
  if (await revalidate(f.book_id)) reval++;
}
if (APPLY && backupRows.length) mergeBackup(backupRows);

console.log(`\n-- ${APPLY ? 'applied' : 'dry run (nothing written)'} · run ${RUN} --`);
console.log(`  books ${APPLY ? 'written' : 'that would be written'}: ${APPLY ? wrote : backupRows.length}`);
if (APPLY) console.log(`  books_catalog mirrored: ${mirrored} · revalidated: ${reval} · backup ${BACKUP}`);
console.log(`  skipped: ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
await mc.close();
