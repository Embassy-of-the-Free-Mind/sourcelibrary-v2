#!/usr/bin/env node
/**
 * Five books, four strings, adjudicated BY HAND — no model in the loop.
 *
 * These came out of a manual read of the 47 "institutional" author strings in
 * the T2 UNLINKED pool (451 books). Most of that bucket is a typing question
 * for a person to answer; these four are not — they are unambiguous defects
 * where the correct value is legible from the record itself, and each is keyed
 * on the book id because the pairing is what is wrong, not the name (#3434's
 * rule for choosing a repair key).
 *
 * 1. `Nicolaus Leonicenus , Niccolò Leoniceno , Aldo Manuzio , British Museum
 *    Dept . of Printed Books , Erasmus Press`  ->  `Niccolò Leoniceno`
 *    *De morbo gallico*, 1497 — Leoniceno's treatise on syphilis. The string
 *    concatenates FIVE agents, two of which are the SAME MAN in two languages
 *    (Nicolaus Leonicenus = Niccolò Leoniceno), plus the printer, plus a
 *    holding library's department, plus a modern press. `publisher` already
 *    correctly reads "Aldus Manutius", so the printer is not being lost.
 *    The thesaurus already holds `niccolo-leoniceno` anchored to Q711573, so
 *    this book can join a real author page the next time the linker runs.
 *
 * 2. `Catholic Church creator`  ->  `Catholic Church`   (2 books)
 *    Two Books of Hours, 1470 and 1485. `creator` is a metadata FIELD NAME that
 *    leaked into the value during import — the same shape as #3434, where a
 *    search string was written into `books.author`. "Catholic Church" is the
 *    standard corporate heading for a Book of Hours and is correct once the
 *    stray token is gone. It stays a corporate heading: it must never be minted
 *    as a person (#3483).
 *
 * 3. `Buddhaghosa; Müller, Edward (ed.); Pali Text Society`  ->  `Buddhaghosa`
 *    The *Atthasālinī* is Buddhaghosa's own commentary on the Dhammasaṅgaṇī.
 *    Edward Müller is the PTS editor of the 1897 edition and the Pali Text
 *    Society is its publisher; neither wrote it. Promoting an editor is the
 *    error `author-identity.md` warns about, so the compound is reduced to the
 *    author only. Thesaurus doc `buddhaghosa` exists, anchored to Q335247.
 *
 * 4. `Jacob ibn Habib (Romm Press, Vilna)`  ->  `Jacob ibn Habib`
 *    *Ein Yaakov*, Vilna 1883. Romm Press is the printer. Two independent
 *    records agree on the author: the catalogue string itself and
 *    `ai_metadata.author`, which reads "Jacob ibn Habib" with no press. No
 *    thesaurus doc yet, so this stays T2 until one is minted.
 *
 * NOT CHANGED, deliberately, though a classifier flagged them:
 *   `Temple Stanyan`  — a REAL PERSON (English historian, *The Grecian
 *      History*, 1774). My institution regex matched the word "Temple". The
 *      data is right and the classifier was wrong; nothing to repair.
 *   `One of the Old School (Gravener Henson, attrib.)` — a pseudonym plus the
 *      attributed real person. Ugly, but it names him. Matched on "School".
 *   `Council of Trent (1545-1563)` / `Council of Trent; Pope Pius IV`,
 *   `Imperial Astronomical Bureau` / `Qing Imperial Astronomical Bureau` —
 *      one body under two strings each. Merging them is a cataloguing decision
 *      about corporate heading form, not a defect fix, and belongs with a human.
 *   The ~446 Bhutanese monastery books — the monastery is the manuscript
 *      WITNESS and the only record of where the collection is held
 *      (`contributing_library` is the British Library, i.e. the digitiser).
 *      Clearing it would destroy provenance; it needs a home, not a delete.
 *
 * Writes `books.author` only. Mirrors `books_catalog.author` with `updated_at`,
 * records a `field_provenance` row and a `sweep_log` row. No new books field.
 * Dry run by default; selects on the old value so it cannot double-apply.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-hand-adjudicated-authors-2026-08-18.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-hand-adjudicated-authors-2026-08-18.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-hand-adjudicated-authors-2026-08-18.mjs --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backups', 'repair-hand-adjudicated-authors-2026-08-18.json');
const RUN = 'hand-adjudicated-authors-2026-08-18';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const REPAIRS = [
  { from: 'Nicolaus Leonicenus , Niccolò Leoniceno , Aldo Manuzio , British Museum Dept . of Printed Books , Erasmus Press',
    to: 'Niccolò Leoniceno',
    why: 'five agents concatenated, two of them the same man in two languages; printer already in `publisher`' },
  { from: 'Catholic Church creator', to: 'Catholic Church',
    why: 'the word "creator" is a metadata field name that leaked into the value on import (#3434 shape)' },
  { from: 'Buddhaghosa; Müller, Edward (ed.); Pali Text Society', to: 'Buddhaghosa',
    why: 'Müller is the 1897 PTS editor and PTS the publisher; the Atthasalini is Buddhaghosa\'s own commentary' },
  { from: 'Jacob ibn Habib (Romm Press, Vilna)', to: 'Jacob ibn Habib',
    why: 'Romm Press is the printer; ai_metadata.author independently reads "Jacob ibn Habib"' },
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function supabaseSet(id, author) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ author, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, rows: Array.isArray(b) ? b.length : 0 };
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
  if (!existsSync(BACKUP)) { console.error('no backup'); process.exit(1); }
  const { entries } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  let n = 0;
  for (const e of entries) {
    if (!APPLY) continue;
    const r = await books.updateOne({ id: e.book_id, author: e.after }, { $set: { author: e.before } });
    if (r.modifiedCount) n++;
    await supabaseSet(e.book_id, e.before);
  }
  console.log(APPLY ? `reverted ${n} of ${entries.length}` : `would revert ${entries.length} (add --apply)`);
  await mc.close(); process.exit(0);
}

const backupRows = [];
let wrote = 0, sb = 0, prov = 0;
for (const rep of REPAIRS) {
  const docs = await books.find({ author: rep.from }, { projection: { id: 1, title: 1, author: 1, visible: 1 } }).toArray();
  if (!docs.length) { console.log(`(no books still carry) ${rep.from.slice(0, 60)}`); continue; }
  for (const b of docs) {
    console.log(`${APPLY ? 'WRITE' : 'would write'}  -> ${rep.to.padEnd(20)} ${String(b.title).slice(0, 46)}`);
    console.log(`        why: ${rep.why}`);
    backupRows.push({ book_id: b.id, before: b.author, after: rep.to, at: new Date().toISOString() });
    if (!APPLY) continue;
    const r = await books.updateOne({ id: b.id }, { $set: { author: rep.to } });
    if (r.modifiedCount !== 1) { console.log(`   !! modifiedCount ${r.modifiedCount}`); continue; }
    wrote++;
    const s = await supabaseSet(b.id, rep.to);
    if (s.ok && s.rows > 0) sb++; else console.log(`   !! supabase ${JSON.stringify(s)}`);
    const pr = await db.collection('field_provenance').insertOne({
      book_id: b.id, field: 'author', value: rep.to, source: 'hand-adjudicated', run: RUN,
      previous_value: b.author,
      evidence: { rationale: rep.why, adjudicated_by: 'human-reviewed record, no model verdict used' },
      created_at: new Date().toISOString(),
    });
    if (pr.insertedId) prov++;
    await recordSweepAction(db, {
      sweep: 'hand-adjudicated-authors-2026-08', book_id: b.id,
      action: 'author-string-repaired-by-hand', detail: { from: b.author, to: rep.to, why: rep.why },
    });
  }
}
if (backupRows.length) mergeBackup(backupRows);
console.log(`\n-- ${APPLY ? 'applied' : 'dry run'} --`);
console.log(`  books written    : ${APPLY ? wrote : backupRows.length}${APPLY ? '' : ' (would)'}`);
if (APPLY) { console.log(`  supabase mirrored: ${sb}`); console.log(`  provenance rows  : ${prov}`); }
await mc.close();
