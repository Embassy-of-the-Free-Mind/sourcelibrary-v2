#!/usr/bin/env node
/**
 * What we hold from one contributing library, and what we still need from it.
 *
 * READ-ONLY. Writes nothing to any database; prints a CSV and a summary.
 *
 * ## Why this exists
 *
 * When a source institution blocks us (Wellcome's WAF, #4311; IA's firewall;
 * Gallica's 429s) the honest response is to ask them for a sanctioned rate
 * rather than engineer around it — and the first thing any librarian will ask
 * is "what exactly have you taken, and what exactly do you want?". Answering
 * that from memory produces a number nobody can check. This produces a
 * per-book sheet they can open in Excel and audit against their own catalogue.
 *
 * It is deliberately shaped for an EXTERNAL reader, not for us: every row
 * carries the institution's own work URL and identifier first, so they can
 * join it to their records, and the column names say what happened in plain
 * words ("pages_we_have_copied") rather than in our field names.
 *
 * ## What "copied" means here
 *
 * The three archive tiers must never be summed (`scripts/lib/archive-coverage.mjs`,
 * #4239), so this reports the RECORD tier only and says so:
 *
 *   pages_we_have_copied   — a page doc claims a full-size object on our storage
 *                            (RecordState.MASTER_OR_DERIVATIVE)
 *   pages_display_only     — we hold only a reduced display copy, the original
 *                            still lives on the institution's server
 *                            (RecordState.DERIVATIVE_ONLY)
 *   pages_still_needed     — everything not in the first bucket: what a
 *                            resumed fetch would request
 *
 * It does NOT verify that those objects exist (FILE tier) or that they are at
 * native resolution (MASTER tier) — both cost network requests against the
 * institution we are about to write to. Run `scripts/audit/archive-coverage.mjs`
 * for those, sampled and paced.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/provider-scope-report.mjs --provider wellcome
 *   node scripts/audit/provider-scope-report.mjs --provider wellcome --csv /tmp/wellcome.csv
 *   node scripts/audit/provider-scope-report.mjs --provider mdz --summary-only
 *
 * `--provider` takes an `image_source.provider` key (see
 * `src/lib/types/image-source.ts`). Some institutions have more than one key
 * (`mdz`/`bsb`, `vatican`/`vatlib`) — pass them comma-separated.
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { classifyPageRecord, RecordState } from '../lib/archive-coverage.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i < 0 ? d : (argv[i + 1] ?? d);
};
const flag = (k) => argv.includes(k);

const providers = String(arg('--provider', '')).split(',').map(s => s.trim()).filter(Boolean);
const csvPath = arg('--csv', null);
const summaryOnly = flag('--summary-only');

if (!providers.length) {
  console.error('Usage: node scripts/audit/provider-scope-report.mjs --provider <key>[,<key>] [--csv path]');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Run: set -a; source .env.production.local; set +a');
  process.exit(1);
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

try {
  const books = await db.collection('books')
    .find({ 'image_source.provider': { $in: providers } })
    .toArray();

  if (!books.length) {
    console.error(`No books with image_source.provider in [${providers.join(', ')}].`);
    process.exit(2);
  }

  // A book is keyed by `id` when it has one and by `_id` otherwise — 16,343
  // books carry a re-minted `_id`, and an `_id`-only join silently finds zero
  // pages for them (invariants/book-deletion-and-identity.md).
  const bookKey = (b) => b.id || String(b._id);
  const keys = books.map(bookKey);

  // Pull only the fields classifyPageRecord reads. Page docs carry OCR text,
  // so an unprojected fetch over 40K pages moves hundreds of MB for nothing.
  //
  // Read in book-sized batches rather than one long cursor: a single stream
  // over tens of thousands of pages ran long enough to be killed by an Atlas
  // connection reset, losing the whole pass. Each batch is a short query that
  // can be retried on its own.
  const PROJECTION = { book_id: 1, archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, display_photo: 1, thumbnail_blob: 1, image_thumb: 1 };
  const BOOKS_PER_BATCH = 8;

  const tally = new Map(keys.map(k => [k, { pages: 0, copied: 0, displayOnly: 0, external: 0, failed: 0, none: 0 }]));

  for (let i = 0; i < keys.length; i += BOOKS_PER_BATCH) {
    const batch = keys.slice(i, i + BOOKS_PER_BATCH);
    let pages;
    for (let attempt = 1; ; attempt++) {
      try {
        pages = await db.collection('pages').find({ book_id: { $in: batch } }, { projection: PROJECTION }).toArray();
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        console.error(`  batch ${i / BOOKS_PER_BATCH + 1}: ${err.message} — retry ${attempt}/2`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    for (const page of pages) {
      const t = tally.get(page.book_id);
      if (!t) continue;
      t.pages++;
      switch (classifyPageRecord(page).state) {
        case RecordState.MASTER_OR_DERIVATIVE: t.copied++; break;
        case RecordState.DERIVATIVE_ONLY: t.displayOnly++; break;
        case RecordState.EXTERNAL_ONLY: t.external++; break;
        case RecordState.FAILED: t.failed++; break;
        default: t.none++;
      }
    }
  }

  const rows = books
    .map(b => ({ b, t: tally.get(bookKey(b)) }))
    .sort((x, y) => (y.t.pages - x.t.pages) || String(x.b.title || '').localeCompare(String(y.b.title || '')));

  const header = [
    'institution_work_url', 'institution_identifier', 'iiif_manifest',
    'title', 'author', 'year', 'language', 'license_as_recorded',
    'pages_held', 'pages_we_have_copied', 'pages_display_copy_only', 'pages_still_needed',
    'pages_transcribed', 'published_on_source_library', 'source_library_url', 'first_imported',
  ];

  const lines = [header.join(',')];
  const totals = { books: 0, pages: 0, copied: 0, displayOnly: 0, needed: 0, transcribed: 0, published: 0, pageless: 0 };

  for (const { b, t } of rows) {
    const needed = t.pages - t.copied;
    totals.books++;
    totals.pages += t.pages;
    totals.copied += t.copied;
    totals.displayOnly += t.displayOnly;
    totals.needed += needed;
    totals.transcribed += b.pages_ocr || 0;
    if (b.visible) totals.published++;
    if (t.pages === 0) totals.pageless++;

    lines.push([
      b.image_source?.source_url || '',
      b.image_source?.identifier || '',
      b.image_source?.iiif_manifest || '',
      String(b.title || '').replace(/\s+/g, ' ').trim(),
      b.author || '',
      b.year || b.published || '',
      b.language || '',
      b.image_source?.license || '',
      t.pages,
      t.copied,
      t.displayOnly,
      needed,
      b.pages_ocr || 0,
      b.visible ? 'yes' : 'no — held back pending review',
      `https://sourcelibrary.org/book/${b.slug || bookKey(b)}`,
      b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : '',
    ].map(csvCell).join(','));
  }

  const csv = lines.join('\n') + '\n';
  if (csvPath) {
    writeFileSync(csvPath, csv);
    console.error(`Wrote ${rows.length} rows to ${csvPath}`);
  } else if (!summaryOnly) {
    process.stdout.write(csv);
  }

  const pct = (n) => totals.pages ? `${(100 * n / totals.pages).toFixed(1)}%` : 'n/a';
  console.error([
    '',
    `Provider(s): ${providers.join(', ')}    (RECORD tier only — see scripts/lib/archive-coverage.mjs)`,
    `  books held                 ${totals.books}${totals.pageless ? `  (${totals.pageless} with no page records — single-object artworks)` : ''}`,
    `  published on the site      ${totals.published}`,
    `  pages held                 ${totals.pages.toLocaleString()}`,
    `  pages copied to our store  ${totals.copied.toLocaleString()}  (${pct(totals.copied)})`,
    `  pages display-copy only    ${totals.displayOnly.toLocaleString()}  (${pct(totals.displayOnly)})`,
    `  pages still needed         ${totals.needed.toLocaleString()}  (${pct(totals.needed)})`,
    `  pages transcribed (OCR)    ${totals.transcribed.toLocaleString()}`,
    '',
  ].join('\n'));
} finally {
  await client.close();
}
