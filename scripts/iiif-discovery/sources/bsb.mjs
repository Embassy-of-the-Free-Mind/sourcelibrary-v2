#!/usr/bin/env node
/**
 * BSB Munich (Bavarian State Library) Discovery Crawler
 *
 * Three discovery strategies:
 *
 * 1. IIIF Collection (default) — cursor-paginate through BSB's top-level
 *    IIIF Collection (3.1M items), extracting manifest URLs and metadata.
 *    Filter by date locally.
 *    Endpoint: https://api.digitale-sammlungen.de/iiif/presentation/v2/collection/top
 *
 * 2. OAI-PMH — harvest from VD16/VD17/VD18 sets (pre-filtered by century).
 *    Endpoint: http://bdr.oai.bsb-muenchen.de/OAIHandler
 *    Note: HTTP only, HTTPS has cert issues.
 *
 * 3. Range scan — probe sequential bsb IDs for valid manifests.
 *    Slower but guaranteed to find everything.
 *
 * IIIF manifests: https://api.digitale-sammlungen.de/iiif/presentation/v2/{bsb_id}/manifest
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/bsb.mjs
 *
 * Options:
 *   --max-records=50000    Stop after N records
 *   --strategy=iiif        Discovery strategy: 'iiif' (default), 'oai', or 'range'
 *   --set=vd16             OAI set (vd16, vd17, vd18, cerl) [oai strategy only]
 *   --max-year=1800        Filter by latest publication year (default: 1800)
 *   --start=bsb00000001    Start BSB ID [range strategy only]
 *   --end=bsb00200000      End BSB ID [range strategy only]
 *   --concurrency=5        Parallel manifest probes [range strategy only]
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';
import { extractManifestMetadata, extractLabel, parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

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
const STRATEGY = args.strategy || 'iiif';
const OAI_SET = args.set || 'vd16';
const MAX_YEAR = parseInt(args['max-year']) || 1800;
const START_ID = args.start || 'bsb00000001';
const END_ID = args.end || 'bsb00200000';
const CONCURRENCY = parseInt(args.concurrency) || 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// Strategy 1: IIIF Collection cursor pagination
// ============================================================
async function discoverViaIIIFCollection(db) {
  const COLLECTION_URL = 'https://api.digitale-sammlungen.de/iiif/presentation/v2/collection/top';

  console.log('Fetching IIIF Collection metadata...');
  const topRes = await fetch(COLLECTION_URL, {
    headers: {
      'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
      'Accept': 'application/json, application/ld+json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!topRes.ok) {
    console.error(`Failed to fetch collection: ${topRes.status}`);
    return;
  }

  const topCollection = await topRes.json();
  const totalItems = topCollection.total || 0;
  console.log(`Total items in BSB: ${totalItems.toLocaleString()}`);
  console.log(`Filtering to pre-${MAX_YEAR}\n`);

  let cursorUrl = topCollection.first || `${COLLECTION_URL}?cursor=initial`;
  let totalDiscovered = 0;
  let totalSkipped = 0;
  let totalFiltered = 0;
  let batchNum = 0;

  while (cursorUrl && totalDiscovered < MAX_RECORDS) {
    batchNum++;

    try {
      const res = await fetch(cursorUrl, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
          'Accept': 'application/json, application/ld+json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        console.error(`Collection page failed: ${res.status}`);
        await sleep(5000);
        continue;
      }

      const page = await res.json();

      // Extract manifests from this page
      const manifests = page.manifests || page.members || page.items || [];
      const candidates = [];

      for (const item of manifests) {
        const manifestUrl = item['@id'] || item.id;
        if (!manifestUrl) continue;

        // Extract BSB ID from manifest URL
        const bsbIdMatch = manifestUrl.match(/(bsb\d+)/);
        if (!bsbIdMatch) continue;
        const bsbId = bsbIdMatch[1];

        const label = extractLabel(item.label) || 'Unknown';

        // Try to extract date from label or metadata (if available)
        // Most BSB IIIF collection entries include the label but not full metadata
        // We'll accept all and filter at import time if needed
        const dateMatch = label.match(/\b(\d{4})\b/);
        const year = dateMatch ? parseInt(dateMatch[1]) : null;

        // Quick filter by year in label
        if (year && year > MAX_YEAR) {
          totalFiltered++;
          continue;
        }

        candidates.push({
          manifest_url: manifestUrl,
          source: SOURCE,
          origin_library: 'Bayerische Staatsbibliothek (Munich)',
          title: label,
          author: 'Unknown', // Not available in collection listing
          language: 'Unknown',
          date_text: year ? String(year) : null,
          date_earliest: year,
          date_latest: year,
          page_count: null,
          categories: [],
          provider_name: 'Münchener DigitalisierungsZentrum (Bavarian State Library)',
          source_url: `https://www.digitale-sammlungen.de/en/view/${bsbId}`,
          source_id: bsbId,
          metadata: { bsb_id: bsbId, from_iiif_collection: true },
        });
      }

      if (candidates.length > 0) {
        const { inserted, skipped } = await insertCandidates(db, candidates);
        totalDiscovered += inserted;
        totalSkipped += skipped;
      }

      const pct = totalItems > 0 ? ` (${(batchNum * manifests.length / totalItems * 100).toFixed(2)}%)` : '';
      console.log(`Batch ${batchNum}: ${manifests.length} items → ${candidates.length} pre-${MAX_YEAR}${pct} | Total: ${totalDiscovered.toLocaleString()}`);

      // Get next page URL
      cursorUrl = page.next || null;

      await sleep(1000);

    } catch (err) {
      console.error(`Batch ${batchNum} failed: ${err.message}`);
      await sleep(10000);
    }
  }

  return { totalDiscovered, totalSkipped, totalFiltered };
}

// ============================================================
// Strategy 2: OAI-PMH with VD16/VD17/VD18 sets
// ============================================================
async function discoverViaOAIPMH(db) {
  // Note: HTTP only — BSB's OAI has SSL issues on HTTPS
  const OAI_BASE = 'http://bdr.oai.bsb-muenchen.de/OAIHandler';

  console.log(`OAI-PMH endpoint: ${OAI_BASE}`);
  console.log(`Set: ${OAI_SET}\n`);

  let url = `${OAI_BASE}?verb=ListRecords&metadataPrefix=oai_dc&set=${OAI_SET}`;
  let totalDiscovered = 0;
  let totalSkipped = 0;
  let batchNum = 0;
  let totalSize = null;

  while (url && totalDiscovered < MAX_RECORDS) {
    batchNum++;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; OAI-PMH harvest)' },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.error(`OAI request failed: ${res.status}`);
        await sleep(10000);
        continue;
      }

      const xml = await res.text();

      if (xml.includes('<error code="')) {
        const errorMatch = xml.match(/<error code="([^"]+)">([^<]*)<\/error>/);
        console.error(`OAI error: ${errorMatch?.[1]} — ${errorMatch?.[2]}`);
        break;
      }

      const { records, resumptionToken, totalSize: ts } = parseOAIResponse(xml);
      if (ts && !totalSize) {
        totalSize = ts;
        console.log(`Total OAI records: ${totalSize.toLocaleString()}\n`);
      }

      if (records.length === 0 && !resumptionToken) break;

      if (records.length > 0) {
        const { inserted, skipped } = await insertCandidates(db, records);
        totalDiscovered += inserted;
        totalSkipped += skipped;
      }

      console.log(`Batch ${batchNum}: ${records.length} records | Total: ${totalDiscovered.toLocaleString()}`);

      if (resumptionToken) {
        url = `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
      } else {
        url = null;
      }

      await sleep(2000);

    } catch (err) {
      console.error(`Batch ${batchNum} failed: ${err.message}`);
      await sleep(15000);
    }
  }

  return { totalDiscovered, totalSkipped };
}

function parseOAIResponse(xml) {
  const records = [];
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let match;
  while ((match = recordRegex.exec(xml)) !== null) {
    const recordXml = match[1];
    if (recordXml.includes('status="deleted"')) continue;

    const idMatch = recordXml.match(/<identifier>[^:]+:[^:]+:([^<]+)<\/identifier>/);
    if (!idMatch) continue;
    const id = idMatch[1].trim();
    if (!id.startsWith('bsb')) continue;

    const getField = (tag) => {
      const m = recordXml.match(new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`));
      return m ? m[1].trim() : null;
    };
    const getAllFields = (tag) => {
      const results = [];
      const re = new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`, 'g');
      let fm;
      while ((fm = re.exec(recordXml)) !== null) results.push(fm[1].trim());
      return results;
    };

    const title = getField('title');
    const creator = getField('creator');
    const date = getField('date');
    const languages = getAllFields('language');
    const { earliest, latest } = parseDateRange(date);

    if (earliest && earliest > MAX_YEAR) continue;

    records.push({
      manifest_url: `https://api.digitale-sammlungen.de/iiif/presentation/v2/${id}/manifest`,
      source: SOURCE,
      origin_library: 'Bayerische Staatsbibliothek (Munich)',
      title: title || 'Unknown',
      author: creator || 'Unknown',
      language: normalizeLanguage(languages[0]),
      date_text: date,
      date_earliest: earliest,
      date_latest: latest,
      page_count: null,
      categories: [],
      provider_name: 'Münchener DigitalisierungsZentrum (Bavarian State Library)',
      source_url: `https://www.digitale-sammlungen.de/en/view/${id}`,
      source_id: id,
      metadata: { bsb_id: id, oai_set: OAI_SET, languages },
    });
  }

  const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/);
  const sizeMatch = xml.match(/completeListSize="(\d+)"/);
  return {
    records,
    resumptionToken: tokenMatch?.[1]?.trim() || null,
    totalSize: sizeMatch ? parseInt(sizeMatch[1]) : null,
  };
}

// ============================================================
// Strategy 3: Range scan (probe sequential BSB IDs)
// ============================================================
async function discoverByRange(db) {
  const startNum = parseInt(START_ID.replace('bsb', ''));
  const endNum = parseInt(END_ID.replace('bsb', ''));

  console.log(`Scanning BSB IDs: bsb${String(startNum).padStart(8, '0')} → bsb${String(endNum).padStart(8, '0')}`);
  console.log(`Concurrency: ${CONCURRENCY} | Max year: ${MAX_YEAR}\n`);

  let totalDiscovered = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;
  let totalFiltered = 0;
  let current = startNum;

  while (current < endNum && totalDiscovered < MAX_RECORDS) {
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
      if (!exists) { totalNotFound++; continue; }
      if (metadata.date_earliest && metadata.date_earliest > MAX_YEAR) { totalFiltered++; continue; }
      if (!metadata.date_earliest && !metadata.date_text) { totalFiltered++; continue; }

      candidates.push({
        manifest_url: `https://api.digitale-sammlungen.de/iiif/presentation/v2/${bsbId}/manifest`,
        source: SOURCE,
        origin_library: 'Bayerische Staatsbibliothek (Munich)',
        ...metadata,
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

    if ((current - startNum) % 100 === 0) {
      const pct = ((current - startNum) / (endNum - startNum) * 100).toFixed(1);
      console.log(`[${pct}%] ID ${current}: ${totalDiscovered} discovered, ${totalFiltered} filtered, ${totalNotFound} not found`);
    }

    await sleep(500);
  }

  return { totalDiscovered, totalSkipped, totalNotFound, totalFiltered };
}

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
    if (!res.ok) return { bsbId, exists: false };
    const manifest = await res.json();
    return { bsbId, exists: true, metadata: extractManifestMetadata(manifest) };
  } catch {
    return { bsbId, exists: false };
  }
}

// ============================================================
// Main
// ============================================================
await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== BSB Munich IIIF Discovery ===`);
  console.log(`Strategy: ${STRATEGY}\n`);

  let result;
  switch (STRATEGY) {
    case 'iiif':
      result = await discoverViaIIIFCollection(db);
      break;
    case 'oai':
      result = await discoverViaOAIPMH(db);
      break;
    case 'range':
      result = await discoverByRange(db);
      break;
    default:
      console.error(`Unknown strategy: ${STRATEGY}. Use: iiif, oai, range`);
      return;
  }

  console.log(`\n=== Discovery Complete ===`);
  console.log(`New candidates: ${result.totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${result.totalSkipped.toLocaleString()}`);
  if (result.totalFiltered) console.log(`Filtered (post-${MAX_YEAR}): ${result.totalFiltered.toLocaleString()}`);
  if (result.totalNotFound) console.log(`Not found: ${result.totalNotFound.toLocaleString()}`);

}, { noTimeout: true });
