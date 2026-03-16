#!/usr/bin/env node
/**
 * Batch import Manly P. Hall alchemical manuscript collection from Internet Archive
 * Source: Getty Research Institute uploads to archive.org
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-hall-getty.mjs
 *
 * Add --dry-run to test metadata fetching without importing.
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
const API_KEY = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing CRON_SECRET. Source .env.production.local first.');
  process.exit(1);
}

// CamelCase identifiers are the canonical Getty uploads
const MANUSCRIPTS = [
  // Single-box items
  { id: 'ManlyPalmerHallBox01', title: 'Manly P. Hall Collection, Box 1', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox03', title: 'Manly P. Hall Collection, Box 3', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox05', title: 'Manly P. Hall Collection, Box 5', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox06', title: 'Manly P. Hall Collection, Box 6', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox07', title: 'Manly P. Hall Collection, Box 7', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox10', title: 'Manly P. Hall Collection, Box 10', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox11', title: 'Manly P. Hall Collection, Box 11', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox14', title: 'Manly P. Hall Collection, Box 14', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox15', title: 'Manly P. Hall Collection, Box 15', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox17', title: 'Manly P. Hall Collection, Box 17', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox20', title: 'Manly P. Hall Collection, Box 20', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox21', title: 'Manly P. Hall Collection, Box 21', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox25', title: 'Manly P. Hall Collection, Box 25', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox27', title: 'Manly P. Hall Collection, Box 27', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox36', title: 'Manly P. Hall Collection, Box 36', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox37', title: 'Manly P. Hall Collection, Box 37', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox38', title: 'Manly P. Hall Collection, Box 38', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox40', title: 'Manly P. Hall Collection, Box 40', categories: ['Alchemy', 'Hermetica'] },
  // Box 4 — Ms 019 multi-volume
  { id: 'ManlyPalmerHallBox04Ms019V01', title: 'Manly P. Hall Collection, Box 4, Ms 19, Vol. 1', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox04Ms019V02', title: 'Manly P. Hall Collection, Box 4, Ms 19, Vol. 2', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox04Ms019V03', title: 'Manly P. Hall Collection, Box 4, Ms 19, Vol. 3', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox04Ms019V04', title: 'Manly P. Hall Collection, Box 4, Ms 19, Vol. 4', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox04Ms019V05', title: 'Manly P. Hall Collection, Box 4, Ms 19, Vol. 5', categories: ['Alchemy', 'Hermetica'] },
  // Box 18 — Ms 102 multi-volume (largest set)
  { id: 'ManlyPalmerHallBox18Ms102V01', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 1', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18V02', title: 'Manly P. Hall Collection, Box 18, Vol. 2', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V03', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 3', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V04', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 4', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V05', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 5', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V06', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 6', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18V07', title: 'Manly P. Hall Collection, Box 18, Vol. 7', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18V08', title: 'Manly P. Hall Collection, Box 18, Vol. 8', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V08', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 8', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V09', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 9', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V10', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 10', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V11', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 11', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18V12', title: 'Manly P. Hall Collection, Box 18, Vol. 12', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V13', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 13', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V14', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 14', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V15', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 15', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V16', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 16', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V17', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 17', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V18', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 18', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V19', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 19', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox18Ms102V20', title: 'Manly P. Hall Collection, Box 18, Ms 102, Vol. 20', categories: ['Alchemy', 'Hermetica'] },
  // Other specific manuscripts
  { id: 'ManlyPalmerHallBox30Ms175', title: 'Manly P. Hall Collection, Box 30, Ms 175', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox31Ms181', title: 'Manly P. Hall Collection, Box 31, Ms 181', categories: ['Alchemy', 'Hermetica'] },
  { id: 'ManlyPalmerHallBox34Ms209', title: 'Manly P. Hall Collection, Box 34, Ms 209', categories: ['Alchemy', 'Hermetica'] },
];

async function fetchIAMetadata(identifier) {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.metadata || null;
  } catch {
    return null;
  }
}

async function importBook(ms, iaMetadata) {
  const payload = {
    ia_identifier: ms.id,
    title: iaMetadata?.title || ms.title,
    display_title: ms.title,
    author: 'Manly Palmer Hall Collection',
    language: iaMetadata?.language || 'Multiple',
    published: iaMetadata?.date || '1500–1825',
    categories: ms.categories,
  };

  const res = await fetch(`${API_BASE}/api/import/ia`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function main() {
  console.log(`\nManly P. Hall / Getty Import${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Items: ${MANUSCRIPTS.length}\n`);

  let imported = 0;
  let failed = 0;
  let skipped = 0;

  for (const ms of MANUSCRIPTS) {
    process.stdout.write(`[${ms.id}] `);

    const metadata = await fetchIAMetadata(ms.id);
    if (!metadata) {
      console.log('SKIP (no IA metadata)');
      failed++;
      continue;
    }

    const pages = metadata.imagecount ? parseInt(metadata.imagecount, 10) : '?';
    console.log(`${metadata.title || ms.title} — ${pages} pages`);

    if (DRY_RUN) {
      console.log(`  -> Would import`);
      skipped++;
      continue;
    }

    try {
      const result = await importBook(ms, metadata);
      if (result.success) {
        console.log(`  -> Imported: ${API_BASE}/book/${result.bookId} (${result.pagesCreated} pages)`);
        imported++;
      } else if (result.error?.includes('already exists')) {
        console.log(`  -> Already exists (${result.existingId})`);
        skipped++;
      } else {
        console.log(`  -> Error: ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
      failed++;
    }

    // Be polite to IA
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
