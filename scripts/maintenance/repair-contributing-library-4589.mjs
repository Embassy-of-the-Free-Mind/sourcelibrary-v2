/**
 * PRIOR ART: scripts/enrichment/backfill-contributing-library.mjs — that is the
 * WRITER that caused defect A (and is fixed in the same PR); it backfills
 * missing values and cannot repair existing ones. scripts/maintenance/
 * normalize-language-tags.mjs is the closest normalizer but targets language
 * fields. No existing script repairs contributing_library shapes/names.
 *
 * Repair contributing_library (#4589), two defects:
 *
 * A. OBJECT-SHAPED VALUES (1,110 rows measured 2026-09-03):
 *    scripts/enrichment/backfill-contributing-library.mjs wrote its whole
 *    `{name, url, note}` PROVIDER_MAP entry into `books.contributing_library`
 *    instead of the name string. The Supabase mirror coalesces
 *    `contributing_library || image_source.contributing_library` into a text
 *    column, so those rows rendered a literal JSON blob as an institution
 *    chip on /libraries. Fix: replace the object with its `.name`; the
 *    url/note move into field_provenance so nothing is lost.
 *
 * B. NEAR-DUPLICATE NAMES: the field is free text, so the same institution
 *    appears under several spellings and gets counted as several
 *    institutions. NAME_CANON below merges only clearly-identical cases —
 *    same institution, different label — chosen once here so both storage
 *    locations (`contributing_library` and `image_source.contributing_library`)
 *    and the Supabase mirror end up consistent. Deliberately NOT merged:
 *    project-suffixed credits ("British Library — Javanese Manuscripts…")
 *    and anything where platform vs holder is a judgment call.
 *
 * Dry-run by default; pass --apply to write. Every changed row gets a
 * sweep_log row (never a new field — see field-sprawl.md) and its previous
 * value in a backup JSONL under scripts/output/.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-contributing-library-4589.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'contributing-library-repair-4589';

// Canonical-name mapping. Key = stored variant, value = canonical.
// Rule: merge only labels that unambiguously name the SAME institution.
const NAME_CANON = new Map(Object.entries({
  // Munich — four labels, one library
  'Bayerische Staatsbibliothek (Munich)': 'Bayerische Staatsbibliothek',
  'Bayerische Staatsbibliothek, Munich': 'Bayerische Staatsbibliothek',
  'Bayerische Staatsbibliothek (Münchener Digitalisierungszentrum)': 'Bayerische Staatsbibliothek',
  // Wellcome — the institution's current name is Wellcome Collection
  'Wellcome Library': 'Wellcome Collection',
  'The Wellcome Library, London': 'Wellcome Collection',
  // Leiden — UBL's own English name is plural
  'Leiden University Library': 'Leiden University Libraries',
  // Gallica is the PLATFORM; the holding institution is the BnF
  'Gallica (BnF)': 'Bibliothèque nationale de France',
  'Gallica (Bibliothèque nationale de France)': 'Bibliothèque nationale de France',
  // e-rara / e-codices spelling variants
  'e-rara (Swiss Electronic Library)': 'e-rara (Swiss libraries)',
  'e-rara.ch (Swiss university libraries)': 'e-rara (Swiss libraries)',
  'e-codices (Swiss manuscripts)': 'e-codices (Virtual Manuscript Library of Switzerland)',
  // Trailing qualifiers on an otherwise-identical name
  'Buddhist Digital Resource Center (BDRC)': 'Buddhist Digital Resource Center',
  'Rijksmuseum, Amsterdam': 'Rijksmuseum',
  'Google Books (via Internet Archive)': 'Google Books',
  'Wikimedia Commons (Wikisource Loves Manuscripts / community digitisation)': 'Wikimedia Commons',
  // Cambridge Digital Library is CUL's platform
  'Cambridge Digital Library': 'Cambridge University Library',
  // English/Italian labels for the same Florence library
  'National Central Library of Florence': 'Biblioteca Nazionale Centrale di Firenze',
}));

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const books = db.collection('books');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const backup = [];
const sweepRows = [];
const scriptName = 'repair-contributing-library-4589.mjs';
const now = new Date();
const log = (...a) => console.log(...a);

// ---------- Phase A: object -> name ----------
const objRows = await books.find(
  { contributing_library: { $type: 'object' } },
  { projection: { id: 1, contributing_library: 1 } }
).toArray();
log(`Phase A: ${objRows.length} object-shaped rows`);
let aFixed = 0, aSkipped = 0;
for (const r of objRows) {
  const name = typeof r.contributing_library?.name === 'string' ? r.contributing_library.name.trim() : '';
  if (!name) { log('  SKIP (no .name):', r.id, JSON.stringify(r.contributing_library)); aSkipped++; continue; }
  const canon = NAME_CANON.get(name) || name;
  backup.push({ phase: 'A', id: r.id, field: 'contributing_library', before: r.contributing_library, after: canon });
  if (APPLY) {
    await books.updateOne({ _id: r._id }, {
      $set: {
        contributing_library: canon,
        // Preserve the url/note the object carried — provenance, not a book field
        'field_provenance.contributing_library.repair_4589': {
          previous_object: r.contributing_library, repaired_at: now, script: scriptName,
        },
      },
    });
  }
  sweepRows.push({ sweep: SWEEP, book_id: r.id, action: 'object-to-name', detail: { before: r.contributing_library, after: canon }, script: scriptName, at: now });
  aFixed++;
}
log(`Phase A: ${aFixed} repaired, ${aSkipped} skipped`);

// ---------- Phase B: canonical names, both storage locations ----------
for (const [from, to] of NAME_CANON) {
  for (const field of ['contributing_library', 'image_source.contributing_library']) {
    const ids = await books.find({ [field]: from }, { projection: { id: 1 } }).toArray();
    if (!ids.length) continue;
    log(`Phase B: ${field} "${from}" -> "${to}"  (${ids.length} rows)`);
    for (const r of ids) {
      backup.push({ phase: 'B', id: r.id, field, before: from, after: to });
      sweepRows.push({ sweep: SWEEP, book_id: r.id, action: 'name-normalized', detail: { field, before: from, after: to }, script: scriptName, at: now });
    }
    if (APPLY) await books.updateMany({ [field]: from }, { $set: { [field]: to } });
  }
}

// ---------- Persist the paper trail ----------
mkdirSync('scripts/output', { recursive: true });
const backupPath = `scripts/output/contributing-library-repair-4589-${now.toISOString().slice(0, 10)}.jsonl`;
writeFileSync(backupPath, backup.map(b => JSON.stringify(b)).join('\n') + '\n');
log(`Backup: ${backup.length} rows -> ${backupPath}`);
if (APPLY && sweepRows.length) {
  for (let i = 0; i < sweepRows.length; i += 1000) {
    await db.collection('sweep_log').insertMany(sweepRows.slice(i, i + 1000));
  }
  log(`sweep_log: ${sweepRows.length} rows`);
}

// ---------- Phase C: Supabase mirror ----------
// The mirror coalesced Mongo's value at sync time; rather than waiting for the
// next full sync, update the affected rows directly with the same rule.
if (APPLY) {
  const touched = [...new Set(backup.map(b => b.id))];
  log(`Phase C: re-mirroring ${touched.length} books to Supabase`);
  let cUpdated = 0, cErrors = 0;
  for (let i = 0; i < touched.length; i += 200) {
    const chunk = touched.slice(i, i + 200);
    const rows = await books.find(
      { id: { $in: chunk } },
      { projection: { id: 1, contributing_library: 1, 'image_source.contributing_library': 1 } }
    ).toArray();
    for (const r of rows) {
      const value = r.contributing_library || r.image_source?.contributing_library || null;
      const { error } = await supabase.from('books_catalog')
        .update({ contributing_library: value }).eq('id', r.id);
      if (error) { cErrors++; if (cErrors <= 5) log('  supabase error:', r.id, error.message); }
      else cUpdated++;
    }
  }
  log(`Phase C: ${cUpdated} mirror rows updated, ${cErrors} errors`);
} else {
  log('\nDRY RUN — nothing written. Re-run with --apply to execute.');
}

await mongo.close();
