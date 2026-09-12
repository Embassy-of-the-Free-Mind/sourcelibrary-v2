#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/backfill-language-provenance.mjs fills `field_provenance.language`
 * from the signals we hold (#2184 remediation). It does not RESHAPE entries that already exist, and
 * that is the remaining defect: the field has two shapes in production.
 *
 * 454 of 33,218 books store a bare STRING here — just a label such as 'caller', 'ia_metadata',
 * 'ia_ocr_detected', 'curator', 'manual_curator_override', 'content_classifier_2026_06_16' — while
 * 32,712 store the typed entry src/lib/resolve-language.ts defines
 * ({ source, value, chosen_from, claims[], conflict?, date }). A reader asking a string for
 * `.chosen_from` or `.claims` gets `undefined`, silently, on those 454. The direct importers wrote
 * the string form; the API routes wrote the object form — the same "which door did the data come
 * through" disease that scripts/lib/language-normalize.mjs exists to end.
 *
 * The label is preserved as `chosen_from`, and `value` is reconstructed from the book's CURRENT
 * `language`, which is the value that label was describing. `date` is omitted rather than invented —
 * we do not know when the original write happened, and a fabricated timestamp is worse than none.
 *
 * REVERSIBLE: every prior value goes to `sweep_log` first, replayable with
 * restore-orphan-book-fields.mjs --sweep language-provenance-shape-2026-09.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/normalize-language-provenance-shape.mjs            # dry run
 *   node scripts/maintenance/normalize-language-provenance-shape.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'language-provenance-shape-2026-09';
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, socketTimeoutMS: 600000 });
await client.connect();
const db = client.db('bookstore');
const B = db.collection('books');

const rows = await B.find(
  { 'field_provenance.language': { $type: 'string' } },
  { projection: { id: 1, language: 1, field_provenance: 1, _id: 0 } },
).toArray();

console.log(`field_provenance.language stored as a bare string: ${rows.length} book(s)`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

const byLabel = {};
for (const r of rows) byLabel[r.field_provenance.language] = (byLabel[r.field_provenance.language] || 0) + 1;
for (const [label, n] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${label}`);
}

let written = 0, skippedNoLanguage = 0;
for (const r of rows) {
  const label = r.field_provenance.language;
  // Without a current language there is no value to carry, so the string says nothing a typed entry
  // could hold. Leave it for a human rather than write { value: null }.
  if (!r.language) { skippedNoLanguage++; continue; }
  const entry = {
    source: 'backfill-shape',
    value: r.language,
    chosen_from: label,
    claims: [{ source: label, value: r.language }],
    note: 'reshaped from a bare provenance label; original write date unknown',
  };
  if (!APPLY) { written++; continue; }
  await recordSweepAction(db, {
    sweep: SWEEP, book_id: r.id, action: 'language-provenance-reshaped',
    detail: { field_provenance: { language: label } },
  });
  await B.updateOne({ id: r.id }, { $set: { 'field_provenance.language': entry, updated_at: new Date() } });
  written++;
}

console.log(`\n${APPLY ? 'reshaped' : 'would reshape'}: ${written}`);
console.log(`left alone (no current language to carry): ${skippedNoLanguage}`);
if (!APPLY) console.log('\nDry-run only. Re-run with --apply.');
else console.log(`\nReversible: restore-orphan-book-fields.mjs --sweep ${SWEEP}`);
await client.close();
