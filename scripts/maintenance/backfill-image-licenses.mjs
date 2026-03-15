/**
 * Backfill missing image_source.license for books with "unknown" license.
 *
 * Strategy:
 * 1. EFM books (1,097): Set to "publicdomain" — BPH owns these scans
 * 2. IIIF books (822): Check IIIF manifest for `rights` field
 * 3. IA books without license: Check IA metadata API
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-image-licenses.mjs
 * Dry run (default): prints what would change. Add --write to apply.
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = !process.argv.includes('--write');
if (DRY_RUN) console.log('DRY RUN — add --write to apply changes\n');

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');

let updated = 0;
let skipped = 0;
let errors = 0;

// ── 1. EFM books: set to publicdomain ──
const efmCount = await books.countDocuments({ 'image_source.license': 'unknown', 'image_source.provider': 'efm' });
if (DRY_RUN) {
  console.log(`EFM books: ${efmCount} would be set to publicdomain`);
} else {
  const efmResult = await books.updateMany(
    { 'image_source.license': 'unknown', 'image_source.provider': 'efm' },
    { $set: { 'image_source.license': 'publicdomain' } },
  );
  updated += efmResult.modifiedCount;
  console.log(`EFM books: ${efmResult.modifiedCount} updated to publicdomain`);
}

// ── 2. IIIF books: check manifest rights field ──
const iiifBooks = await books.find(
  { 'image_source.license': 'unknown', 'image_source.iiif_manifest': { $exists: true, $ne: '' } },
  { projection: { id: 1, title: 1, 'image_source.iiif_manifest': 1, 'image_source.provider': 1 } },
).toArray();

console.log(`\nIIIF books to check: ${iiifBooks.length}`);

// Known rights URI → license mapping
const RIGHTS_MAP = {
  'http://creativecommons.org/publicdomain/mark/1.0/': 'http://creativecommons.org/publicdomain/mark/1.0/',
  'https://creativecommons.org/publicdomain/mark/1.0/': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'http://creativecommons.org/publicdomain/zero/1.0/': 'http://creativecommons.org/publicdomain/zero/1.0/',
  'https://creativecommons.org/publicdomain/zero/1.0/': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'http://rightsstatements.org/vocab/NKC/1.0/': 'publicdomain',
  'https://rightsstatements.org/vocab/NKC/1.0/': 'publicdomain',
  'http://rightsstatements.org/vocab/NoC-NC/1.0/': 'https://rightsstatements.org/vocab/NoC-NC/1.0/',
  'https://rightsstatements.org/vocab/NoC-NC/1.0/': 'https://rightsstatements.org/vocab/NoC-NC/1.0/',
  'http://rightsstatements.org/vocab/NoC-US/1.0/': 'publicdomain',
  'https://rightsstatements.org/vocab/NoC-US/1.0/': 'publicdomain',
};

for (let i = 0; i < iiifBooks.length; i++) {
  const book = iiifBooks[i];
  const manifestUrl = book.image_source.iiif_manifest;

  try {
    const resp = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/ld+json' },
    });
    if (!resp.ok) { skipped++; continue; }

    const manifest = await resp.json();

    // IIIF 3.0: rights at top level
    // IIIF 2.0: license field
    const rights = manifest.rights || manifest.license;

    // Also check requiredStatement for attribution
    const attribution = manifest.requiredStatement?.value?.en?.[0]
      || manifest.requiredStatement?.value?.none?.[0]
      || manifest.requiredStatement?.value
      || manifest.attribution;

    if (rights) {
      let license = RIGHTS_MAP[rights] || rights;
      // Handle text-based rights statements
      if (typeof license === 'string') {
        if (/public.?domain/i.test(license)) license = 'publicdomain';
        // Strip HTML tags from embedded rights strings
        license = license.replace(/<[^>]+>/g, '').trim();
        if (license.length > 100) license = license.substring(0, 100); // truncate verbose statements
      }
      const licenseUrl = typeof rights === 'string' && rights.startsWith('http') ? rights : '';

      if (!DRY_RUN) {
        await books.updateOne(
          { id: book.id },
          { $set: {
            'image_source.license': license,
            ...(licenseUrl && { 'image_source.license_url': licenseUrl }),
            ...(attribution && typeof attribution === 'string' && { 'image_source.attribution': attribution }),
          }},
        );
        updated++;
      }
      console.log(`  [${i+1}/${iiifBooks.length}] ${book.title?.substring(0,50)} → ${license}`);
    } else {
      skipped++;
      if (i < 20) console.log(`  [${i+1}] ${book.title?.substring(0,50)} → no rights field in manifest`);
    }

    // Rate limit: 200ms between requests
    if (i < iiifBooks.length - 1) await new Promise(r => setTimeout(r, 200));

  } catch (err) {
    errors++;
    if (errors <= 10) console.log(`  [${i+1}] ${book.title?.substring(0,50)} → ERROR: ${err.message}`);
  }
}

// ── 3. IA books without license (from noLicenseSamples) ──
const iaNoLicense = await books.find(
  {
    'image_source.license': { $exists: false },
    'image_source.identifier': { $exists: true, $ne: '' },
    'image_source.provider': { $in: ['internet_archive', 'ia'] },
  },
  { projection: { id: 1, title: 1, 'image_source.identifier': 1 } },
).toArray();

console.log(`\nIA books without license field: ${iaNoLicense.length}`);

for (let i = 0; i < iaNoLicense.length; i++) {
  const book = iaNoLicense[i];
  const identifier = book.image_source.identifier;

  try {
    const resp = await fetch(`https://archive.org/metadata/${identifier}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) { skipped++; continue; }

    const meta = await resp.json();
    const rights = meta.metadata?.licenseurl || meta.metadata?.rights || meta.metadata?.possible_copyright_status;

    let license = 'unknown';
    if (rights) {
      if (/public.?domain|NOT_IN_COPYRIGHT/i.test(rights)) license = 'publicdomain';
      else if (/creativecommons.*zero/i.test(rights)) license = 'http://creativecommons.org/publicdomain/zero/1.0/';
      else if (/creativecommons.*mark/i.test(rights)) license = 'http://creativecommons.org/publicdomain/mark/1.0/';
      else license = rights;
    }

    const sponsor = meta.metadata?.sponsor;
    const contrib = meta.metadata?.contributor;

    if (!DRY_RUN && license !== 'unknown') {
      await books.updateOne(
        { id: book.id },
        { $set: {
          'image_source.license': license,
          'image_source.provider': 'internet_archive',
          ...(sponsor && { 'image_source.sponsor': sponsor }),
          ...(contrib && { 'image_source.contributing_library': contrib }),
        }},
      );
      updated++;
    }
    console.log(`  [${i+1}/${iaNoLicense.length}] ${book.title?.substring(0,50)} → ${license}${sponsor ? ` (sponsor: ${sponsor})` : ''}`);

    if (i < iaNoLicense.length - 1) await new Promise(r => setTimeout(r, 300));

  } catch (err) {
    errors++;
    if (errors <= 10) console.log(`  [${i+1}] ${identifier} → ERROR: ${err.message}`);
  }
}

console.log(`\n── Summary ──`);
console.log(`Updated: ${updated}`);
console.log(`Skipped (no rights found): ${skipped}`);
console.log(`Errors: ${errors}`);
if (DRY_RUN) console.log('\nThis was a dry run. Add --write to apply changes.');

await c.close();
