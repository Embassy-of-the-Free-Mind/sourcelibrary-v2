#!/usr/bin/env node
/**
 * BPH cover-quality audit — ranks BPH books by `read_count` and classifies
 * each cover thumbnail into one of: MISSING, BLANK, PLACEHOLDER, TINY, or OK.
 *
 * Step 1 of issue #1679. Read-only: never mutates the DB.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/bph-cover-quality.mjs               # writes audit docs
 *   node scripts/audit/bph-cover-quality.mjs --dry-run     # print summary only
 *   node scripts/audit/bph-cover-quality.mjs --top 100     # how many top entries to keep in output (default 200)
 *   node scripts/audit/bph-cover-quality.mjs --tenant bph  # override tenant slug (default: bph)
 *
 * Output files (when not --dry-run):
 *   .claude/docs/bph-cover-audit-2026-05-11.md   — markdown table
 *   .claude/docs/bph-cover-audit-2026-05-11.json — same data for tooling
 *
 * Classification rules:
 *   MISSING     — none of `image_display`, `image_thumb`, `thumbnail`, `thumbnail_blob` are set on the book.
 *   PLACEHOLDER — book has a thumbnail URL but the page it points at is a known
 *                 bad cover (digitizer-insert, library stamp, barcode, bookplate)
 *                 detected via OCR text patterns (same regex set as `scripts/fix-bad-covers.mjs`).
 *   BLANK       — the page used for the cover is classified as `blank` by the
 *                 OCR/blank-adjust pipeline (`pages.page_type === 'blank'`),
 *                 OR the OCR meta is `<page-type>blank</page-type>`.
 *   TINY        — the cover page's archived `image_width` or `image_height` is
 *                 under 200px (cheap signal of a bad crop or thumbnail-only source).
 *   OK          — none of the above; cover passes basic quality checks. Not
 *                 reported in the audit table (only counted in summary).
 *
 * Tenant filter: matches `tenant-library-loaders.ts` — `tenantId` resolved from
 * the `tenants` collection by `slug`, plus `image_source.provider === 'bph'`
 * and `visible: true`. The BPH tenant slug is `bph` (subdomain bph.sourcelibrary.org).
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TENANT_SLUG = (() => {
  const idx = args.indexOf('--tenant');
  return idx !== -1 ? args[idx + 1] : 'bph';
})();
const TOP_N = (() => {
  const idx = args.indexOf('--top');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 200;
})();
const AUDIT_DATE = '2026-05-11';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

// Same patterns as scripts/fix-bad-covers.mjs — keep in sync.
const BAD_COVER_PATTERNS = [
  /internet\s+archive/i,
  /digitized\s+by\s+google/i,
  /google\s+logo/i,
  /digitization\s+credit/i,
  /inserted\s+by\s+the\s+internet/i,
  /library\s+of\s+the\s+university/i,
  /digital\s+library/i,
  /california\s+digital/i,
  /barcode/i,
  /ex[\s\-.]?libris/i,
  /bookplate/i,
  /philosophia\s+hermetica/i,
  /bibliotheca\s+philosophica/i,
];

const TINY_THRESHOLD = 200; // px — width OR height under this is "tiny"
const BAD_PAGE_TYPES = new Set(['digitizer-insert', 'bookplate', 'exlibris']);

function isBadCoverOcr(ocrText) {
  if (!ocrText) return false;
  const head = ocrText.substring(0, 1500);
  return BAD_COVER_PATTERNS.some(p => p.test(head));
}

function isBlankOcr(ocrText) {
  if (!ocrText) return false;
  return /<page-type>\s*blank\s*<\/page-type>/i.test(ocrText) ||
         /<meta>\s*blank\b/i.test(ocrText);
}

function bookCoverUrl(book) {
  return book.image_display || book.image_thumb || book.thumbnail || book.thumbnail_blob || null;
}

function bookHasAnyCoverField(book) {
  return !!(book.image_display || book.image_thumb || book.thumbnail || book.thumbnail_blob);
}

function quoteCsv(s) {
  if (s == null) return '';
  const str = String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
  return str;
}

function bookUrl(book) {
  const slugOrId = book.slug || book.id;
  return `https://sourcelibrary.org/book/${slugOrId}`;
}

async function main() {
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 30_000,
    socketTimeoutMS: 180_000,
  });
  await client.connect();
  const db = client.db('bookstore');

  // Resolve tenant slug → tenantId (uuid).
  const tenant = await db.collection('tenants').findOne(
    { slug: TENANT_SLUG, status: { $ne: 'deleted' } },
    { projection: { id: 1, slug: 1, name: 1 } }
  );
  if (!tenant) {
    console.error(`Tenant with slug "${TENANT_SLUG}" not found.`);
    await client.close();
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name || tenant.slug} (${tenantId})`);

  // Fetch all BPH books with the fields we care about.
  const bookFilter = {
    tenantId,
    'image_source.provider': 'bph',
    visible: true,
  };

  const bookProjection = {
    _id: 0,
    id: 1, slug: 1, title: 1, display_title: 1, author: 1,
    read_count: 1, pages_count: 1,
    image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
    cover_page: 1,
  };

  const books = await db.collection('books')
    .find(bookFilter, { projection: bookProjection })
    .maxTimeMS(120_000)
    .toArray();

  console.log(`Fetched ${books.length} BPH books.`);

  // For each book, locate the page used for its cover and grade it.
  let progress = 0;
  const results = [];
  for (const book of books) {
    progress++;
    if (progress % 250 === 0) console.log(`  scanned ${progress}/${books.length}`);

    const url = bookCoverUrl(book);
    const hasCover = bookHasAnyCoverField(book);

    if (!hasCover) {
      results.push({
        id: book.id,
        slug: book.slug || null,
        title: book.title || '(untitled)',
        author: book.author || '',
        read_count: book.read_count || 0,
        state: 'MISSING',
        reason: 'no cover URL fields set',
        cover_url: null,
        cover_page_number: null,
        book_url: bookUrl(book),
      });
      continue;
    }

    // Find the page that backs the cover. Two strategies:
    // 1) book.cover_page exists → look up that page directly.
    // 2) Match the cover URL against page image fields.
    let coverPage = null;
    if (book.cover_page) {
      coverPage = await db.collection('pages').findOne(
        { book_id: book.id, page_number: book.cover_page },
        { projection: {
            page_number: 1, page_type: 1,
            image_width: 1, image_height: 1,
            cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1,
            image_display: 1, image_thumb: 1, thumbnail_blob: 1,
            'ocr.data': 1,
          },
          maxTimeMS: 10_000,
        }
      );
    }

    if (!coverPage && url) {
      coverPage = await db.collection('pages').findOne(
        {
          book_id: book.id,
          $or: [
            { image_display: url }, { image_thumb: url },
            { cropped_photo: url }, { archived_photo: url },
            { photo: url }, { photo_original: url }, { thumbnail_blob: url },
          ],
        },
        { projection: {
            page_number: 1, page_type: 1,
            image_width: 1, image_height: 1,
            'ocr.data': 1,
          },
          maxTimeMS: 10_000,
        }
      );
    }

    // Classification cascade — pick the most severe issue.
    const ocrText = coverPage?.ocr?.data || '';

    let state = 'OK';
    let reason = '';

    if (coverPage?.page_type === 'blank' || isBlankOcr(ocrText)) {
      state = 'BLANK';
      reason = `page ${coverPage?.page_number ?? '?'} classified as blank`;
    } else if (coverPage && (BAD_PAGE_TYPES.has(coverPage.page_type) || isBadCoverOcr(ocrText))) {
      state = 'PLACEHOLDER';
      reason = BAD_PAGE_TYPES.has(coverPage.page_type)
        ? `page_type=${coverPage.page_type}`
        : 'OCR matches digitizer-insert/library-stamp pattern';
    } else if (coverPage && (coverPage.image_width || coverPage.image_height)) {
      const w = coverPage.image_width || 0;
      const h = coverPage.image_height || 0;
      if ((w > 0 && w < TINY_THRESHOLD) || (h > 0 && h < TINY_THRESHOLD)) {
        state = 'TINY';
        reason = `cover image dims ${w}x${h} (under ${TINY_THRESHOLD}px)`;
      }
    }

    if (state === 'OK') continue;

    results.push({
      id: book.id,
      slug: book.slug || null,
      title: book.title || '(untitled)',
      author: book.author || '',
      read_count: book.read_count || 0,
      state,
      reason,
      cover_url: url,
      cover_page_number: coverPage?.page_number ?? null,
      book_url: bookUrl(book),
    });
  }

  // Sort by read_count desc, then by state severity, then by title.
  const STATE_ORDER = { MISSING: 0, BLANK: 1, PLACEHOLDER: 2, TINY: 3 };
  results.sort((a, b) => {
    if (b.read_count !== a.read_count) return b.read_count - a.read_count;
    if (STATE_ORDER[a.state] !== STATE_ORDER[b.state]) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
    return a.title.localeCompare(b.title);
  });

  // Summary.
  const counts = { MISSING: 0, BLANK: 0, PLACEHOLDER: 0, TINY: 0 };
  for (const r of results) counts[r.state]++;
  const okCount = books.length - results.length;

  console.log(`\n=== Summary ===`);
  console.log(`  Total BPH books:    ${books.length}`);
  console.log(`  OK:                 ${okCount}`);
  console.log(`  MISSING:            ${counts.MISSING}`);
  console.log(`  BLANK:              ${counts.BLANK}`);
  console.log(`  PLACEHOLDER:        ${counts.PLACEHOLDER}`);
  console.log(`  TINY:               ${counts.TINY}`);
  console.log(`  Total flagged:      ${results.length}`);

  if (DRY_RUN) {
    console.log('\n(--dry-run) skipping file output.');
    await client.close();
    return;
  }

  // Truncate to TOP_N for the markdown table (full list goes in JSON).
  const topResults = results.slice(0, TOP_N);

  // Build the markdown.
  const lines = [];
  lines.push(`# BPH cover-quality audit — ${AUDIT_DATE}`);
  lines.push('');
  lines.push(`Issue #1679, step 1. Read-only audit of BPH books with missing, blank, placeholder, or tiny cover thumbnails. Sorted by \`read_count\` so the most-visited broken covers come first.`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Bucket | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total BPH books | ${books.length} |`);
  lines.push(`| OK | ${okCount} |`);
  lines.push(`| MISSING | ${counts.MISSING} |`);
  lines.push(`| BLANK | ${counts.BLANK} |`);
  lines.push(`| PLACEHOLDER | ${counts.PLACEHOLDER} |`);
  lines.push(`| TINY | ${counts.TINY} |`);
  lines.push(`| **Total flagged** | **${results.length}** |`);
  lines.push('');
  lines.push(`## Top ${topResults.length} books to fix (by read_count)`);
  lines.push('');
  lines.push(`| # | State | Reads | Title | Author | Reason | Book |`);
  lines.push(`|---|---|---:|---|---|---|---|`);
  topResults.forEach((r, i) => {
    const title = quoteCsv(r.title).slice(0, 80);
    const author = quoteCsv(r.author).slice(0, 50);
    const reason = quoteCsv(r.reason).slice(0, 60);
    lines.push(`| ${i + 1} | ${r.state} | ${r.read_count} | ${title} | ${author} | ${reason} | [link](${r.book_url}) |`);
  });
  lines.push('');
  lines.push(`Full ranked list (all ${results.length} flagged books) is in \`bph-cover-audit-${AUDIT_DATE}.json\`.`);
  lines.push('');

  const outDir = resolve(REPO_ROOT, '.claude', 'docs');
  mkdirSync(outDir, { recursive: true });
  const mdPath = resolve(outDir, `bph-cover-audit-${AUDIT_DATE}.md`);
  const jsonPath = resolve(outDir, `bph-cover-audit-${AUDIT_DATE}.json`);

  writeFileSync(mdPath, lines.join('\n'));
  writeFileSync(jsonPath, JSON.stringify({
    audit_date: AUDIT_DATE,
    tenant: { slug: TENANT_SLUG, id: tenantId },
    counts: { ok: okCount, ...counts, total_flagged: results.length, total_books: books.length },
    results,
  }, null, 2));

  console.log(`\nWrote:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${jsonPath}`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
