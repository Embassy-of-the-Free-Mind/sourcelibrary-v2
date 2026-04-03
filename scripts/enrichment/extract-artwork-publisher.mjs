#!/usr/bin/env node
/**
 * Extract publisher/place metadata for artworks from source APIs.
 *
 * For Wikimedia Commons artworks: query extmetadata API for description,
 * parse place of publication from structured data.
 *
 * Usage:
 *   node scripts/enrichment/extract-artwork-publisher.mjs [--dry-run] [--limit N] [--provider commons|rijksmuseum]
 *
 * GitHub issue: #694
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 200;
const PROVIDER_ARG = process.argv.indexOf('--provider');
const PROVIDER = PROVIDER_ARG > -1 ? process.argv[PROVIDER_ARG + 1] : 'wikimedia_commons';

/** Extract place from Commons extmetadata description */
function parseCommonsPlace(description) {
  if (!description) return null;
  // Strip HTML tags
  const text = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Pattern: "City, published YYYY" or "published in City"
  const pubMatch = text.match(/(?:published|printed|engraved)\s+(?:in\s+)?([A-Z][a-zé]+(?:\s+[A-Z][a-z]+)*)/i);
  if (pubMatch) return pubMatch[1];

  // Pattern: "Country/City, YYYY" at start of description
  const placeMatch = text.match(/^([A-Z][a-zé]+(?:\s+[A-Z][a-z]+)*),\s*(?:published|printed|c\.|ca\.)?\s*\d{4}/);
  if (placeMatch) return placeMatch[1];

  return null;
}

/** Extract publisher from Commons extmetadata */
function parseCommonsPublisher(description, artist) {
  if (!description && !artist) return null;
  const text = (description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const artText = (artist || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Pattern: "published by X" or "printed by X"
  const pubByMatch = text.match(/(?:published|printed|engraved)\s+by\s+([^,.\d]+)/i);
  if (pubByMatch) return pubByMatch[1].trim();

  // Check artist field for publisher role: "after X" suggests X is the designer, the artist is the engraver/publisher
  // Pattern in artist: "Name (publisher)" or "published by Name"
  const artPubMatch = artText.match(/([^(]+)\s*\(publisher\)/i);
  if (artPubMatch) return artPubMatch[1].trim();

  return null;
}

async function enrichFromCommons(db, books) {
  let enriched = 0;
  let failed = 0;

  // Batch API calls (50 at a time)
  for (let i = 0; i < books.length; i += 50) {
    const batch = books.slice(i, i + 50);
    if (i > 0 && i % 100 === 0) console.log(`  ${i}/${books.length}...`);

    // Build titles parameter from identifiers (clean filenames)
    const titles = batch.map(b => {
      if (b.image_source?.identifier) return 'File:' + b.image_source.identifier;
      return null;
    }).filter(Boolean);

    if (titles.length === 0) { failed += batch.length; continue; }

    try {
      // Commons API: batch query up to 50 titles
      const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=extmetadata&format=json`;
      const res = await fetch(url);
      if (!res.ok) { failed += batch.length; continue; }
      const data = await res.json();

      const pages = data.query?.pages || {};
      const pagesByTitle = new Map();
      for (const p of Object.values(pages)) {
        if (p.title) pagesByTitle.set(p.title, p);
      }

      for (let j = 0; j < batch.length; j++) {
        const book = batch[j];
        const title = titles[j];
        if (!title) { failed++; continue; }

        const page = pagesByTitle.get(title);
        const meta = page?.imageinfo?.[0]?.extmetadata;
        if (!meta) { failed++; continue; }

        const description = meta.ImageDescription?.value || '';
        const artist = meta.Artist?.value || '';
        const place = parseCommonsPlace(description);
        const publisher = parseCommonsPublisher(description, artist);

        if (!place && !publisher) { failed++; continue; }

        if (DRY_RUN) {
          console.log(`  ${book.author?.substring(0, 20)} — ${publisher || '—'} (${place || '—'})`);
        } else {
          const update = {};
          if (publisher) update.publisher = publisher;
          if (place) update.place_of_publication = place;
          update['field_provenance.publisher'] = {
            source: 'wikimedia-commons-api',
            method: 'extmetadata-parse',
            confidence: 'medium',
            date: new Date(),
          };
          await db.collection('books').updateOne({ id: book.id }, { $set: update });
          console.log(`  ✓ ${book.author?.substring(0, 20)} — ${publisher || '—'} (${place || '—'})`);
        }
        enriched++;
      }
    } catch (err) {
      console.error(`  ✗ Batch error: ${err.message}`);
      failed += batch.length;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return { enriched, failed };
}

async function main() {
  console.log(`Artwork Publisher Extraction — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}, limit ${LIMIT}, provider ${PROVIDER}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const books = await db.collection('books').find({
    visible: true,
    'image_source.provider': PROVIDER,
    $or: [{ publisher: { $exists: false } }, { publisher: null }, { publisher: '' }],
  }, {
    projection: { id: 1, title: 1, author: 1, image_source: 1 },
  }).limit(LIMIT).toArray();

  console.log(`Found ${books.length} artworks without publisher\n`);

  let result;
  if (PROVIDER === 'wikimedia_commons') {
    result = await enrichFromCommons(db, books);
  } else {
    console.log('Rijksmuseum enrichment requires API key — not implemented yet');
    result = { enriched: 0, failed: books.length };
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Enriched: ${result.enriched}, Failed: ${result.failed}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
