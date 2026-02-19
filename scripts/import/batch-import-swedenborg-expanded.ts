/**
 * Expanded Swedenborg import — fills gaps from the initial batch.
 * Adds: Apoc Explained Vol 4, Heaven & Hell (EN), True Christian Religion (EN),
 * Four Doctrines, Journal of Dreams, Misc Theological Works, Apocalypse Revealed,
 * Arcana Coelestia Vols I-II & VI-XII, Compendium.
 *
 * Run: secret-lover run -- npx tsx scripts/batch-import-swedenborg-expanded.ts
 */

const BASE_URL = 'https://sourcelibrary.org';

interface ImportItem {
  ia_identifier: string;
  title: string;
  author: string;
  year: number;
  original_language: string;
}

// Missing from first batch
const SWEDENBORG_GAPS: ImportItem[] = [
  // Apocalypse Explained Vol 4 (missed due to identifier issue)
  { ia_identifier: 'apocalypseexplai04swed_0', title: 'Apocalypse Explained, Vol. 4', author: 'Emanuel Swedenborg', year: 1892, original_language: 'Latin' },
];

// Phase 1: Core standalone works not yet imported
const SWEDENBORG_CORE: ImportItem[] = [
  { ia_identifier: 'heavenitswonderss00swed', title: 'Heaven and its Wonders and Hell', author: 'Emanuel Swedenborg', year: 1900, original_language: 'Latin' },
  { ia_identifier: 'truechristianrel01swed', title: 'The True Christian Religion, Vol. I', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'truechristianrel02swed', title: 'The True Christian Religion, Vol. II', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'fourleadingdoctrin00swed', title: 'The Four Leading Doctrines of the New Church', author: 'Emanuel Swedenborg', year: 1903, original_language: 'Latin' },
  { ia_identifier: 'emanuelswedenbor00swed', title: 'Journal of Dreams and Spiritual Experiences', author: 'Emanuel Swedenborg', year: 1918, original_language: 'Swedish' },
];

// Phase 2: Shorter works + omnibus
const SWEDENBORG_SHORT: ImportItem[] = [
  { ia_identifier: 'miscellaneousthe01swed', title: 'Miscellaneous Theological Works', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'compendiumoftheo00swed', title: 'A Compendium of Theological and Spiritual Writings', author: 'Emanuel Swedenborg', year: 1854, original_language: 'Latin' },
];

// Phase 3: Apocalypse Revealed (complete single volume)
const SWEDENBORG_APOC_REVEALED: ImportItem[] = [
  { ia_identifier: 'cu31924007550027', title: 'The Apocalypse Revealed', author: 'Emanuel Swedenborg', year: 1921, original_language: 'Latin' },
];

// Phase 4: Remaining Arcana Coelestia volumes (we have III-V Latin already)
// 1915-1925 American Swedenborg Printing and Publishing Society edition
const SWEDENBORG_ARCANA: ImportItem[] = [
  { ia_identifier: 'arcanacoelestiah01swed', title: 'Arcana Coelestia, Vol. I', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah02swed', title: 'Arcana Coelestia, Vol. II', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah06swed', title: 'Arcana Coelestia, Vol. VI', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah07swed', title: 'Arcana Coelestia, Vol. VII', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah08swed', title: 'Arcana Coelestia, Vol. VIII', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah09swed', title: 'Arcana Coelestia, Vol. IX', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah10swed', title: 'Arcana Coelestia, Vol. X', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah11swed', title: 'Arcana Coelestia, Vol. XI', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
  { ia_identifier: 'arcanacoelestiah12swed', title: 'Arcana Coelestia, Vol. XII', author: 'Emanuel Swedenborg', year: 1915, original_language: 'Latin' },
];

async function importBook(item: ImportItem): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/import/ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (res.ok && (data.bookId || data.book_id)) {
      return { success: true, id: data.bookId || data.book_id };
    }
    return { success: false, error: data.error || data.message || `HTTP ${res.status}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function importBatch(label: string, items: ImportItem[]) {
  console.log(`\n=== ${label} (${items.length} books) ===`);
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const result = await importBook(item);
    if (result.success) {
      console.log(`  OK: ${item.title} -> ${BASE_URL}/book/${result.id}`);
      imported++;
    } else if (result.error?.includes('already exists')) {
      console.log(`  SKIP (exists): ${item.title}`);
      skipped++;
    } else {
      console.log(`  FAIL: ${item.title} -> ${result.error}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`  --- ${label}: ${imported} imported, ${skipped} skipped, ${failed} failed ---`);
  return { imported, skipped, failed };
}

async function main() {
  console.log('=== EXPANDED SWEDENBORG IMPORT ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const totals = { imported: 0, skipped: 0, failed: 0 };

  const batches: [string, ImportItem[]][] = [
    ['GAP FILL (Apoc Explained Vol 4)', SWEDENBORG_GAPS],
    ['CORE STANDALONE WORKS', SWEDENBORG_CORE],
    ['SHORT WORKS + OMNIBUS', SWEDENBORG_SHORT],
    ['APOCALYPSE REVEALED', SWEDENBORG_APOC_REVEALED],
    ['ARCANA COELESTIA (remaining volumes)', SWEDENBORG_ARCANA],
  ];

  for (const [label, items] of batches) {
    const result = await importBatch(label, items);
    totals.imported += result.imported;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  console.log(`\n=== GRAND TOTAL ===`);
  console.log(`Imported: ${totals.imported}`);
  console.log(`Skipped (duplicates): ${totals.skipped}`);
  console.log(`Failed: ${totals.failed}`);
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
