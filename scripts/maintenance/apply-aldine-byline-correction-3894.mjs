#!/usr/bin/env node
/**
 * #3894 at scale — replace an Aldine IMPRINT with the author the page names.
 *
 * 85 books (67 visible) are catalogued under the single string
 * `Manuzio, Aldo, 1449 or 50-1515 & Torresanus, Andreas, de Asula`. That is not
 * a byline; it is the Aldine press partnership. #3894 measured 41 such books for
 * "Manuzio, Aldo" alone, so the defect is larger than the issue recorded.
 *
 * WHY THIS IS THE HIGH-VALUE CLASS, not a cosmetic one. `author-identity.md`:
 * a printer-as-author error costs a WORK-GRAPH EDGE, because the book mints a
 * singleton local `work_id` under the printer instead of joining the cluster its
 * siblings are in. Seven Ciceros catalogued under a press do not collocate with
 * each other or with any other Cicero we hold.
 *
 * WHY THE STANDING DETECTOR MISSED MOST OF THEM. `title-page-attribution.mjs`
 * reads `books.title` — a transcription of the title page — and flags 22 books
 * corpus-wide, 9 of them from this string. It cannot do better: 346 of the 603
 * books in its printer-dynasty scope come back NO_NAME, meaning the TITLE STRING
 * is silent. The scanned front matter is not. That is the gap this run fills.
 *
 * THE GATES, and what each removed:
 *   67 visible books read, one independent subagent each (the instrument
 *      benchmarked in #3982: subagent 17 / flash-lite 1, McNemar p = 0.00014).
 *   61 the reader named an author;  6 it said the page names nobody.
 *    1 SELF_NAMED — a Manuzio really is the author. Aldus wrote grammars and
 *      Paulus Manutius wrote the Cicero commentaries, so this is evidence FOR
 *      the catalogue. Never "corrected".
 *   34 held by deterministic screens (16 Sammelband, 16 role-conflict,
 *      6 also-dedicatee, 4 quote-not-on-page, 2 declined form…).
 *   26 reached an adversarial refuter, which killed 3 — all the same shape,
 *      "not one author's book": a volume printing Aeschines AGAINST Ctesiphon
 *      and Demosthenes in reply (two hands, so neither is the byline); a
 *      Castiglione whose dedication says the Stanze were "d'ambidue loro
 *      composte" with Cesare Gonzaga; and the *Pretiosa margarita novella*,
 *      which is Lacinius's compilation around Petrus Bonus's text.
 *   23 written.
 *
 * NAME NORMALISATION IS LOAD-BEARING HERE. Two readers returned "Niccolo
 * Machiavelli" and "Niccolò Machiavelli" for two copies of the same work. Writing
 * both would mint two author strings for one man and fragment exactly the
 * collocation this repair exists to restore.
 *
 * SAFETY. Dry run by default. Selects on the byline STILL being the Aldine
 * imprint, so a book somebody has since corrected is skipped, not overwritten.
 * Backup merges on book id, earliest `before` wins. Writes `books.author`,
 * mirrors `books_catalog.author` with `updated_at`, and records a
 * `field_provenance` row plus a `sweep_log` row — a ROW, never a new column.
 *
 * Usage:
 *   node --env-file=.env.production.local <this> --verdicts=<path>
 *   node --env-file=.env.production.local <this> --verdicts=<path> --apply
 *   node --env-file=.env.production.local <this> --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backups', 'apply-aldine-byline-correction-3894.json');
const RUN = 'aldine-byline-3894';
const IMPRINT = 'Manuzio, Aldo, 1449 or 50-1515 & Torresanus, Andreas, de Asula';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const VERDICTS = (process.argv.find((a) => a.startsWith('--verdicts=')) || '').split('=')[1];

// One canonical spelling per person. See the note above.
const CANON = new Map([['niccolo machiavelli', 'Niccolò Machiavelli']]);
const canonical = (n) => CANON.get(String(n).trim().toLowerCase()) ?? String(n).trim();

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
  return { ok: res.ok, status: res.status, rows: Array.isArray(b) ? b.length : 0 };
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

const v = JSON.parse(readFileSync(VERDICTS, 'utf8'));
console.log(`survived reader + screens + refuter: ${v.clean.length}\n`);

const backupRows = [], skipped = [];
let wrote = 0, sb = 0, prov = 0;
for (const p of v.clean) {
  const b = await books.findOne({ id: p.book_id }, { projection: { id: 1, author: 1, title: 1, visible: 1 } });
  if (!b) { skipped.push([p.book_id, 'not found']); continue; }
  if (b.visible !== true) { skipped.push([p.book_id, 'not visible']); continue; }
  if (b.author !== IMPRINT) { skipped.push([p.book_id, `byline changed since: ${b.author}`]); continue; }
  const name = canonical(p.author);

  console.log(`${APPLY ? 'WRITE' : 'would write'}  -> ${name.padEnd(34)} ${String(b.title).slice(0, 48)}`);
  backupRows.push({ book_id: p.book_id, before: b.author, after: name, at: new Date().toISOString() });
  if (!APPLY) continue;

  const r = await books.updateOne({ id: p.book_id }, { $set: { author: name } });
  if (r.modifiedCount !== 1) { console.log(`   !! modifiedCount ${r.modifiedCount}`); continue; }
  wrote++;
  const s = await supabaseSet(p.book_id, name);
  if (s.ok && s.rows > 0) sb++; else console.log(`   !! supabase ${JSON.stringify(s)}`);
  const pr = await db.collection('field_provenance').insertOne({
    book_id: p.book_id, field: 'author', value: name, source: 'titlepage-subagent-v1', run: RUN,
    previous_value: b.author,
    evidence: {
      as_printed: p.as_printed ?? null, quoted_line: p.quoted_line ?? null, page_number: p.page ?? null,
      reader_confidence: p.confidence ?? null, reader_reasoning: p.reasoning ?? null,
      refuter_verdict: p.refuter ? { refuted: p.refuter.refuted, confidence: p.refuter.confidence, reasoning: p.refuter.reasoning } : null,
      previous_value_is: 'an Aldine press imprint, not a byline (#3894)',
      method: 'independent subagent reader over the OCR attribution window, deterministic screens, adversarial refuter',
    },
    created_at: new Date().toISOString(),
  });
  if (pr.insertedId) prov++;
  await recordSweepAction(db, {
    sweep: 'aldine-byline-3894', book_id: p.book_id, action: 'printer-imprint-replaced-with-author',
    detail: { from: b.author, to: name, page_number: p.page ?? null },
  });
}
if (backupRows.length) mergeBackup(backupRows);

console.log(`\n-- ${APPLY ? 'applied' : 'dry run'} --`);
console.log(`  books written     : ${APPLY ? wrote : backupRows.length}${APPLY ? '' : ' (would)'}`);
if (APPLY) console.log(`  supabase mirrored : ${sb}`);
if (APPLY) console.log(`  provenance rows   : ${prov}`);
console.log(`  skipped           : ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
console.log(`\n  These stay T2 UNLINKED — the byline is now a real person, but nothing here`);
console.log(`  sets author_id. The work-graph edge is recovered only once they link.`);
await mc.close();
