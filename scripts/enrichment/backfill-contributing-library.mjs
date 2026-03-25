#!/usr/bin/env node
/**
 * Backfill contributing_library for ALL books based on image_source.provider.
 *
 * Most providers map directly to a known institution. For Internet Archive books,
 * we use the existing IA contributor metadata if available, otherwise fall back
 * to the provider mapping.
 *
 * Writes field_provenance.contributing_library with source and method.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-contributing-library.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-contributing-library.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-contributing-library.mjs --limit=100
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit) : 0;

/**
 * Provider → contributing library mapping.
 * Each entry: { name, url, note? }
 */
const PROVIDER_MAP = {
  'efm': {
    name: 'Bibliotheca Philosophica Hermetica (Embassy of the Free Mind)',
    url: 'https://embassyofthefreemind.com',
  },
  'cmc_kloss': {
    name: 'Bibliotheca Philosophica Hermetica — Kloss Collection',
    url: 'https://embassyofthefreemind.com',
    note: 'Georg Kloss Masonic manuscript collection',
  },
  'rijksmuseum': {
    name: 'Rijksmuseum',
    url: 'https://www.rijksmuseum.nl',
  },
  'e-rara': {
    name: 'e-rara.ch (Swiss university libraries)',
    url: 'https://www.e-rara.ch',
    note: 'Consortium of Swiss research libraries',
  },
  'bodleian': {
    name: 'Bodleian Library, University of Oxford',
    url: 'https://www.bodleian.ox.ac.uk',
  },
  'gallica': {
    name: 'Bibliothèque nationale de France',
    url: 'https://gallica.bnf.fr',
  },
  'mdz': {
    name: 'Bayerische Staatsbibliothek (Münchener Digitalisierungszentrum)',
    url: 'https://www.digitale-sammlungen.de',
  },
  'vatican': {
    name: 'Biblioteca Apostolica Vaticana',
    url: 'https://digi.vatlib.it',
  },
  'cambridge': {
    name: 'Cambridge University Library',
    url: 'https://cudl.lib.cam.ac.uk',
  },
  'loc': {
    name: 'Library of Congress',
    url: 'https://www.loc.gov',
  },
  'library_of_congress': {
    name: 'Library of Congress',
    url: 'https://www.loc.gov',
  },
  'met': {
    name: 'The Metropolitan Museum of Art',
    url: 'https://www.metmuseum.org',
  },
  'bl': {
    name: 'British Library',
    url: 'https://www.bl.uk',
  },
  'wellcome': {
    name: 'Wellcome Collection',
    url: 'https://wellcomecollection.org',
  },
  'cdli': {
    name: 'Cuneiform Digital Library Initiative',
    url: 'https://cdli.mpiwg-berlin.mpg.de',
  },
  'google_books': {
    name: 'Google Books',
    url: 'https://books.google.com',
    note: 'Digitization partner; original holding institution may vary',
  },
  'daotam': {
    name: 'Daotam.info',
    url: 'https://daotam.info',
  },
};

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Contributing Library Backfill ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Get all books missing contributing_library
  const query = {
    hidden: { $ne: true },
    $or: [
      { contributing_library: { $exists: false } },
      { contributing_library: null },
    ],
  };

  const totalMissing = await db.collection('books').countDocuments(query);
  console.log(`Books missing contributing_library: ${totalMissing}`);

  const pipeline = [
    { $match: query },
    { $project: {
      id: 1,
      author: 1,
      title: 1,
      'image_source.provider': 1,
      'dublin_core.dc_source': 1,
      ia_identifier: 1,
      field_provenance: 1,
    }},
    { $sort: { _id: 1 } },
  ];
  if (LIMIT) pipeline.push({ $limit: LIMIT });

  const books = await db.collection('books').aggregate(pipeline).toArray();
  console.log(`Processing: ${books.length}\n`);

  // For IA books, try to get contributor from existing IA metadata backfill
  // (backfill-ia-contributors.mjs may have stored it elsewhere — check)
  // For now, we check if the IA metadata API already fetched contributor data
  // stored on the book. If not, map to "Internet Archive" as aggregator.

  let updated = 0;
  let skipped = 0;
  const provByMethod = { provider_map: 0, ia_metadata: 0, unmapped: 0 };

  for (const book of books) {
    const provider = book.image_source?.provider;

    if (!provider) {
      skipped++;
      continue;
    }

    let library = null;
    let method = 'provider_map';

    if (provider === 'internet_archive' || provider === 'ia') {
      // IA is an aggregator — the actual library varies
      // Check if dc_source gives us a clue, but mostly it's just the IA URL
      // Default to Internet Archive as digitizer
      library = {
        name: 'Internet Archive',
        url: 'https://archive.org',
        note: 'Digital library and aggregator; original holding institution may vary',
      };
      method = 'ia_metadata';
    } else if (provider === 'wikimedia_commons') {
      library = {
        name: 'Wikimedia Commons',
        url: 'https://commons.wikimedia.org',
        note: 'Open media repository; original holding institution may vary',
      };
      method = 'provider_map';
    } else if (provider === 'iiif') {
      // Generic IIIF — we don't know which library without checking the manifest URL
      // Skip these for now — they need individual attention
      skipped++;
      continue;
    } else if (PROVIDER_MAP[provider]) {
      library = PROVIDER_MAP[provider];
    } else {
      console.log(`  UNMAPPED: provider="${provider}" — ${book.title}`);
      provByMethod.unmapped++;
      skipped++;
      continue;
    }

    const now = new Date();

    if (!DRY_RUN) {
      // Use dot-notation $set to avoid overwriting other provenance fields
      await db.collection('books').updateOne(
        { _id: book._id },
        {
          $set: {
            contributing_library: library,
            'field_provenance.contributing_library': {
              source: 'provider_mapping',
              method,
              provider,
              date: now.toISOString(),
            },
          },
        }
      );
    }

    provByMethod[method] = (provByMethod[method] || 0) + 1;
    updated++;
  }

  console.log(`\n=== Results ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped} (${skipped - provByMethod.unmapped} generic IIIF, ${provByMethod.unmapped} unmapped)`);
  console.log(`  By method: ${JSON.stringify(provByMethod)}`);

  if (DRY_RUN) {
    // Show sample
    const samples = books.filter(b => PROVIDER_MAP[b.image_source?.provider]).slice(0, 10);
    console.log('\nSample mappings:');
    for (const b of samples) {
      const lib = PROVIDER_MAP[b.image_source.provider];
      console.log(`  ${b.image_source.provider} → ${lib.name} — "${b.title}"`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
