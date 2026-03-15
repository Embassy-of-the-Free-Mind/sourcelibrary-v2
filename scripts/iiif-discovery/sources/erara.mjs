#!/usr/bin/env node
/**
 * e-rara Discovery Crawler
 *
 * Harvests book records from e-rara.ch (Swiss rare books) via OAI-PMH.
 * e-rara hosts ~100,000 digitized titles from Swiss libraries, mostly
 * 15th-18th century printed books. All items have IIIF manifests.
 *
 * OAI-PMH endpoint: https://www.e-rara.ch/oai
 * IIIF manifests: https://www.e-rara.ch/i3f/v21/{id}/manifest
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/erara.mjs
 *
 * Options:
 *   --resume               Resume from last discovered record
 *   --max-records=50000    Stop after N records (default: unlimited)
 *   --set=xxx              OAI set to harvest (default: all)
 *   --from=2020-01-01      Only records modified after this date
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates, getLastDiscoveredId } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

const SOURCE = 'erara';
const OAI_BASE = 'https://www.e-rara.ch/oai';
const BATCH_SIZE = 100; // OAI-PMH default page size for e-rara

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const RESUME = 'resume' in args;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const OAI_SET = args.set || null;
const FROM_DATE = args.from || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Parse OAI-PMH XML response.
 * Returns { records, resumptionToken }.
 */
function parseOAIResponse(xml) {
  const records = [];

  // Extract all <record> blocks
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let match;
  while ((match = recordRegex.exec(xml)) !== null) {
    const recordXml = match[1];

    // Skip deleted records
    if (recordXml.includes('status="deleted"')) continue;

    // Extract identifier
    const idMatch = recordXml.match(/<identifier>oai:www\.e-rara\.ch:(\d+)<\/identifier>/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Extract Dublin Core fields
    const getField = (tag) => {
      const m = recordXml.match(new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`));
      return m ? m[1].trim() : null;
    };

    // Get all values for a field (e.g., multiple dc:language)
    const getAllFields = (tag) => {
      const results = [];
      const re = new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`, 'g');
      let fm;
      while ((fm = re.exec(recordXml)) !== null) {
        results.push(fm[1].trim());
      }
      return results;
    };

    const title = getField('title');
    const creator = getField('creator');
    const date = getField('date');
    const languages = getAllFields('language');
    const rights = getField('rights');
    const doi = (() => {
      const identifiers = getAllFields('identifier');
      const doiId = identifiers.find(i => i.startsWith('doi:') || i.startsWith('10.3931'));
      return doiId?.replace('doi:', '') || null;
    })();

    // Parse date range
    const { earliest, latest } = parseDateRange(date);

    // Determine primary language
    const primaryLang = normalizeLanguage(languages[0]);

    const manifestUrl = `https://www.e-rara.ch/i3f/v21/${id}/manifest`;
    const sourceUrl = doi
      ? `https://www.e-rara.ch/doi/${doi}`
      : `https://www.e-rara.ch/content/titleinfo/${id}`;

    records.push({
      manifest_url: manifestUrl,
      source: SOURCE,
      origin_library: 'e-rara (Swiss libraries)',
      title: title || 'Unknown',
      author: creator || 'Unknown',
      language: primaryLang,
      date_text: date,
      date_earliest: earliest,
      date_latest: latest,
      page_count: null, // We don't fetch manifests during discovery
      categories: [],
      provider_name: 'e-rara (Swiss rare books)',
      source_url: sourceUrl,
      source_id: id,
      metadata: {
        erara_id: id,
        doi,
        rights,
        languages,
      },
    });
  }

  // Extract resumptionToken
  const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/);
  const resumptionToken = tokenMatch?.[1]?.trim() || null;

  // Extract completeListSize if available
  const sizeMatch = xml.match(/completeListSize="(\d+)"/);
  const totalSize = sizeMatch ? parseInt(sizeMatch[1]) : null;

  return { records, resumptionToken, totalSize };
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== e-rara IIIF Discovery ===`);
  console.log(`OAI endpoint: ${OAI_BASE}`);
  if (OAI_SET) console.log(`Set: ${OAI_SET}`);
  if (FROM_DATE) console.log(`From: ${FROM_DATE}`);
  console.log('');

  let url = `${OAI_BASE}?verb=ListRecords&metadataPrefix=oai_dc`;
  if (OAI_SET) url += `&set=${OAI_SET}`;
  if (FROM_DATE) url += `&from=${FROM_DATE}`;

  // Resume support
  if (RESUME) {
    const lastId = await getLastDiscoveredId(db, SOURCE);
    if (lastId) {
      console.log(`Resume not directly supported via OAI-PMH. Will skip already-discovered records.`);
    }
  }

  let totalDiscovered = 0;
  let totalSkipped = 0;
  let batchNum = 0;
  let totalSize = null;

  while (url && totalDiscovered < MAX_RECORDS) {
    batchNum++;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library; OAI-PMH harvest)',
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.error(`OAI-PMH request failed: ${res.status}`);
        // Retry after delay
        await sleep(10000);
        continue;
      }

      const xml = await res.text();

      // Check for OAI errors
      if (xml.includes('<error code="')) {
        const errorMatch = xml.match(/<error code="([^"]+)">([^<]*)<\/error>/);
        console.error(`OAI-PMH error: ${errorMatch?.[1]} — ${errorMatch?.[2]}`);
        break;
      }

      const { records, resumptionToken, totalSize: ts } = parseOAIResponse(xml);
      if (ts && !totalSize) {
        totalSize = ts;
        console.log(`Total records available: ${totalSize.toLocaleString()}\n`);
      }

      if (records.length === 0 && !resumptionToken) {
        console.log('No more records.');
        break;
      }

      // Batch insert candidates
      const { inserted, skipped } = await insertCandidates(db, records);
      totalDiscovered += inserted;
      totalSkipped += skipped;

      const pct = totalSize ? ` (${((totalDiscovered + totalSkipped) / totalSize * 100).toFixed(1)}%)` : '';
      console.log(`Batch ${batchNum}: ${records.length} records → ${inserted} new, ${skipped} existing${pct} | Total: ${totalDiscovered.toLocaleString()} discovered`);

      // Follow resumption token
      if (resumptionToken && totalDiscovered < MAX_RECORDS) {
        url = `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
      } else {
        url = null;
      }

      // Respectful rate limiting — 1 second between requests
      await sleep(1000);

    } catch (err) {
      console.error(`Batch ${batchNum} failed: ${err.message}`);
      // Back off and retry
      await sleep(15000);
    }
  }

  console.log(`\n=== Discovery Complete ===`);
  console.log(`New candidates: ${totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${totalSkipped.toLocaleString()}`);
  console.log(`Total batches: ${batchNum}`);

}, { noTimeout: true });
