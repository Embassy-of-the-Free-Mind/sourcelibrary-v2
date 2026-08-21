#!/usr/bin/env node
/**
 * Resolve the "Corpus juris civilis" author heading (#3483 follow-up).
 *
 * 13 books carry `author: "Corpus juris civilis"` — the name of the WORK, not a
 * person, so the thesaurus quarantined it and `/author/corpus-juris-civilis`
 * rendered a legal corpus as an author. Unlike the rest of the #3483 set this
 * one is not resolved by clearing: the books really are Justinian's
 * codification, and standard cataloguing practice enters those parts under
 * Justinian I (VIAF/Wikidata Q41866). The corpus already holds 9 books under a
 * "Justinian" string and a canonical `justinian-i` thesaurus doc, so attributing
 * them joins an existing authority rather than inventing one.
 *
 * But NOT every book under the heading is Justinian's, which is exactly why this
 * needed a per-book pass instead of one `updateMany`. Three classes of thing sit
 * under the same heading:
 *
 *   - the codification itself (Institutes, Digest/Pandects, Codex, Novellae,
 *     Edicta) — Justinian I;
 *   - the *Consuetudines Feudorum* (Libri Feudorum), medieval Lombard feudal law
 *     appended to printed editions of the Corpus centuries after Justinian —
 *     not his, and conventionally not entered under him;
 *   - apparatus and commentary — a 1572 commentary on the Twelve Tables, an
 *     index to the Pandects, a concordance of rubrics — separate works by other
 *     hands, printed alongside.
 *
 * The last two get an unset author, on the same reasoning as the rest of #3483:
 * an honest blank beats a confident wrong name.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-corpus-juris-attribution-3483.mjs            # dry-run
 *   node scripts/maintenance/repair-corpus-juris-attribution-3483.mjs --apply
 *   node scripts/maintenance/repair-corpus-juris-attribution-3483.mjs --revert
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const BACKUP = 'scripts/output/corpus-juris-attribution-3483-backup.json';

const WRONG = 'Corpus juris civilis';
const JUSTINIAN = { author: 'Justinian I', author_id: 'justinian-i' };

/** Hand-classified against each title page. */
const RECORDS = [
  // ── Justinian's codification ──
  { id: '69b62f531c1c21a3737f4a23', to: 'justinian', why: 'Digest/Pandects — "Juris enucleati ex omni vetere jure collecti"' },
  { id: '69b62f561c1c21a3737f4da3', to: 'justinian', why: 'Codex repetitae praelectionis' },
  { id: '69b62f591c1c21a3737f4f91', to: 'justinian', why: 'Authenticae seu Novellae constitutiones' },
  { id: '69b62f5b1c1c21a3737f503f', to: 'justinian', why: 'Edicta of Justinian (with later imperial edicts appended)' },
  { id: '69b62f601c1c21a3737f50b3', to: 'justinian', why: 'Institutionum Juris libri IIII' },
  { id: '69b62f6d1c1c21a3737f5c9f', to: 'justinian', why: 'Edicta + constitutiones of Justinian' },
  { id: '69b62f711c1c21a3737f5e4f', to: 'justinian', why: 'Institutionum Juris libri IIII (second copy)' },
  { id: '69b62f6a1c1c21a3737f54ff', to: 'justinian', why: 'Codex repetitae praelectionis, 1607' },
  // ── not Justinian: later law, apparatus, commentary ──
  { id: '69b62f5d1c1c21a3737f508d', to: 'unset', why: 'Consuetudines Feudorum — medieval Lombard feudal law, not Justinian' },
  { id: '69b62f6f1c1c21a3737f5dc5', to: 'unset', why: 'Consuetudines Feudorum (second copy)' },
  { id: '69b62fff1c1c21a3737fd436', to: 'unset', why: '1572 commentary on the Twelve Tables — a separate work' },
  { id: '69b6454418b87551bfc3a133', to: 'unset', why: 'Index rerum et verborum to the Pandects — apparatus' },
  { id: '69b630301c1c21a3737fe842', to: 'unset', why: 'Concordance of rubrics of both laws — apparatus' },
];

const ATTRIBUTION_FIELDS = ['author', 'author_id', 'author_entity_id', 'normalized_author'];

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP} — nothing to revert.`); process.exit(1); }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const row of saved.records) {
    const restore = {};
    for (const f of ATTRIBUTION_FIELDS) if (row.before[f] !== undefined) restore[f] = row.before[f];
    const unset = ATTRIBUTION_FIELDS.filter((f) => row.before[f] === undefined);
    const op = {};
    if (Object.keys(restore).length) op.$set = restore;
    if (unset.length) op.$unset = Object.fromEntries(unset.map((f) => [f, '']));
    if (!Object.keys(op).length) continue;
    n += (await books.updateOne({ id: row.id }, op)).modifiedCount;
  }
  console.log(`Reverted ${n} of ${saved.records.length} records from ${saved.created_at}.`);
  await mc.close();
  process.exit(0);
}

const current = await books
  .find({ id: { $in: RECORDS.map((r) => r.id) } },
        { projection: { id: 1, title: 1, author: 1, author_id: 1, author_entity_id: 1, normalized_author: 1, year: 1, visible: 1 } })
  .toArray();
const byId = new Map(current.map((b) => [b.id, b]));

const actionable = [];
for (const r of RECORDS) {
  const b = byId.get(r.id);
  if (!b) { console.warn(`  ! ${r.id} not found — skipping`); continue; }
  // Guard: only touch records still wearing the heading we classified against.
  if (String(b.author ?? '').trim() !== WRONG) {
    console.warn(`  ! ${r.id} author is now "${b.author}" (expected "${WRONG}") — skipping, re-verify`);
    continue;
  }
  actionable.push({ r, b });
}

for (const { r, b } of actionable) {
  const dest = r.to === 'justinian' ? '-> Justinian I' : '-> (unset)';
  console.log(`  ${b.year || '----'}  ${dest.padEnd(16)} ${String(b.title).slice(0, 62)}`);
  console.log(`        ${r.why}`);
}
const nJ = actionable.filter(({ r }) => r.to === 'justinian').length;
console.log(`\n${actionable.length} actionable: ${nJ} -> Justinian I, ${actionable.length - nJ} -> unset`);

if (!APPLY) {
  console.log('\nDRY-RUN. Re-run with --apply to write.');
  await mc.close();
  process.exit(0);
}

mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({
  issue: 3483,
  created_at: new Date().toISOString(),
  note: 'Pre-repair attribution fields. Restore with --revert.',
  records: actionable.map(({ r, b }) => ({
    id: b.id, title: b.title, to: r.to, why: r.why,
    before: Object.fromEntries(ATTRIBUTION_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])),
  })),
}, null, 2));
console.log(`\nBackup written: ${BACKUP}`);

let modified = 0;
for (const { r } of actionable) {
  const provenance = {
    source: 'maintenance',
    method: 'manual-verification',
    script: 'repair-corpus-juris-attribution-3483.mjs',
    issue: 3483,
    date: new Date(),
    action: r.to === 'justinian' ? 'corrected' : 'cleared',
    previous_value: WRONG,
    note: r.why,
  };
  const update = r.to === 'justinian'
    ? { $set: { ...JUSTINIAN, updated_at: new Date(), 'field_provenance.author': provenance },
        $unset: { author_entity_id: '', normalized_author: '' } }
    : { $unset: Object.fromEntries(ATTRIBUTION_FIELDS.map((f) => [f, ''])),
        $set: { updated_at: new Date(), 'field_provenance.author': provenance } };
  modified += (await books.updateOne({ id: r.id, author: WRONG }, update)).modifiedCount;
}
console.log(`APPLIED: ${modified} of ${actionable.length} records updated.`);
if (modified !== actionable.length) {
  console.error(`WARNING: ${actionable.length - modified} writes did not match — re-check before assuming success.`);
}
console.log('\nNext: sync books_catalog, then revalidate /author/justinian-i and the affected /book pages.');
await mc.close();
