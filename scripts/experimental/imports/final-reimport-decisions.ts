/**
 * Final reimport decisions for remaining 14 books
 *
 * PRESERVE (7 books with translations or high coverage):
 * - De revolutionibus (209 translated)
 * - Pansophiae Diatyposis (148 translated)
 * - Tetragonismus (34 translated)
 * - De architectura (68 translated)
 * - De vitis, dogmatis (3 translated, 451 OCR)
 * - Manly Palmer Hall MSS (99% OCR coverage)
 * - Aula Lucis (94% OCR coverage)
 *
 * REIMPORT (7 books with OCR only, no translations):
 * - De Arte Cabalistica (456 OCR, 218 missing)
 * - Opera Omnia (439 OCR, 203 missing)
 * - Miracula et mysteria (332 OCR, 92 missing)
 * - Musaeum Hermeticum (325 OCR, 91 missing)
 * - Summa perfectionis (187 OCR, 91 missing)
 * - De Mysteriis Aegyptiorum (145 OCR, 236 missing)
 * - Lumen de Lumine (81 OCR, 40 missing)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const toReimport = [
  { id: 'f176cb65-a60e-4f8a-9514-39796f092cde', title: 'De Arte Cabalistica', ocr: 456, missing: 218 },
  { id: 'adad5f6d-4f68-4009-9406-d0e083cf0acc', title: 'Opera Omnia', ocr: 439, missing: 203 },
  { id: '69526348ab34727b1f046c0b', title: 'Miracula et mysteria', ocr: 332, missing: 92 },
  { id: 'c87fadfa-1543-44b9-a138-573c144246e6', title: 'Musaeum Hermeticum', ocr: 325, missing: 91 },
  { id: '695262d8ab34727b1f046ade', title: 'Summa perfectionis', ocr: 187, missing: 91 },
  { id: '912cf0da-035c-425b-8975-e5a195a47767', title: 'De Mysteriis Aegyptiorum', ocr: 145, missing: 236 },
  { id: '69525855ab34727b1f045072', title: 'Lumen de Lumine', ocr: 81, missing: 40 },
];

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

async function main() {
  console.log('Reimporting 7 books (OCR only, no translations)...');
  console.log('Note: OCR can be regenerated cheaply; missing content is more important\n');

  let success = 0;
  let failed = 0;

  for (const book of toReimport) {
    process.stdout.write(`[${book.ocr} OCR → ${book.ocr + book.missing} total] ${book.title}... `);

    try {
      const res = await fetch(`${BASE_URL}/api/books/${book.id}/reimport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full' })
      });

      if (res.ok) {
        console.log('✓');
        success++;
      } else {
        const text = await res.text();
        console.log(`✗ ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${err}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Reimported: ${success} | Failed: ${failed}`);
  console.log(`\nPreserved (with translations):`);
  console.log(`  - De revolutionibus (209 translated)`);
  console.log(`  - Pansophiae Diatyposis (148 translated)`);
  console.log(`  - De architectura (68 translated)`);
  console.log(`  - Tetragonismus (34 translated)`);
  console.log(`  - De vitis, dogmatis (3 translated)`);
  console.log(`  - Manly Palmer Hall MSS (high coverage)`);
  console.log(`  - Aula Lucis (high coverage)`);
}

main().catch(console.error);
