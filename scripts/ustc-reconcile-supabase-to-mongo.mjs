#!/usr/bin/env node
/**
 * Phase 1 of GitHub #1809 — USTC ↔ Source Library reconciliation.
 *
 * Source Library has 4,187 USTC editions in Supabase with `source_library_id`
 * set, covering ~1,754 distinct Mongo books. Copy that linkage back onto each
 * Mongo book as `ustc_id` (= the USTC serial number `sn`).
 *
 * Per book:
 *   - Pick the USTC edition whose `year` is closest to the book's year as the
 *     primary `ustc_id`. Ties broken by smallest sn (earliest record).
 *   - Store all linked editions in `ustc_match.alternatives` for reference.
 *   - Stamp `field_provenance.ustc_id.source = 'supabase-reconciliation'`.
 *
 * Skips books that already have `ustc_id` set (unless --force).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/ustc-reconcile-supabase-to-mongo.mjs           # dry-run
 *   set -a; source .env.production.local; set +a; node scripts/ustc-reconcile-supabase-to-mongo.mjs --apply
 */

import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_ANON_KEY;

async function supaQuery(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchAllLinkedEditions() {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const rows = await supaQuery(
      `ustc_editions?in_source_library=eq.true&select=sn,id,source_library_id,title,author_1,year,language_1,country,place,format&limit=${limit}&offset=${offset}`,
    );
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

function pickPrimary(book, editions) {
  if (editions.length === 1) return editions[0];
  const bookYear = Number(book.year) || null;
  // Score: distance in years (lower = better). Books without a year fall back to smallest sn.
  return [...editions].sort((a, b) => {
    if (bookYear) {
      const da = Math.abs((a.year || 9999) - bookYear);
      const db = Math.abs((b.year || 9999) - bookYear);
      if (da !== db) return da - db;
    }
    return (a.sn || 0) - (b.sn || 0);
  })[0];
}

async function main() {
  console.log(`Phase 1: USTC ↔ Source Library reconciliation`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' --force' : ''}`);
  console.log();

  console.log(`Fetching all USTC editions with source_library_id set from Supabase…`);
  const editions = await fetchAllLinkedEditions();
  console.log(`  ${editions.length} rows fetched.`);

  // Group by source_library_id
  const grouped = new Map();
  for (const e of editions) {
    const sid = e.source_library_id;
    if (!sid) continue;
    if (!grouped.has(sid)) grouped.set(sid, []);
    grouped.get(sid).push(e);
  }
  console.log(`  ${grouped.size} distinct Mongo book IDs (${editions.length - grouped.size} additional editions across multi-edition books).`);

  // Connect Mongo
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Fetch each book to check current ustc_id and pick primary based on year
  const bookIds = [...grouped.keys()].map(s => {
    try { return new ObjectId(s); } catch { return null; }
  }).filter(Boolean);

  console.log(`Reading ${bookIds.length} books from Mongo…`);
  const cursor = books.find(
    { _id: { $in: bookIds } },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1, ustc_id: 1 } },
  );
  const bookList = await cursor.toArray();
  console.log(`  ${bookList.length} books found in Mongo.`);
  const missing = bookIds.length - bookList.length;
  if (missing > 0) console.log(`  ⚠ ${missing} source_library_id values in Supabase don't resolve to Mongo books (likely deleted/merged).`);

  // Tally + plan writes
  let willWrite = 0;
  let skipExisting = 0;
  let conflicts = 0;
  const ops = [];
  const samples = [];

  for (const book of bookList) {
    const sid = String(book._id);
    const linked = grouped.get(sid) || [];
    if (linked.length === 0) continue;

    const primary = pickPrimary(book, linked);

    if (book.ustc_id && !FORCE) {
      skipExisting++;
      if (book.ustc_id !== primary.sn) conflicts++;
      continue;
    }

    willWrite++;
    if (samples.length < 5) {
      samples.push({
        book: `${(book.title || '').slice(0, 50)} — ${(book.author || '').slice(0, 30)} (${book.year ?? '?'})`,
        bookId: book.id || sid,
        primary_sn: primary.sn,
        primary_year: primary.year,
        primary_title: (primary.title || '').slice(0, 60),
        total_editions: linked.length,
      });
    }

    ops.push({
      updateOne: {
        filter: { _id: book._id },
        update: {
          $set: {
            ustc_id: primary.sn,
            ustc_match: {
              ustc_sn: primary.sn,
              confidence: 'high',
              reasoning: `Reconciled from Supabase ustc_editions.source_library_id linkage (${linked.length} candidate edition${linked.length === 1 ? '' : 's'}); picked closest year to ${book.year ?? 'unknown'}.`,
              match_method: 'supabase_reconciliation',
              alternatives: linked.filter(e => e.sn !== primary.sn).slice(0, 10).map(e => ({
                ustc_sn: e.sn,
                title: (e.title || '').slice(0, 100),
                author: e.author_1 || '',
                year: e.year,
                reason_rejected: bookYearReason(book.year, e.year, primary.year),
              })),
              tools_called: [],
              matched_at: new Date(),
              model: 'reconciliation',
              cost_usd: 0,
            },
            'field_provenance.ustc_id': {
              source: 'supabase-reconciliation',
              method: 'closest-year',
              confidence: 'high',
              date: new Date(),
            },
            'field_provenance.ustc_match': {
              source: 'supabase-reconciliation',
              method: 'closest-year',
              confidence: 'high',
              date: new Date(),
            },
          },
        },
      },
    });
  }

  function bookYearReason(bookYear, candidateYear, pickedYear) {
    if (!bookYear) return `picked smaller sn`;
    return `book year ${bookYear}; this edition year ${candidateYear ?? '?'} (picked ${pickedYear ?? '?'})`;
  }

  console.log();
  console.log(`Reconciliation plan:`);
  console.log(`  Will write   : ${willWrite}`);
  console.log(`  Already set  : ${skipExisting}  ${conflicts > 0 ? `(${conflicts} would change — pass --force to overwrite)` : ''}`);
  console.log(`  Unresolved   : ${missing}`);
  console.log();
  console.log(`Sample writes:`);
  for (const s of samples) {
    console.log(`  [${s.bookId}] ${s.book}`);
    console.log(`     → USTC ${s.primary_sn} (${s.primary_year}) "${s.primary_title}"  [${s.total_editions} edition${s.total_editions === 1 ? '' : 's'} total]`);
  }

  if (APPLY) {
    if (ops.length === 0) {
      console.log(`\nNo writes to apply.`);
    } else {
      console.log(`\nApplying ${ops.length} writes to Mongo books collection…`);
      const result = await books.bulkWrite(ops, { ordered: false });
      console.log(`  matched: ${result.matchedCount}`);
      console.log(`  modified: ${result.modifiedCount}`);
    }
    const total = await books.countDocuments({ ustc_id: { $exists: true, $ne: null } });
    console.log(`\nTotal books with ustc_id after Phase 1: ${total}`);
  } else {
    console.log(`\n(dry run — no DB writes. Pass --apply to write.)`);
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
