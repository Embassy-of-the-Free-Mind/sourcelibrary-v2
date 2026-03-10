#!/usr/bin/env node
/**
 * Fetch CDLI tablet witnesses for ETCSL compositions.
 *
 * For each ETCSL book in the database, searches the CDLI API for
 * physical tablet witnesses (P-numbers) and checks which ones have
 * photographs. Stores the results as `cdli_witnesses` on each book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/etcsl/fetch-cdli-witnesses.mjs
 *   node scripts/etcsl/fetch-cdli-witnesses.mjs --dry-run
 *   node scripts/etcsl/fetch-cdli-witnesses.mjs --book-id=69afd3fcf6ab0e0de59ae807
 *   node scripts/etcsl/fetch-cdli-witnesses.mjs --limit=10
 */

import { MongoClient } from 'mongodb';

const CDLI_SEARCH_URL = 'https://cdli.earth/search';
const CDLI_PHOTO_URL = 'https://cdli.earth/dl/photo';
const CDLI_THUMBNAIL_URL = 'https://cdli.earth/dl/tn_photo';
const CDLI_ARTIFACT_URL = 'https://cdli.earth/artifacts';

const DELAY_MS = 150; // Rate limit: 150ms between CDLI requests
const PHOTO_CHECK_CONCURRENCY = 5; // Parallel HEAD requests for photos

// --- Helpers ---

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Zero-pad ETCSL ID segments for CDLI search.
 * "1.1.1" → "1.01.01", "1.4.1.1" → "1.04.01.01"
 */
function padEtcslId(etcslId) {
  return etcslId
    .split('.')
    .map((seg, i) => (i === 0 ? seg : seg.padStart(2, '0')))
    .join('.');
}

/**
 * Search CDLI for witnesses of an ETCSL composition.
 * Paginates through all results.
 */
async function searchCdliWitnesses(etcslId) {
  const paddedId = padEtcslId(etcslId);
  const allArtifacts = [];
  let page = 1;

  while (true) {
    const url = `${CDLI_SEARCH_URL}?simple-value[]=${encodeURIComponent(`ETCSL ${paddedId}`)}&format=json&page=${page}`;
    await sleep(DELAY_MS);

    let data;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error(`  CDLI search failed (HTTP ${resp.status}) for ${etcslId} page ${page}`);
        break;
      }
      data = await resp.json();
    } catch (err) {
      console.error(`  CDLI search error for ${etcslId} page ${page}:`, err.message);
      break;
    }

    if (!Array.isArray(data) || data.length === 0) break;

    // Filter out composite text entries (not physical tablets)
    const tablets = data.filter(
      a => !a.designation?.toLowerCase().includes('composite')
    );
    allArtifacts.push(...tablets);

    // If we got fewer results than a full page, we're done
    if (data.length < 25) break;
    page++;

    // Safety: max 10 pages (250 witnesses should be plenty)
    if (page > 10) break;
  }

  return allArtifacts;
}

/**
 * Check if a CDLI photo exists via HEAD request.
 * Returns true if HTTP 200.
 */
async function checkPhotoExists(pNumber) {
  const url = `${CDLI_PHOTO_URL}/${pNumber}.jpg`;
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Check photos for a batch of P-numbers with limited concurrency.
 */
async function checkPhotoBatch(pNumbers) {
  const results = new Map();
  for (let i = 0; i < pNumbers.length; i += PHOTO_CHECK_CONCURRENCY) {
    const batch = pNumbers.slice(i, i + PHOTO_CHECK_CONCURRENCY);
    const checks = batch.map(async p => {
      const exists = await checkPhotoExists(p);
      results.set(p, exists);
    });
    await Promise.all(checks);
    if (i + PHOTO_CHECK_CONCURRENCY < pNumbers.length) {
      await sleep(50);
    }
  }
  return results;
}

/**
 * Convert a CDLI artifact JSON to a CdliWitness object.
 */
function artifactToWitness(artifact, hasPhoto, qNumber) {
  const pNumber = `P${String(artifact.id).padStart(6, '0')}`;
  const numericId = artifact.id;

  return {
    p_number: pNumber,
    designation: artifact.museum_no || artifact.designation || pNumber,
    q_number: qNumber || artifact.composites?.[0]?.composite_no || undefined,
    museum: artifact.collections?.[0]?.collection?.collection || undefined,
    period: artifact.period?.name || artifact.period?.period || undefined,
    provenience: artifact.provenience?.provenience || undefined,
    photo_url: hasPhoto ? `${CDLI_PHOTO_URL}/${pNumber}.jpg` : undefined,
    thumbnail_url: hasPhoto ? `${CDLI_THUMBNAIL_URL}/${pNumber}.jpg` : undefined,
    has_photo: hasPhoto,
    cdli_url: `${CDLI_ARTIFACT_URL}/${numericId}`,
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bookIdArg = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
  const limitArg = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find ETCSL books
  const query = { etcsl_id: { $exists: true, $ne: '' } };
  if (bookIdArg) query.id = bookIdArg;

  const books = await db.collection('books')
    .find(query, { projection: { _id: 0, id: 1, etcsl_id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 } })
    .sort({ etcsl_id: 1 })
    .toArray();

  const toProcess = limitArg > 0 ? books.slice(0, limitArg) : books;
  console.log(`Found ${books.length} ETCSL books, processing ${toProcess.length}${dryRun ? ' (DRY RUN)' : ''}\n`);

  let totalWitnesses = 0;
  let totalWithPhotos = 0;
  let booksWithWitnesses = 0;
  let booksWithPhotos = 0;
  let thumbnailsUpdated = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const book = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${book.etcsl_id} ${book.title}... `);

    // Search CDLI for witnesses
    const artifacts = await searchCdliWitnesses(book.etcsl_id);

    if (artifacts.length === 0) {
      console.log('no witnesses found');
      continue;
    }

    // Check which have photos
    const pNumbers = artifacts.map(a => `P${String(a.id).padStart(6, '0')}`);
    const photoResults = await checkPhotoBatch(pNumbers);

    // Get Q-number from the first artifact with one
    const qNumber = artifacts.find(a => a.composites?.length > 0)?.composites[0].composite_no;

    // Build witness array
    const witnesses = artifacts.map(a => {
      const pNum = `P${String(a.id).padStart(6, '0')}`;
      return artifactToWitness(a, photoResults.get(pNum) || false, qNumber);
    });

    const withPhotos = witnesses.filter(w => w.has_photo);
    totalWitnesses += witnesses.length;
    totalWithPhotos += withPhotos.length;
    booksWithWitnesses++;
    if (withPhotos.length > 0) booksWithPhotos++;

    console.log(`${witnesses.length} witnesses, ${withPhotos.length} with photos`);

    if (dryRun) continue;

    // Update book with witnesses
    const update = { $set: { cdli_witnesses: witnesses } };

    // Set thumbnail to first witness with a photo (if book has no manual cover)
    if (withPhotos.length > 0 && book.thumbnail_source !== 'manual') {
      update.$set.thumbnail = withPhotos[0].photo_url;
      update.$set.thumbnail_source = 'auto';
      thumbnailsUpdated++;
    }

    await db.collection('books').updateOne({ id: book.id }, update);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Books processed: ${toProcess.length}`);
  console.log(`Books with witnesses: ${booksWithWitnesses}`);
  console.log(`Books with photos: ${booksWithPhotos}`);
  console.log(`Total witnesses: ${totalWitnesses}`);
  console.log(`Total with photos: ${totalWithPhotos}`);
  if (!dryRun) console.log(`Thumbnails updated: ${thumbnailsUpdated}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
