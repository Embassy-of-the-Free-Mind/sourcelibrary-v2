/**
 * Backfill cover selection for complete books missing cover_page.
 * Runs the same scoring logic as Phase 8.9 in the pipeline orchestrator.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-cover-selection.mjs
 *   node scripts/maintenance/backfill-cover-selection.mjs --dry-run
 *   node scripts/maintenance/backfill-cover-selection.mjs --limit 100
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();

// Import scoring from pipeline-orchestrator dynamically
// The functions aren't exported, so we inline the core logic
const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 120000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Backfill Cover Selection ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Find complete books without cover_page
const filter = { 'pipeline_auto.status': 'complete', cover_page: { $exists: false } };
const books = await db.collection('books')
  .find(filter, { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 } })
  .limit(LIMIT || 0)
  .maxTimeMS(60000)
  .toArray();

console.log(`Found ${books.length} complete books without cover_page\n`);

let updated = 0, skipped = 0, failed = 0;

for (let i = 0; i < books.length; i++) {
  const book = books[i];

  try {
    // Load first 20 pages with cover-relevant fields
    const pages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $lte: 20 } },
      { projection: {
        page_number: 1, page_type: 1, hidden: 1,
        cropped_photo: 1, archived_photo: 1, photo: 1,
        'ocr.data': 1, detected_images: 1,
      }}
    ).sort({ page_number: 1 }).maxTimeMS(10000).toArray();

    if (!pages.length) { skipped++; continue; }

    // Score each page (same logic as pipeline-orchestrator scorePageForCover)
    const scored = pages.map(p => ({ page: p, ...scorePageForCover(p) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < 30) { skipped++; continue; }

    const url = best.page.cropped_photo || best.page.archived_photo || best.page.photo;
    if (!url || !url.startsWith('http')) { skipped++; continue; }

    if (!DRY_RUN) {
      const updates = {
        cover_page: best.page.page_number,
        thumbnail: url,
        updated_at: new Date(),
        'field_provenance.thumbnail': {
          source: 'backfill-cover-selection',
          method: 'score-based',
          confidence: Math.min(best.score / 100, 1),
          date: new Date(),
        },
      };
      // Skip thumbnail update if current thumbnail is already on R2
      if (book.thumbnail?.startsWith('https://images.sourcelibrary.org')) {
        delete updates.thumbnail;
        delete updates['field_provenance.thumbnail'];
      }
      await db.collection('books').updateOne({ id: book.id }, { $set: updates });
    }

    updated++;
  } catch (err) {
    failed++;
    if (failed <= 5) console.log(`  [ERR] ${book.title?.slice(0, 40)}: ${err.message?.slice(0, 60)}`);
  }

  if ((i + 1) % 100 === 0) {
    console.log(`  ${i + 1}/${books.length}: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  }
}

console.log(`\n=== Results ===`);
console.log(`Total: ${books.length}`);
console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
console.log(`Skipped (no good cover): ${skipped}`);
console.log(`Failed: ${failed}`);

await client.close();

// --- Scoring function (copied from pipeline-orchestrator.mjs) ---

function scorePageForCover(page) {
  const ocr = (page.ocr?.data || '').substring(0, 800).toLowerCase();
  const pageType = page.page_type;
  const pageNum = page.page_number;
  let score = 0;
  let reason = pageType || 'unknown';

  if (page.hidden) return { score: -200, reason: 'hidden' };
  if (pageType === 'blank') return { score: -100, reason: 'blank' };
  if (pageType === 'digitizer-notice') return { score: -90, reason: 'digitizer-notice' };

  if (ocr.includes('front cover') || (ocr.includes('external') && ocr.includes('cover')) ||
      (ocr.includes('binding') && ocr.includes('spine')) || ocr.includes('fore-edge') ||
      ocr.includes('closed book') || ocr.includes('book block') ||
      ocr.includes('leather-bound') || ocr.includes('leather bound') ||
      ((ocr.includes('blind-stamp') || ocr.includes('blind stamp')) && ocr.includes('cover'))) {
    return { score: -80, reason: 'physical book photo' };
  }

  if (ocr.includes('digitized by') || (ocr.includes('google') && ocr.includes('logo')) ||
      (ocr.includes('internet archive') && ocr.includes('logo')) ||
      ocr.includes('proquest') || ocr.includes('early european books') ||
      ocr.includes('hathitrust') || ocr.includes('scan sheet') ||
      ocr.includes('e-rara.ch') || ocr.includes('www.e-rara') ||
      ocr.includes('gallica.bnf') || ocr.includes('mdz-nbn') ||
      ocr.includes('digital.staatsbibliothek') || ocr.includes('daten.digitale-sammlungen')) {
    return { score: -70, reason: 'digitizer insert' };
  }

  const isBphBookplate = (ocr.includes('pelican') && (ocr.includes('piety') || ocr.includes('nest') || ocr.includes('young') || ocr.includes('hermetica'))) ||
      ocr.includes('philosophia hermetica') || ocr.includes('philosophica hermetica');
  if (isBphBookplate && pageType !== 'title-page') {
    return { score: -65, reason: 'BPH pelican bookplate' };
  }

  const hasExLibris = ocr.includes('ex-libris') || ocr.includes('exlibris') || ocr.includes('ex libris') ||
      ocr.includes('bookplate') || (ocr.includes('ownership') && ocr.includes('stamp')) ||
      ocr.includes('library stamp') || ocr.includes('library sticker');
  if (hasExLibris && pageType !== 'title-page') {
    return { score: -60, reason: 'ex-libris/bookplate' };
  }

  if (ocr.includes('bleed-through') || ocr.includes('ghosting') || ocr.includes('mirrored impression')) {
    return { score: -50, reason: 'bleed-through' };
  }

  if (pageType === 'toc' || pageType === 'index') return { score: -20, reason: pageType };
  if (pageType === 'colophon') return { score: -10, reason: 'colophon' };

  const hasHeadings = (ocr.match(/^#+ .+/gm) || []).length;
  const isTitlePage = pageType === 'title-page';
  const looksLikeTitlePage = !pageType && hasHeadings >= 3;

  if (isTitlePage) { score += 80; reason = 'title-page'; }
  else if (looksLikeTitlePage) { score += 70; reason = 'likely title-page'; }

  if (isTitlePage || looksLikeTitlePage) {
    if (ocr.includes('excudebat') || ocr.includes('typis') || ocr.includes('apud') ||
        ocr.includes('impensis') || ocr.includes('sumptibus') || ocr.includes('officina') ||
        ocr.includes('printed by') || ocr.includes('published by') || ocr.includes('printed for')) {
      score += 15;
      reason = (isTitlePage ? 'title-page' : 'likely title-page') + ' with imprint';
    }
    if (ocr.includes('decorative') || ocr.includes('ornamental') || ocr.includes('border') ||
        ocr.includes('frame') || ocr.includes('vignette') || ocr.includes('woodcut') ||
        ocr.includes('architectural') || ocr.includes("printer's mark") ||
        ocr.includes("printer's device")) {
      score += 20;
      reason = 'decorated title-page';
    }
  }

  if (pageType === 'frontispiece') {
    if (ocr.includes('cover') && (ocr.includes('leather') || ocr.includes('binding') || ocr.includes('marbled'))) {
      return { score: -80, reason: 'binding photo (mislabeled frontispiece)' };
    }
    score += 90; reason = 'frontispiece';
    if (ocr.includes('engrav') || ocr.includes('allegor') || ocr.includes('portrait') ||
        ocr.includes('emblem') || ocr.includes('woodcut')) {
      score += 15; reason = 'frontispiece with engraving';
    }
  }

  if (pageType === 'illustration') {
    if (ocr.includes('photograph') && (ocr.includes('fore-edge') || (ocr.includes('book') && ocr.includes('closed')))) {
      return { score: -80, reason: 'physical book photo' };
    }
    score += 60; reason = 'illustration';
  }

  if (pageType === 'dedication') { score += 15; reason = 'dedication'; }
  if (pageType === 'text' && score === 0) { score += 5; reason = 'text'; }

  if (pageNum <= 5) score += 5;
  else if (pageNum <= 10) score += 3;

  return { score, reason };
}
