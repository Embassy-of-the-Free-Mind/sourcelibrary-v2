/**
 * Smart Cover Selection (OCR-based, no API calls)
 *
 * Picks the best cover by analyzing OCR text content — not just page_type,
 * but the actual descriptions, meta tags, and transcribed text.
 *
 * Cost: FREE
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/smart-cover-selection.mjs
 *   --dry-run       Preview changes
 *   --limit N       Process first N books
 *   --book-id ID    Process single book
 *   --skip-manual   Skip books with thumbnail_source: 'manual'
 *   --force         Re-evaluate all books (not just page-1 covers)
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_MANUAL = process.argv.includes('--skip-manual');
const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const BOOK_ID = (() => {
  const idx = process.argv.indexOf('--book-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const PROVIDER = (() => {
  const idx = process.argv.indexOf('--provider');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const SCAN_PAGES = 20;
const BATCH_SIZE = 50; // smaller batches since we fetch more OCR data

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

/**
 * Score a page as a potential cover based on OCR content analysis.
 * Returns { score, reason }.
 */
function scorePage(page) {
  const ocr = (page.ocr_text || '').toLowerCase();
  const pageType = page.page_type;
  const pageNum = page.page_number;
  let score = 0;
  let reason = pageType || 'unknown';

  // === NEGATIVE signals: things that make terrible covers ===

  // Blank pages
  if (pageType === 'blank' && !ocr.includes('title')) return { score: -100, reason: 'blank' };

  // Book binding / cover photos (external shots of the physical book)
  if (ocr.includes('front cover') || ocr.includes('external') && ocr.includes('cover') ||
      ocr.includes('binding') && ocr.includes('spine') || ocr.includes('fore-edge') ||
      ocr.includes('closed book') || ocr.includes('book block') ||
      ocr.includes('leather-bound') || ocr.includes('leather bound') ||
      (ocr.includes('blind-stamp') || ocr.includes('blind stamp')) && ocr.includes('cover')) {
    return { score: -80, reason: 'physical book photo' };
  }

  // Digitizer inserts and digital portal pages
  if (ocr.includes('digitized by') || ocr.includes('google books') ||
      ocr.includes('internet archive') && ocr.includes('logo') ||
      ocr.includes('proquest') || ocr.includes('early european books') ||
      ocr.includes('hathitrust') || ocr.includes('scan sheet') ||
      ocr.includes('e-rara.ch') || ocr.includes('www.e-rara') ||
      ocr.includes('gallica.bnf') || ocr.includes('mdz-nbn') ||
      ocr.includes('digital.staatsbibliothek') || ocr.includes('daten.digitale-sammlungen')) {
    return { score: -70, reason: 'digitizer insert' };
  }

  // BPH pelican bookplate (Embassy of the Free Mind / Bibliotheca Philosophica Hermetica)
  const isBphBookplate = (ocr.includes('pelican') && (ocr.includes('piety') || ocr.includes('nest') || ocr.includes('young') || ocr.includes('hermetica'))) ||
      ocr.includes('philosophia hermetica') || ocr.includes('philosophica hermetica');
  if (isBphBookplate && pageType !== 'title-page') {
    return { score: -65, reason: 'BPH pelican bookplate' };
  }

  // Ex-libris / bookplates — but only if the page is PRIMARILY a bookplate,
  // not a title page that happens to have a small ownership inscription
  const hasExLibris = ocr.includes('ex-libris') || ocr.includes('exlibris') || ocr.includes('ex libris') ||
      ocr.includes('bookplate') || (ocr.includes('ownership') && ocr.includes('stamp')) ||
      ocr.includes('library stamp') || ocr.includes('library sticker');
  if (hasExLibris && pageType !== 'title-page') {
    return { score: -60, reason: 'ex-libris/bookplate' };
  }

  // Bleed-through / ghosting pages
  if (ocr.includes('bleed-through') || ocr.includes('ghosting') ||
      ocr.includes('mirrored impression')) {
    return { score: -50, reason: 'bleed-through' };
  }

  // Tables of contents, indices
  if (pageType === 'toc' || pageType === 'index') return { score: -20, reason: pageType };

  // Colophon
  if (pageType === 'colophon') return { score: -10, reason: 'colophon' };

  // === POSITIVE signals: things that make great covers ===

  // Title pages with actual title text (centered headings in OCR)
  const hasHeadings = (ocr.match(/^#+ .+/gm) || []).length;
  const isTitlePage = pageType === 'title-page';
  const looksLikeTitlePage = !pageType && hasHeadings >= 3;

  if (isTitlePage) {
    score += 80;
    reason = 'title-page';
  } else if (looksLikeTitlePage) {
    score += 70;
    reason = 'likely title-page (headings)';
  }

  if (isTitlePage || looksLikeTitlePage) {
    // Bonus: publisher marks / imprints (Latin publishing terms)
    if (ocr.includes('excudebat') || ocr.includes('typis') || ocr.includes('apud') ||
        ocr.includes('impensis') || ocr.includes('sumptibus') || ocr.includes('officina') ||
        ocr.includes('printed by') || ocr.includes('published by') || ocr.includes('printed for')) {
      score += 15;
      reason = (isTitlePage ? 'title-page' : 'likely title-page') + ' with imprint';
    }

    // Bonus: decorative elements described in OCR
    if (ocr.includes('decorative') || ocr.includes('ornamental') || ocr.includes('border') ||
        ocr.includes('frame') || ocr.includes('vignette') || ocr.includes('woodcut') ||
        ocr.includes('architectural') || ocr.includes('printer\'s mark') ||
        ocr.includes('printer\'s device') || ocr.includes('colophon device')) {
      score += 20;
      reason = 'decorated title-page';
    }
  }

  // Frontispieces — but distinguish real frontispieces from binding photos
  if (pageType === 'frontispiece') {
    // Check if it's actually a physical cover photo mislabeled as frontispiece
    if (ocr.includes('cover') && (ocr.includes('leather') || ocr.includes('binding') || ocr.includes('marbled'))) {
      return { score: -80, reason: 'binding photo (mislabeled frontispiece)' };
    }

    score += 90;
    reason = 'frontispiece';

    // Bonus for engravings / allegorical imagery
    if (ocr.includes('engrav') || ocr.includes('allegor') || ocr.includes('portrait') ||
        ocr.includes('emblem') || ocr.includes('woodcut')) {
      score += 15;
      reason = 'frontispiece with engraving';
    }
  }

  // Illustrations
  if (pageType === 'illustration') {
    // Skip if it's a photo of the physical book
    if (ocr.includes('photograph') && (ocr.includes('fore-edge') || ocr.includes('book') && ocr.includes('closed'))) {
      return { score: -80, reason: 'physical book photo' };
    }
    score += 60;
    reason = 'illustration';
  }

  // Dedication pages — sometimes nice but not ideal
  if (pageType === 'dedication') {
    score += 15;
    reason = 'dedication';
  }

  // Plain text — lowest priority
  if (pageType === 'text' && score === 0) {
    score += 5;
    reason = 'text';
  }

  // === Position bonuses ===
  // Slight preference for earlier pages (covers are usually in first 10)
  if (pageNum <= 5) score += 5;
  else if (pageNum <= 10) score += 3;
  else if (pageNum > 15) score -= 3;

  return { score, reason };
}

function getPageImageUrl(page) {
  const isUsable = (u) => u && (u.startsWith('http://') || u.startsWith('https://'));
  if (isUsable(page.cropped_photo)) return page.cropped_photo;
  if (isUsable(page.archived_photo)) return page.archived_photo;
  if (page.archived_photo?.startsWith('failed:')) return null;
  if (isUsable(page.photo)) return page.photo;
  if (isUsable(page.photo_original)) return page.photo_original;
  return null;
}

// --- Main ---
console.log(`\n=== Smart Cover Selection (OCR-based) ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${FORCE ? ' (force re-evaluate all)' : ''}`);
if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : { pages_count: { $gt: 0 }, visible: true };

if (!BOOK_ID && SKIP_MANUAL) {
  bookQuery.thumbnail_source = { $ne: 'manual' };
}
if (!BOOK_ID && PROVIDER) {
  bookQuery['image_source.provider'] = PROVIDER;
}

const allBooks = await db.collection('books')
  .find(bookQuery, {
    projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1, _id: 0 }
  })
  .toArray();

console.log(`Found ${allBooks.length} books. Processing in batches of ${BATCH_SIZE}...\n`);

let checked = 0, upgraded = 0, skipped = 0, noData = 0;
const changes = [];

for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
  if (LIMIT && upgraded >= LIMIT) break;

  const batch = allBooks.slice(i, i + BATCH_SIZE);
  const batchBookIds = batch.map(b => b.id);

  // Get first SCAN_PAGES pages with OCR text for scoring
  const allPages = await db.collection('pages')
    .find(
      { book_id: { $in: batchBookIds }, page_number: { $lte: SCAN_PAGES } },
      {
        projection: {
          book_id: 1, page_number: 1, page_type: 1,
          photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
          'ocr.data': 1,
        }
      }
    )
    .sort({ book_id: 1, page_number: 1 })
    .toArray();

  // Extract OCR text (first 800 chars for scoring) and group by book
  const pagesByBook = new Map();
  for (const p of allPages) {
    p.ocr_text = (p.ocr?.data || '').substring(0, 800);
    delete p.ocr;
    if (!pagesByBook.has(p.book_id)) pagesByBook.set(p.book_id, []);
    pagesByBook.get(p.book_id).push(p);
  }

  for (const book of batch) {
    if (LIMIT && upgraded >= LIMIT) break;

    const pages = pagesByBook.get(book.id);
    if (!pages || pages.length === 0) { noData++; continue; }
    checked++;

    // Score all pages
    const scored = pages
      .map(p => {
        const { score, reason } = scorePage(p);
        return { page: p, score, reason };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < 30) { skipped++; continue; }

    // Get the URL for the best page
    const bestUrl = getPageImageUrl(best.page);
    if (!bestUrl) { skipped++; continue; }

    // Check if it's different from current cover
    const currentThumb = book.thumbnail || '';
    if (currentThumb === bestUrl) { skipped++; continue; }

    // In non-force mode, also skip if current cover is from a later page
    // (it was likely already upgraded and might be correct)
    if (!FORCE && book.thumbnail_source === 'ai_vision') { skipped++; continue; }

    upgraded++;
    const shortTitle = (book.title || '').substring(0, 55);
    changes.push({
      title: shortTitle,
      bookId: book.id,
      from: book.thumbnail_source || 'unknown',
      toPage: best.page.page_number,
      reason: best.reason,
      score: best.score,
      debug: BOOK_ID ? scored.slice(0, 8).map(s => `p${s.page.page_number}: ${s.score} (${s.reason})`) : null,
    });

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          thumbnail: bestUrl,
          thumbnail_source: 'smart_ocr',
          cover_updated_at: new Date(),
          cover_page_number: best.page.page_number,
        }}
      );
    }
  }

  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(allBooks.length / BATCH_SIZE);
  process.stdout.write(`  Batch ${batchNum}/${totalBatches} — ${upgraded} upgrades so far\r`);
}

// Summary
console.log(`\n\n=== Results ===`);
console.log(`Books checked: ${checked}`);
console.log(`${DRY_RUN ? 'Would upgrade' : 'Upgraded'}: ${upgraded}`);
console.log(`Skipped (already best or low score): ${skipped}`);
console.log(`No pages: ${noData}`);

if (BOOK_ID && changes.length > 0) {
  console.log(`\n--- Scoring detail ---`);
  for (const c of changes) {
    console.log(`  ${c.title}`);
    console.log(`  Best: page ${c.toPage} (${c.reason}, score: ${c.score})`);
    if (c.debug) {
      for (const d of c.debug) console.log(`    ${d}`);
    }
  }
} else if (changes.length > 0) {
  console.log(`\n--- Changes ${DRY_RUN ? '(preview)' : '(applied)'} ---`);
  for (const c of changes.slice(0, 100)) {
    console.log(`  ${c.title}`);
    console.log(`    → page ${c.toPage} | ${c.reason} (score: ${c.score})`);
  }
  if (changes.length > 100) console.log(`  ... and ${changes.length - 100} more`);
}

if (DRY_RUN && upgraded > 0) {
  console.log(`\nRun without --dry-run to apply.`);
}

await client.close();
