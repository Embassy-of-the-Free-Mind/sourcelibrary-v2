#!/usr/bin/env node
/**
 * Write original-script name forms onto classical books, so a reader can find
 * them by the name the author actually had.
 *
 * Of 1,151 Greek-language live books, ZERO carry Greek script in any name or
 * title field (measured 2026-08-06); the `authors` thesaurus has none either,
 * across 4,825 records. So `Πλάτων` returns nothing — the string does not exist
 * in the catalogue. Greek *inside* the books is already findable; only the
 * catalogue card is monolingual.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/maintenance/backfill-name-forms.mjs
 *   node scripts/maintenance/backfill-name-forms.mjs --apply
 *   node scripts/maintenance/backfill-name-forms.mjs --unset --apply    (revert)
 *
 * WRITING IS NOT ENOUGH ON ITS OWN. `books_search` is dynamic:false, so
 * `name_forms` is invisible to search until the index maps it — and it must be
 * mapped with `icuFolding`, not the live `standard_diacritic` (whose
 * `asciiFolding` leaves Greek untouched, so `πλατων` would never match
 * `Πλάτων`). The staged definition is in
 * `.claude/docs/greek-search-index-change.md`; the acceptance test is
 * `scripts/audit/greek-name-search.mjs`.
 */
import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const UNSET = process.argv.includes('--unset');
const __dirname = dirname(fileURLToPath(import.meta.url));

// The list lives in TypeScript next to the app code that will read it; parse the
// literal out rather than duplicating it here, so the two cannot drift.
const src = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'classical-name-forms.ts'), 'utf8');
const body = src.slice(src.indexOf('CLASSICAL_NAME_FORMS: Record<string, string[]> = {'));
const FORMS = {};
for (const m of body.matchAll(/^\s{2}'?([A-Za-z .]+?)'?:\s*\[([^\]]+)\],/gm)) {
  FORMS[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const total = Object.keys(FORMS).length;
if (total < 20) { console.error(`parsed only ${total} authors from classical-name-forms.ts — parser drift, aborting`); process.exit(1); }
console.log(`${total} authors in the curated list${APPLY ? '' : '   (DRY RUN — pass --apply to write)'}`);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const B = c.db('bookstore').collection('books');
const live = { visible: true, pages_count: { $gt: 0 } };

if (UNSET) {
  const n = await B.countDocuments({ name_forms: { $exists: true } });
  console.log(`books carrying name_forms: ${n}`);
  if (APPLY) console.log('unset:', (await B.updateMany({ name_forms: { $exists: true } }, { $unset: { name_forms: '' } })).modifiedCount);
  await c.close(); process.exit(0);
}

// Group by book so a volume matching two authors (e.g. "Galen; Hippocrates")
// gets ONE union write rather than being overwritten by whichever ran last —
// which is how an earlier proof reported 445 books when only 414 were distinct.
const perBook = new Map();
for (const [name, greek] of Object.entries(FORMS)) {
  const ids = await B.distinct('id', { ...live, author: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  for (const id of ids) {
    if (!perBook.has(id)) perBook.set(id, new Set());
    for (const g of greek) perBook.get(id).add(g);
  }
  if (ids.length) console.log(`  ${name.padEnd(20)} ${String(ids.length).padStart(4)} books`);
}
console.log(`\ndistinct books to update: ${perBook.size}`);

if (!APPLY) {
  const [firstId, forms] = perBook.entries().next().value || [];
  if (firstId) console.log(`sample: ${firstId} → ${[...forms].join(', ')}`);
  console.log('DRY RUN — nothing written.');
  await c.close(); process.exit(0);
}

const ops = [...perBook].map(([id, forms]) => ({ updateOne: { filter: { id }, update: { $set: { name_forms: [...forms] } } } }));
let modified = 0;
for (let i = 0; i < ops.length; i += 500) {
  const r = await B.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  modified += r.modifiedCount;
}
console.log(`modified ${modified} books`);
console.log(`verify: ${await B.countDocuments({ name_forms: { $exists: true, $ne: [] } })} books now carry name_forms`);
console.log('\nNOT YET SEARCHABLE — the index must map name_forms with icuFolding.');
console.log('See .claude/docs/greek-search-index-change.md, then run scripts/audit/greek-name-search.mjs');
await c.close();

export {};
if (import.meta.url !== pathToFileURL(process.argv[1]).href) { /* module-safe */ }
