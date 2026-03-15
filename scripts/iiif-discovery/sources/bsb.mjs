#!/usr/bin/env node
/**
 * BSB Munich (Bavarian State Library) Discovery Crawler
 *
 * Harvests book records from BSB via their IIIF manifest endpoint.
 * BSB has 3.1M+ digitized items, all with IIIF manifests at predictable URLs.
 * We use VD16/VD17 bibliographic databases and OPAC scraping to discover IDs.
 *
 * BSB OAI-PMH is currently offline. Alternative approaches:
 * 1. Gateway Bayern IIIF collection endpoint (preferred)
 * 2. VD16/VD17 datasets (curated 16th-17th century prints)
 * 3. IIIF manifest probing by BSB ID range
 *
 * IIIF manifests: https://api.digitale-sammlungen.de/iiif/presentation/v2/{bsb_id}/manifest
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/bsb.mjs
 *
 * Options:
 *   --max-records=50000    Stop after N records
 *   --start=bsb00000001    Start BSB ID (for range scanning)
 *   --end=bsb00100000      End BSB ID
 *   --strategy=range       Discovery strategy: 'range' (probe IDs) or 'vd16' (curated list)
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates, insertCandidate } from '../lib/candidate-store.mjs';
import { extractManifestMetadata } from '../lib/iiif-metadata.mjs';

const SOURCE = 'bsb';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const START_ID = args.start || 'bsb00000001';
const END_ID = args.end || 'bsb00200000';
const STRATEGY = args.strategy || 'range';
const MAX_YEAR = parseInt(args['max-year']) || 1800;
const CONCURRENCY = parseInt(args.concurrency) || 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Strategy: Range Scan
 *
 * BSB IDs are sequential: bsb00000001, bsb00000002, etc.
 * We probe manifest URLs in parallel, extracting metadata from valid ones.
 * Most IDs exist — BSB has millions of items — but we filter by date.
 *
 * This is brute-force but reliable. BSB IIIF manifests include rich metadata
 * (title, author, date, language) so we can filter locally.
 */
async function discoverByRange(db, startId, endId) {
  const startNum = parseInt(startId.replace('bsb', ''));
  const endNum = parseInt(endId.replace('bsb', ''));

  console.log(`Scanning BSB IDs: bsb${String(startNum).padStart(8, '0')} → bsb${String(endNum).padStart(8, '0')}`);
  console.log(`Concurrency: ${CONCURRENCY} | Max year: ${MAX_YEAR}\n`);

  let totalDiscovered = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;
  let totalFiltered = 0;
  let current = startNum;

  while (current < endNum && totalDiscovered < MAX_RECORDS) {
    // Probe a batch of IDs in parallel
    const batch = [];
    for (let i = 0; i < CONCURRENCY && current + i < endNum; i++) {
      const bsbId = `bsb${String(current + i).padStart(8, '0')}`;
      batch.push(probeManifest(bsbId));
    }

    const results = await Promise.allSettled(batch);

    const candidates = [];
    for (const result of results) {
      if (result.status === 'rejected') continue;
      const { bsbId, metadata, exists } = result.value;

      if (!exists) {
        totalNotFound++;
        continue;
      }

      // Date filter
      if (metadata.date_earliest && metadata.date_earliest > MAX_YEAR) {
        totalFiltered++;
        continue;
      }

      // Skip if no date info and title suggests modern content
      if (!metadata.date_earliest && !metadata.date_text) {
        totalFiltered++;
        continue;
      }

      candidates.push({
        manifest_url: `https://api.digitale-sammlungen.de/iiif/presentation/v2/${bsbId}/manifest`,
        source: SOURCE,
        origin_library: 'Bayerische Staatsbibliothek (Munich)',
        title: metadata.title,
        author: metadata.author,
        display_title: metadata.display_title,
        language: metadata.language,
        date_text: metadata.date_text,
        date_earliest: metadata.date_earliest,
        date_latest: metadata.date_latest,
        page_count: metadata.page_count,
        categories: [],
        provider_name: 'Münchener DigitalisierungsZentrum (Bavarian State Library)',
        source_url: `https://www.digitale-sammlungen.de/en/view/${bsbId}`,
        source_id: bsbId,
        metadata: { bsb_id: bsbId },
      });
    }

    if (candidates.length > 0) {
      const { inserted, skipped } = await insertCandidates(db, candidates);
      totalDiscovered += inserted;
      totalSkipped += skipped;
    }

    current += CONCURRENCY;

    // Progress every 100 IDs
    if ((current - startNum) % 100 === 0) {
      const pct = ((current - startNum) / (endNum - startNum) * 100).toFixed(1);
      console.log(`[${pct}%] ID ${current}: ${totalDiscovered} discovered, ${totalFiltered} post-${MAX_YEAR}, ${totalNotFound} not found`);
    }

    // Small delay between batches to be respectful
    await sleep(500);
  }

  return { totalDiscovered, totalSkipped, totalNotFound, totalFiltered };
}

/**
 * Probe a single BSB manifest URL. Returns metadata if it exists.
 */
async function probeManifest(bsbId) {
  const url = `https://api.digitale-sammlungen.de/iiif/presentation/v2/${bsbId}/manifest`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
        'Accept': 'application/json, application/ld+json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { bsbId, exists: false };
    }

    const manifest = await res.json();
    const metadata = extractManifestMetadata(manifest);

    return { bsbId, exists: true, metadata };
  } catch {
    return { bsbId, exists: false };
  }
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== BSB Munich IIIF Discovery ===`);
  console.log(`Strategy: ${STRATEGY}`);

  if (STRATEGY === 'range') {
    const result = await discoverByRange(db, START_ID, END_ID);
    console.log(`\n=== Discovery Complete ===`);
    console.log(`New candidates: ${result.totalDiscovered.toLocaleString()}`);
    console.log(`Already known: ${result.totalSkipped.toLocaleString()}`);
    console.log(`Post-${MAX_YEAR} filtered: ${result.totalFiltered.toLocaleString()}`);
    console.log(`Not found: ${result.totalNotFound.toLocaleString()}`);
  } else {
    console.error(`Unknown strategy: ${STRATEGY}`);
    console.log('Available: range');
  }

}, { noTimeout: true });
