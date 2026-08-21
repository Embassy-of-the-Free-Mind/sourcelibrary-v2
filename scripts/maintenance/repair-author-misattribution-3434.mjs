#!/usr/bin/env node
/**
 * Repair the hand-verified author misattributions from #3434.
 *
 * SCOPE: exactly the 14 book ids listed below — reference-genre works (bookseller
 * and auction catalogues, banned-book lists, accession registers, a bibliographic
 * periodical) attributed to a person who died decades or centuries earlier. Each
 * was checked individually against its title, imprint and publication year; the
 * list is a literal, not a query, so this script cannot widen its own blast
 * radius if the detector's precision changes.
 *
 * WHAT IT WRITES. `author` and its derived links are UNSET, not replaced. Most of
 * these are corporate or anonymous imprints — a Frankfurt fair catalogue was
 * compiled by the fair's booksellers, a Habsburg banned-book list by the Aulic
 * Commission — so no personal name is the right answer, and inventing one would
 * substitute a second fabrication for the first. An unset author renders as
 * unattributed, which is what these records honestly are.
 *
 * Note these are real books worth holding: the *Catalogus Librorum a Commissione
 * Aulica Prohibitorum* is a Habsburg censorship record and a primary source for
 * the history of the book trade. Only the attribution is wrong.
 *
 * DELIBERATELY EXCLUDED. `69c774ad6a0f3d112faf9347` — *Bibliotheca Fratrum
 * Polonorum* (1668), flagged by the audit against Faustus Socinus (d. 1604). That
 * is a genuine posthumous collected edition of the Socinian corpus and Socinus is
 * its principal author. The detector cannot tell that from a catalogue; a human
 * can. This is why the audit is a review queue and never auto-writes.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-author-misattribution-3434.mjs            # dry-run
 *   node scripts/maintenance/repair-author-misattribution-3434.mjs --apply
 *   node scripts/maintenance/repair-author-misattribution-3434.mjs --revert   # from backup
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/author-misattribution-3434-backup.json';

// Hand-verified. Each entry: id, the wrong author, and why it is wrong.
const MISATTRIBUTED = [
  // ── Heinrich Khunrath (d. 1605) — 18th-c. censorship lists and catalogues ──
  { id: '69b51df1efd8df28f2dadfad', wrong: 'Heinrich Khunrath', year: 1751, why: 'Halle library accession report; Khunrath d. 1605' },
  { id: '69b51df5768235dc6598a621', wrong: 'Heinrich Khunrath', year: 1758, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51df5261c58d63664d47a', wrong: 'Heinrich Khunrath', year: 1758, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51df5cf111105c4294131', wrong: 'Heinrich Khunrath', year: 1762, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51df647b06ecd58187baa', wrong: 'Heinrich Khunrath', year: 1763, why: 'bookseller index librorum' },
  { id: '69b51df6768235dc6598a6e2', wrong: 'Heinrich Khunrath', year: 1765, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51df7efd8df28f2dae884', wrong: 'Heinrich Khunrath', year: 1765, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51df7cf111105c42942d9', wrong: 'Heinrich Khunrath', year: 1768, why: 'Habsburg Aulic Commission banned-book list' },
  { id: '69b51dfd768235dc6598ae64', wrong: 'Heinrich Khunrath', year: 1791, why: 'chemical/alchemical book-sale Verzeichniß' },
  { id: '69b51e06cf111105c4295209', wrong: 'Heinrich Khunrath', year: 1810, why: 'Allgemeiner Anzeiger der Deutschen, a periodical' },
  // ── Gerhard Dorn (d. 1584) — late-18th-c. book auction catalogues ──
  { id: '69b51dfecf111105c4294c34', wrong: 'Gerhard Dorn', year: 1797, why: 'estate book-auction Verzeichniß; Dorn d. 1584' },
  { id: '69b51e05efd8df28f2daf369', wrong: 'Gerhard Dorn', year: 1806, why: 'chemical/alchemical book-sale Verzeichniß' },
  // ── Elias Ashmole (d. 1692) ──
  { id: '69b51e8f9a81ef7feb3d75e2', wrong: 'Elias Ashmole', year: 1809, why: "G. J. Manget's bookshop catalogue" },
  // ── Robert Fludd (d. 1637) ──
  { id: '69b51df6cf111105c4294244', wrong: 'Robert Fludd', year: 1765, why: 'book-auction catalogue of a rare-book collection' },
];

// Fields that carry or derive from the wrong attribution.
const ATTRIBUTION_FIELDS = ['author', 'author_id', 'author_entity_id', 'normalized_author'];

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP} — nothing to revert.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const row of saved.records) {
    const restore = {};
    for (const f of ATTRIBUTION_FIELDS) if (row.before[f] !== undefined) restore[f] = row.before[f];
    if (!Object.keys(restore).length) continue;
    const r = await books.updateOne({ id: row.id }, { $set: restore });
    n += r.modifiedCount;
  }
  console.log(`Reverted attribution fields on ${n} of ${saved.records.length} records from ${saved.created_at}.`);
  await mc.close();
  process.exit(0);
}

// ── read current state, verify each target still looks like what we verified ──
const ids = MISATTRIBUTED.map((m) => m.id);
const current = await books
  .find({ id: { $in: ids } },
        { projection: { id: 1, title: 1, author: 1, author_id: 1, author_entity_id: 1, normalized_author: 1, year: 1, visible: 1 } })
  .toArray();
const byId = new Map(current.map((b) => [b.id, b]));

console.log(`Targets: ${MISATTRIBUTED.length}   found in DB: ${current.length}\n`);

const actionable = [];
const skipped = [];
for (const m of MISATTRIBUTED) {
  const b = byId.get(m.id);
  if (!b) { skipped.push({ ...m, skip: 'not found in DB' }); continue; }
  if (b.author == null || b.author === '') { skipped.push({ ...m, skip: 'author already unset' }); continue; }
  // Guard: refuse to touch a record whose author is no longer the value we verified.
  // Someone may have corrected it by hand since; a blind unset would destroy that.
  if (String(b.author).trim() !== m.wrong) {
    skipped.push({ ...m, skip: `author changed since verification (now "${b.author}") — re-verify before touching` });
    continue;
  }
  actionable.push({ m, b });
}

for (const { m, b } of actionable) {
  console.log(`  ${m.id}  ${b.year}  "${b.author}"  ->  (unset)`);
  console.log(`      ${String(b.title).slice(0, 84)}`);
  console.log(`      ${m.why}`);
}
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  ${s.id}  ${s.skip}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN. ${actionable.length} records would have ${ATTRIBUTION_FIELDS.join(', ')} unset.`);
  console.log('Re-run with --apply to write.');
  await mc.close();
  process.exit(0);
}

// ── back up BEFORE writing, then write ───────────────────────────────────────
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({
  issue: 3434,
  created_at: new Date().toISOString(),
  note: 'Pre-repair attribution fields. Restore with --revert.',
  records: actionable.map(({ m, b }) => ({
    id: m.id,
    title: b.title,
    why: m.why,
    before: Object.fromEntries(ATTRIBUTION_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])),
  })),
}, null, 2));
console.log(`\nBackup written: ${BACKUP}`);

let modified = 0;
for (const { m } of actionable) {
  const r = await books.updateOne(
    { id: m.id, author: m.wrong },   // re-assert the guard at write time
    { $unset: Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, ''])),
      $set: {
        updated_at: new Date(),
        'field_provenance.author': {
          source: 'maintenance',
          method: 'manual-verification',
          script: 'repair-author-misattribution-3434.mjs',
          issue: 3434,
          date: new Date(),
          action: 'cleared',
          previous_value: m.wrong,
          note: m.why,
        },
      } },
  );
  modified += r.modifiedCount;
}
console.log(`APPLIED: cleared attribution on ${modified} of ${actionable.length} records.`);
if (modified !== actionable.length) {
  console.error(`WARNING: ${actionable.length - modified} writes did not match — re-run the audit before assuming success.`);
}

console.log('\nNext: these are visible books, so refresh the Supabase catalogue mirror');
console.log('and revalidate the affected /book and /author pages (see CLAUDE.md).');
await mc.close();
