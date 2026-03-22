#!/usr/bin/env node
/**
 * Harvest Early English Books from Internet Archive into import_candidates.
 *
 * Sources:
 *   - pub_early-english-books-1475-1640 (34,902 items — STC/Pollard & Redgrave)
 *   - pub_early-english-books-1641-1700 (71,441 items — Wing)
 *
 * These are microfilm rescans uploaded to IA in early 2024.
 * Tagged with scan_quality: 'low' (microfilm B&W, not direct color IIIF).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-ia-english.mjs
 *   node scripts/catalog-coverage/harvest-ia-english.mjs --dry-run
 *   node scripts/catalog-coverage/harvest-ia-english.mjs --collection=pub_early-english-books-1475-1640
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION_FILTER = process.argv.find(a => a.startsWith('--collection='))?.split('=')[1];

const COLLECTIONS = COLLECTION_FILTER
  ? [COLLECTION_FILTER]
  : ['pub_early-english-books-1475-1640', 'pub_early-english-books-1641-1700'];

const IA_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const IA_IIIF_BASE = 'https://iiif.archive.org/iiif/3';
const PAGE_SIZE = 500;

function extractSurname(creator) {
  if (!creator) return null;
  // "Augustine, Saint." → "augustine"
  // "Molyneux, Emery" → "molyneux"
  const comma = creator.indexOf(',');
  const name = comma > 0 ? creator.slice(0, comma) : creator.split(/\s+/)[0];
  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

function cleanTitle(title) {
  // "The mariners compasse:... 1623" → "The mariners compasse"
  return title?.replace(/[.:]+\s*\d{4}.*$/, '').replace(/\s+/g, ' ').trim() || title;
}

async function fetchPage(collection, page) {
  const params = new URLSearchParams({
    q: `collection:"${collection}"`,
    'fl[]': ['identifier', 'title', 'creator', 'date', 'year', 'language', 'source'].join(','),
    rows: String(PAGE_SIZE),
    page: String(page),
    output: 'json',
    'sort[]': 'identifier asc',
  });
  // fl[] needs to be repeated for each field
  const url = `${IA_SEARCH_URL}?q=collection%3A%22${encodeURIComponent(collection)}%22&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=date&fl%5B%5D=year&fl%5B%5D=language&fl%5B%5D=source&rows=${PAGE_SIZE}&page=${page}&output=json&sort%5B%5D=identifier+asc`;

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`IA search ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response;
}

async function main() {
  console.log('=== Harvest IA Early English Books ===');
  console.log(`Collections: ${COLLECTIONS.join(', ')}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  let client;
  let db;
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    db = client.db('bookstore');
  }

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const collection of COLLECTIONS) {
    console.log(`--- ${collection} ---`);

    // Get total count
    const firstPage = await fetchPage(collection, 1);
    const total = firstPage.numFound;
    console.log(`  ${total.toLocaleString()} items total`);

    const totalPages = Math.ceil(total / PAGE_SIZE);
    let collectionInserted = 0;
    let collectionSkipped = 0;

    for (let page = 1; page <= totalPages; page++) {
      let response;
      try {
        response = page === 1 ? firstPage : await fetchPage(collection, page);
      } catch (err) {
        console.error(`\n  Page ${page} fetch error: ${err.message}. Retrying in 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        try { response = await fetchPage(collection, page); }
        catch { console.error(`  Page ${page} failed again, skipping.`); continue; }
      }
      const docs = response?.docs;
      if (!docs?.length) break;

      const ops = [];
      for (const doc of docs) {
        totalFetched++;
        const identifier = doc.identifier;
        const year = doc.year || (doc.date ? parseInt(doc.date) : null);
        if (!year || year < 1400 || year > 1750) { totalSkipped++; collectionSkipped++; continue; }

        const surname = extractSurname(doc.creator);
        const title = cleanTitle(doc.title);

        const record = {
          source: 'ia_microfilm',
          scan_quality: 'low',
          ia_identifier: identifier,
          ia_collection: collection,
          title: title,
          author: doc.creator || null,
          author_surname: surname,
          language: 'English',
          date_earliest: year,
          date_latest: year,
          manifest_url: `${IA_IIIF_BASE}/${identifier}/manifest.json`,
          status: 'discovered',
          discovered_at: new Date(),
        };

        ops.push({
          updateOne: {
            filter: { ia_identifier: identifier, source: 'ia_microfilm' },
            update: { $setOnInsert: record },
            upsert: true,
          }
        });
      }

      if (!DRY_RUN && ops.length > 0) {
        // Write in chunks with retry
        for (let i = 0; i < ops.length; i += 200) {
          const chunk = ops.slice(i, i + 200);
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const result = await db.collection('import_candidates').bulkWrite(chunk, { ordered: false });
              collectionInserted += result.upsertedCount;
              collectionSkipped += (chunk.length - result.upsertedCount);
              break;
            } catch (err) {
              const msg = String(err.message || err);
              if (attempt < 2 && (msg.includes('timed out') || msg.includes('ECONNRESET') || msg.includes('PoolCleared') || msg.includes('ENOTFOUND'))) {
                console.error(`\n  Write error, retry ${attempt + 1}/3`);
                await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
              } else {
                throw err;
              }
            }
          }
        }
      } else if (DRY_RUN) {
        collectionInserted += ops.length;
      }

      process.stdout.write(`  Page ${page}/${totalPages} — ${totalFetched.toLocaleString()} fetched, ${collectionInserted.toLocaleString()} new\r`);

      // Rate limit: 500ms between pages to avoid IA throttling
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n  ${collection}: ${collectionInserted.toLocaleString()} new, ${collectionSkipped.toLocaleString()} skipped`);
    totalInserted += collectionInserted;
    totalSkipped += collectionSkipped;
  }

  // Create index for deduplication
  if (!DRY_RUN && db) {
    try {
      await db.collection('import_candidates').createIndex(
        { ia_identifier: 1, source: 1 },
        { sparse: true, name: 'ia_identifier_source' }
      );
    } catch (e) { /* index may already exist */ }
    await client.close();
  }

  console.log(`\n=== Complete ===`);
  console.log(`  Fetched:  ${totalFetched.toLocaleString()}`);
  console.log(`  Inserted: ${totalInserted.toLocaleString()}`);
  console.log(`  Skipped:  ${totalSkipped.toLocaleString()}`);
  if (DRY_RUN) console.log('  (DRY RUN — nothing written)');
}

main().catch(err => { console.error(err); process.exit(1); });
