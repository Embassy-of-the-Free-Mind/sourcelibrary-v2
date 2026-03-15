#!/usr/bin/env node
/**
 * Biblissima Discovery Crawler
 *
 * Harvests pre-1800 IIIF manifests from Biblissima's IIIF Collections.
 * Biblissima aggregates 60,000+ manifests from dozens of European libraries,
 * already filtered for medieval and early modern texts. This is the single
 * most efficient source for our target era.
 *
 * IIIF Collections: https://iiif.biblissima.fr/collections/
 * API: https://portail.biblissima.fr/api/
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/biblissima.mjs
 *
 * Options:
 *   --max-records=50000    Stop after N records
 *   --page=1               Start page (for resumption)
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage, extractLabel } from '../lib/iiif-metadata.mjs';

const SOURCE = 'biblissima';
// Biblissima portal API for searching manuscripts and printed books
const API_BASE = 'https://portail.biblissima.fr/api';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const START_PAGE = parseInt(args.page) || 1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Strategy: Biblissima has multiple discovery paths:
 *
 * 1. IIIF Collection manifests — nested collections of manifests
 *    https://iiif.biblissima.fr/collections/manifest-list.json
 *
 * 2. Portal search API — structured search with facets
 *    https://portail.biblissima.fr/api/documents?type=manifest&page=1
 *
 * 3. Data dumps / SPARQL endpoint
 *    https://data.biblissima.fr/sparql
 *
 * We'll try the IIIF Collection approach first (most direct), falling back
 * to the portal API, and finally SPARQL if needed.
 */

/**
 * Attempt 1: Walk IIIF Collection manifests
 */
async function discoverViaIIIFCollection(db) {
  // Biblissima publishes top-level collection manifests that contain
  // references to individual manifests from partner libraries
  const collectionUrls = [
    'https://iiif.biblissima.fr/collections/manifest-list.json',
    'https://iiif.biblissima.fr/collections/top.json',
  ];

  for (const collUrl of collectionUrls) {
    try {
      console.log(`Trying IIIF Collection: ${collUrl}`);
      const res = await fetch(collUrl, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
          'Accept': 'application/json, application/ld+json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        console.log(`  → ${res.status} (skipping)`);
        continue;
      }

      const collection = await res.json();
      console.log(`  → Got collection with ${collection.manifests?.length || collection.items?.length || 0} entries`);
      return collection;
    } catch (err) {
      console.log(`  → Failed: ${err.message}`);
    }
  }
  return null;
}

/**
 * Attempt 2: Use Biblissima Portal search API
 */
async function discoverViaPortalAPI(db, startPage) {
  console.log('Using Biblissima Portal API...\n');

  let page = startPage;
  let totalDiscovered = 0;
  let totalSkipped = 0;
  let totalRecords = null;

  while (totalDiscovered < MAX_RECORDS) {
    // The portal API returns documents with IIIF manifest links
    const url = `${API_BASE}/documents?type=manifest&page=${page}&per_page=100`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        if (res.status === 404 || res.status === 422) {
          console.log('No more pages.');
          break;
        }
        console.error(`API request failed: ${res.status}`);
        await sleep(5000);
        continue;
      }

      const data = await res.json();
      const documents = data.data || data.documents || data.results || data;

      if (!Array.isArray(documents) || documents.length === 0) {
        console.log('No more results.');
        break;
      }

      if (data.total && !totalRecords) {
        totalRecords = data.total;
        console.log(`Total documents: ${totalRecords.toLocaleString()}\n`);
      }

      const candidates = [];
      for (const doc of documents) {
        const manifestUrl = doc.manifest_url || doc.iiif_manifest || doc.manifest;
        if (!manifestUrl) continue;

        const title = doc.title || doc.label || 'Unknown';
        const author = doc.author || doc.creator || 'Unknown';
        const date = doc.date || doc.year || null;
        const { earliest, latest } = parseDateRange(date);
        const language = normalizeLanguage(doc.language);
        const originLib = doc.institution || doc.repository || doc.library || 'Biblissima partner';

        candidates.push({
          manifest_url: manifestUrl,
          source: SOURCE,
          origin_library: originLib,
          title,
          author,
          language,
          date_text: date?.toString() || null,
          date_earliest: earliest,
          date_latest: latest,
          page_count: null,
          categories: [],
          provider_name: `Biblissima (${originLib})`,
          source_url: doc.url || doc.permalink || manifestUrl,
          source_id: doc.id?.toString() || manifestUrl,
          metadata: {
            biblissima_id: doc.id,
            institution: doc.institution,
            shelfmark: doc.shelfmark,
            type: doc.type,
          },
        });
      }

      if (candidates.length > 0) {
        const { inserted, skipped } = await insertCandidates(db, candidates);
        totalDiscovered += inserted;
        totalSkipped += skipped;
      }

      const pct = totalRecords ? ` (${(page * 100 / totalRecords * 100).toFixed(1)}%)` : '';
      console.log(`Page ${page}: ${documents.length} documents → ${candidates.length} with manifests${pct} | Total: ${totalDiscovered.toLocaleString()}`);

      page++;
      await sleep(1500);

    } catch (err) {
      console.error(`Page ${page} failed: ${err.message}`);
      console.log(`Resume with: --page=${page}`);
      await sleep(10000);
    }
  }

  return { totalDiscovered, totalSkipped, page };
}

/**
 * Attempt 3: Use SPARQL endpoint for precise queries
 */
async function discoverViaSPARQL(db) {
  console.log('Trying SPARQL endpoint...');

  // Biblissima SPARQL endpoint
  const sparqlEndpoint = 'https://data.biblissima.fr/sparql';

  // Query for all items with IIIF manifests
  const query = `
    PREFIX dcterms: <http://purl.org/dc/terms/>
    PREFIX sc: <http://iiif.io/api/presentation/2#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT ?item ?label ?manifest ?date ?creator
    WHERE {
      ?item sc:hasManifest ?manifest .
      OPTIONAL { ?item rdfs:label ?label }
      OPTIONAL { ?item dcterms:date ?date }
      OPTIONAL { ?item dcterms:creator ?creator }
    }
    LIMIT 100
  `;

  try {
    const res = await fetch(sparqlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.log(`  → SPARQL failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    console.log(`  → Got ${data.results?.bindings?.length || 0} results`);
    return data;
  } catch (err) {
    console.log(`  → SPARQL failed: ${err.message}`);
    return null;
  }
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== Biblissima IIIF Discovery ===\n`);

  // Try IIIF Collection first
  const collection = await discoverViaIIIFCollection(db);

  if (collection) {
    // Process IIIF Collection manifest
    const manifests = collection.manifests || collection.items || collection.members || [];

    if (manifests.length > 0) {
      console.log(`\nProcessing ${manifests.length} manifests from IIIF Collection...\n`);

      const candidates = [];
      for (const item of manifests) {
        const manifestUrl = item['@id'] || item.id;
        if (!manifestUrl) continue;

        const label = extractLabel(item.label) || 'Unknown';

        candidates.push({
          manifest_url: manifestUrl,
          source: SOURCE,
          origin_library: 'Biblissima partner',
          title: label,
          author: 'Unknown', // IIIF collections usually don't include author
          language: 'Unknown',
          date_text: null,
          date_earliest: null,
          date_latest: null,
          page_count: null,
          categories: [],
          provider_name: 'Biblissima',
          source_url: manifestUrl,
          source_id: manifestUrl,
          metadata: { from_collection: true },
        });

        // Insert in batches of 500
        if (candidates.length >= 500) {
          const { inserted, skipped } = await insertCandidates(db, candidates.splice(0, 500));
          console.log(`  Inserted ${inserted}, skipped ${skipped}`);
        }
      }

      if (candidates.length > 0) {
        const { inserted, skipped } = await insertCandidates(db, candidates);
        console.log(`  Final batch: Inserted ${inserted}, skipped ${skipped}`);
      }

      return;
    }
  }

  // Fall back to Portal API
  const { totalDiscovered, totalSkipped, page } = await discoverViaPortalAPI(db, START_PAGE);

  console.log(`\n=== Discovery Complete ===`);
  console.log(`New candidates: ${totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${totalSkipped.toLocaleString()}`);

  if (totalDiscovered === 0 && totalSkipped === 0) {
    // Try SPARQL as last resort
    console.log('\nPortal API returned no results. Trying SPARQL...');
    await discoverViaSPARQL(db);
  }

}, { noTimeout: true });
