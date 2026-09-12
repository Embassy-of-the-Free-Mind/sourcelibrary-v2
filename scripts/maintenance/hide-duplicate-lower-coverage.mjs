/**
 * Hide the weaker copy when the SAME digital object is held visible more than once.
 *
 * Pairs come from the fingerprint groups reported by
 * `scripts/audit/duplicate-fingerprint-groups.mjs` — records sharing a
 * `source_fingerprints` entry, i.e. the same scan, not merely a similar work.
 * That distinction is the whole safety argument: this script never decides that
 * two DIFFERENT books are duplicates, it only picks which copy of one scan the
 * reader sees.
 *
 * Keeper rule: most OCR'd and translated pages wins
 * (`pages_ocr*2 + pages_translated*3 + pages_count`). A TIE is left alone for a
 * human — if the two copies are equally complete there is no reason encoded here
 * to prefer either, and guessing would be the expensive error.
 *
 * Field semantics deliberately match POST /api/admin/duplicates so both paths
 * produce the same shape: `visible:false`, `hidden:true`,
 * `hidden_reason:'duplicate'`, `duplicate_of:<keeper>`, and `updated_at` bumped —
 * the books_catalog sync keys on `updated_at`, so without it the flip never
 * reaches Supabase and the book stays readable (lesson: a synced-column write
 * needs updated_at).
 *
 * Only ever hides a book that is CURRENTLY VISIBLE and has a strictly better
 * visible sibling. Never unhides, never deletes, never touches a book carrying a
 * DOI (a minted citation must not stop resolving).
 *
 * Dry run by default. `--apply` to write.
 *
 * After --apply you MUST also run, or the flip is invisible to readers:
 *   node scripts/workers/sync-books-catalog.mjs
 *   then purge/revalidate the affected /book/<slug> URLs.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const REPORT = process.argv.find(a => a.startsWith('--report='))?.split('=')[1]
  || '.claude/docs/archive/duplicate-fingerprint-groups-2026-08-30.json';

const score = d => (d.pages_ocr || 0) * 2 + (d.pages_translated || 0) * 3 + (d.pages_count || 0);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const groups = Array.isArray(report) ? report : (report.groups || []);
  const ids = [...new Set(groups.flatMap(g => (g.members || []).map(m => m.id || m)))];

  const docs = await books.find(
    { id: { $in: ids } },
    { projection: { id: 1, title: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, doi: 1 } }
  ).toArray();
  const byId = new Map(docs.map(d => [d.id, d]));

  const plan = [];
  let ties = 0, dois = 0, alreadyFine = 0;

  for (const g of groups) {
    const members = (g.members || []).map(m => byId.get(m.id || m)).filter(Boolean);
    const visible = members.filter(m => m.visible);
    if (visible.length < 2) { alreadyFine++; continue; }

    const ranked = [...visible].sort((a, b) => score(b) - score(a));
    const keeper = ranked[0];
    // A tie at the top means no encoded reason to prefer either copy. Leave it.
    if (score(ranked[1]) === score(keeper)) { ties++; continue; }

    for (const loser of ranked.slice(1)) {
      if (loser.doi) { dois++; continue; }
      plan.push({ hide: loser.id, keeper: keeper.id, loser, keeper_doc: keeper });
    }
  }

  console.log(`groups: ${groups.length}  |  already <=1 visible: ${alreadyFine}  |  ties left alone: ${ties}  |  skipped (has DOI): ${dois}`);
  console.log(`to hide: ${plan.length}\n`);
  for (const p of plan) {
    const l = p.loser, k = p.keeper_doc;
    console.log(`HIDE ${l.id}  ocr=${l.pages_ocr || 0} tr=${l.pages_translated || 0} pg=${l.pages_count || 0}  "${(l.title || '').slice(0, 50)}"`);
    console.log(`  keep ${k.id}  ocr=${k.pages_ocr || 0} tr=${k.pages_translated || 0} pg=${k.pages_count || 0}  "${(k.title || '').slice(0, 50)}"`);
  }

  if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); await client.close(); return; }

  let hidden = 0;
  for (const p of plan) {
    const now = new Date();
    const res = await books.updateOne(
      { id: p.hide, visible: true },   // re-assert visibility at write time
      { $set: { visible: false, hidden: true, hidden_reason: 'duplicate', duplicate_of: p.keeper, hidden_at: now, updated_at: now } }
    );
    hidden += res.modifiedCount;
  }
  console.log(`\nhidden: ${hidden} of ${plan.length} planned`);
  console.log('NEXT: node scripts/workers/sync-books-catalog.mjs  then purge the affected /book/<slug> URLs.');
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
