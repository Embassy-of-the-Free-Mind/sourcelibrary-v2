#!/usr/bin/env node
/**
 * Ingest verified prior-translation credits into books.prior_translation (issue #3026).
 *
 * Input: the adversarially-verified sweep output (JSONL, one record per book)
 * produced by the Sonnet parse+verify workflow. Each record carries a parsed
 * edition, a verification block, and a publishable verdict.
 *
 * THE GATE (same bar as quotes — verified, not trusted): we write ONLY records
 * that are publishable AND verified AND carry a resolvable http(s) URL. A named
 * translator with no reachable source is exactly the fabrication risk the whole
 * first-translation stack exists to prevent — those never ship. We also refuse
 * to write a credit onto a book we currently badge as a FIRST translation
 * (is_first_translation true with pages translated): a verified prior and a
 * first badge contradict each other, and that conflict is a human-review item,
 * not something to paper over.
 *
 * Default is DRY-RUN. Pass --apply to write. --limit N caps writes.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ingest-prior-translations.mjs --in <file.jsonl>            # dry-run
 *   node scripts/maintenance/ingest-prior-translations.mjs --in <file.jsonl> --apply    # write
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const APPLY = args.includes('--apply');
const IN = getArg('--in', null);
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;
const REPORT = getArg('--report', null);

if (!IN) {
  console.error('Missing --in <verified-sweep.jsonl>');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set — source .env.production.local first');
  process.exit(1);
}

const URL_RE = /^https?:\/\/\S+$/i;

/** Map a sweep record → the PriorTranslationCredit doc, or a rejection reason. */
function toCredit(rec, nowIso) {
  if (!rec || !rec.book_id) return { skip: 'no book_id' };
  if (!rec.publishable) return { skip: 'not marked publishable' };
  if (!rec.verified) return { skip: 'not verified' };
  const p = rec.parsed || {};
  const v = rec.verification || {};
  const url = (v.url || '').trim();
  if (!URL_RE.test(url)) return { skip: 'no resolvable url' };
  const work_title = (p.work_title || '').trim();
  if (!work_title) return { skip: 'no work_title' };

  const translators = Array.isArray(p.translators)
    ? p.translators.map((s) => String(s).trim()).filter(Boolean).filter((s) => !/^unknown$/i.test(s))
    : [];
  const scope = ['complete', 'partial', 'unclear'].includes(p.scope) ? p.scope : 'unclear';
  const method = ['worldcat', 'publisher', 'google_books', 'library_catalog', 'other'].includes(v.method)
    ? v.method
    : 'other';

  const credit = {
    work_title,
    translators,
    scope,
    url,
    verification_method: method,
    verified_at: nowIso,
  };
  if (Number.isInteger(p.year)) credit.year = p.year;
  if (p.publisher) credit.publisher = String(p.publisher).trim();
  if (p.series) credit.series = String(p.series).trim();
  if (v.oclc) credit.oclc = String(v.oclc).trim();
  if (v.isbn) credit.isbn = String(v.isbn).trim();
  if (v.evidence) credit.evidence = String(v.evidence).trim();
  if (rec.attempt_id) credit.source_attempt_id = String(rec.attempt_id);
  return { credit };
}

async function main() {
  const nowIso = new Date().toISOString();
  const lines = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean);
  const recs = lines.map((l) => JSON.parse(l));
  console.log(`Loaded ${recs.length} sweep records from ${IN}`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const books = db.collection('books');

  const stats = { total: recs.length, publishable: 0, skipped: {}, firstBadgeConflict: 0, notFound: 0, wrote: 0 };
  const conflicts = [];
  const toWrite = [];

  for (const rec of recs) {
    const { credit, skip } = toCredit(rec, nowIso);
    if (skip) {
      stats.skipped[skip] = (stats.skipped[skip] || 0) + 1;
      continue;
    }
    stats.publishable++;

    // Resolve the book by string id OR Mongo _id.
    const or = [{ id: String(rec.book_id) }];
    if (/^[0-9a-f]{24}$/.test(String(rec.book_id))) or.push({ _id: new ObjectId(String(rec.book_id)) });
    const book = await books.findOne(
      { $or: or },
      { projection: { _id: 1, id: 1, title: 1, is_first_translation: 1, pages_translated: 1 } },
    );
    if (!book) {
      stats.notFound++;
      continue;
    }

    // Never overwrite a live first-translation badge with a "prior exists" credit.
    if (book.is_first_translation && (book.pages_translated ?? 0) > 0) {
      stats.firstBadgeConflict++;
      conflicts.push({ book_id: String(rec.book_id), title: book.title, credit });
      continue;
    }

    toWrite.push({ _id: book._id, id: book.id, title: book.title, credit });
  }

  console.log('\n── Gate summary ──');
  console.log(`  publishable (verified + linked): ${stats.publishable}`);
  console.log(`  first-badge conflicts (need review, NOT written): ${stats.firstBadgeConflict}`);
  console.log(`  book not found: ${stats.notFound}`);
  console.log(`  writable: ${toWrite.length}`);
  console.log('  skips:', JSON.stringify(stats.skipped));

  if (REPORT) {
    writeFileSync(REPORT, JSON.stringify({ nowIso, stats, conflicts, toWrite: toWrite.map(w => ({ id: w.id, title: w.title, credit: w.credit })) }, null, 2));
    console.log(`\nWrote report → ${REPORT}`);
  }

  const batch = LIMIT ? toWrite.slice(0, LIMIT) : toWrite;
  console.log('\n── Sample (first 5 writable) ──');
  for (const w of batch.slice(0, 5)) {
    const t = w.credit.translators.join(', ') || '—';
    console.log(`  ${w.title} → "${w.credit.work_title}" trans. ${t}${w.credit.year ? ` (${w.credit.year})` : ''} [${w.credit.verification_method}] ${w.credit.url}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN. Would write ${batch.length} credits. Re-run with --apply to write.`);
    await client.close();
    return;
  }

  for (const w of batch) {
    const r = await books.updateOne({ _id: w._id }, { $set: { prior_translation: w.credit } });
    if (r.modifiedCount === 1 || r.matchedCount === 1) stats.wrote++;
  }
  console.log(`\nAPPLIED. Wrote prior_translation to ${stats.wrote} books.`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
