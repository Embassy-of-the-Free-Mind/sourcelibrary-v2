#!/usr/bin/env node
/**
 * Gallica (BnF) Discovery Crawler
 *
 * Harvests book records from Gallica (Bibliothèque nationale de France) via
 * their SRU API. Gallica has 10M+ digitized documents, with full IIIF support.
 * We filter for pre-1800 printed books (monographs).
 *
 * SRU API: https://gallica.bnf.fr/SRU
 * IIIF manifests: https://gallica.bnf.fr/iiif/ark:/{ark_id}/manifest.json
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/gallica.mjs
 *
 * Options:
 *   --max-records=50000    Stop after N records (default: unlimited)
 *   --max-year=1800        Latest publication year (default: 1800)
 *   --start=1              Start record position (for resumption)
 *   --query=xxx            Custom SRU query override
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

const SOURCE = 'gallica';
const SRU_BASE = 'https://gallica.bnf.fr/SRU';
const PAGE_SIZE = 50; // Gallica's max records per request

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const MAX_YEAR = parseInt(args['max-year']) || 1800;
const START_RECORD = parseInt(args.start) || 1;
const QUERY_OVERRIDE = args.query || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Build SRU query for pre-1800 printed books.
 * Gallica SRU uses CQL (Contextual Query Language).
 */
function buildQuery(maxYear) {
  if (QUERY_OVERRIDE) return QUERY_OVERRIDE;

  // dc.type = "monographie" filters to books
  // dc.date <= maxYear filters by date
  // Note: Gallica CQL syntax uses 'all' for full-text, 'adj' for exact
  return `(dc.type all "monographie") and (dc.date <= "${maxYear}")`;
}

/**
 * Parse SRU XML response from Gallica.
 */
function parseSRUResponse(xml) {
  const records = [];

  // Extract total number of results
  const totalMatch = xml.match(/<srw:numberOfRecords>(\d+)<\/srw:numberOfRecords>/);
  const totalRecords = totalMatch ? parseInt(totalMatch[1]) : null;

  // Extract each record
  const recordRegex = /<srw:record>([\s\S]*?)<\/srw:record>/g;
  let match;
  while ((match = recordRegex.exec(xml)) !== null) {
    const recordXml = match[1];

    const getField = (tag) => {
      const m = recordXml.match(new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`));
      return m ? m[1].trim() : null;
    };

    const getAllFields = (tag) => {
      const results = [];
      const re = new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`, 'g');
      let fm;
      while ((fm = re.exec(recordXml)) !== null) {
        results.push(fm[1].trim());
      }
      return results;
    };

    // Extract ARK identifier
    const identifiers = getAllFields('identifier');
    const arkId = identifiers.find(i => i.includes('ark:'))
      ?.match(/(ark:\/\d+\/\w+)/)?.[1];

    if (!arkId) continue; // Skip records without ARK

    const title = getField('title');
    const creator = getField('creator');
    const date = getField('date');
    const languages = getAllFields('language');
    const type = getField('type');

    // Parse date
    const { earliest, latest } = parseDateRange(date);

    // Skip if clearly after our cutoff
    if (earliest && earliest > MAX_YEAR) continue;

    // Skip non-text items
    if (type && /image|carte|estampe|photo|musique|son/i.test(type)) continue;

    const primaryLang = normalizeLanguage(languages[0]);

    const manifestUrl = `https://gallica.bnf.fr/iiif/${arkId}/manifest.json`;
    const sourceUrl = `https://gallica.bnf.fr/${arkId}`;

    records.push({
      manifest_url: manifestUrl,
      source: SOURCE,
      origin_library: 'Bibliothèque nationale de France',
      title: title || 'Unknown',
      author: creator || 'Unknown',
      language: primaryLang,
      date_text: date,
      date_earliest: earliest,
      date_latest: latest,
      page_count: null,
      categories: [],
      provider_name: 'Gallica (BnF)',
      source_url: sourceUrl,
      source_id: arkId,
      metadata: {
        ark_id: arkId,
        type,
        languages,
        identifiers,
      },
    });
  }

  return { records, totalRecords };
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  const query = buildQuery(MAX_YEAR);

  console.log(`\n=== Gallica (BnF) IIIF Discovery ===`);
  console.log(`SRU endpoint: ${SRU_BASE}`);
  console.log(`Query: ${query}`);
  console.log(`Max year: ${MAX_YEAR}`);
  console.log(`Starting from record: ${START_RECORD}`);
  console.log('');

  let startRecord = START_RECORD;
  let totalDiscovered = 0;
  let totalSkipped = 0;
  let batchNum = 0;
  let totalRecords = null;

  while (totalDiscovered < MAX_RECORDS) {
    batchNum++;

    const params = new URLSearchParams({
      version: '1.2',
      operation: 'searchRetrieve',
      query: query,
      maximumRecords: String(PAGE_SIZE),
      startRecord: String(startRecord),
    });

    const url = `${SRU_BASE}?${params}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.error(`SRU request failed: ${res.status}`);
        await sleep(10000);
        continue;
      }

      const xml = await res.text();
      const { records, totalRecords: total } = parseSRUResponse(xml);

      if (total && !totalRecords) {
        totalRecords = total;
        console.log(`Total matching records: ${totalRecords.toLocaleString()}\n`);
      }

      if (records.length === 0) {
        console.log('No more records.');
        break;
      }

      // Batch insert
      const { inserted, skipped } = await insertCandidates(db, records);
      totalDiscovered += inserted;
      totalSkipped += skipped;

      const pct = totalRecords ? ` (${(startRecord / totalRecords * 100).toFixed(1)}%)` : '';
      console.log(`Batch ${batchNum} [${startRecord}-${startRecord + records.length - 1}]: ${records.length} records → ${inserted} new${pct} | Total: ${totalDiscovered.toLocaleString()}`);

      startRecord += PAGE_SIZE;

      // Check if we've exhausted results
      if (totalRecords && startRecord > totalRecords) {
        break;
      }

      // Rate limit — Gallica can be slow, be gentle
      await sleep(2000);

    } catch (err) {
      console.error(`Batch ${batchNum} failed: ${err.message}`);
      console.log(`  Resume with: --start=${startRecord}`);
      await sleep(15000);
    }
  }

  console.log(`\n=== Discovery Complete ===`);
  console.log(`New candidates: ${totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${totalSkipped.toLocaleString()}`);
  console.log(`Total batches: ${batchNum}`);
  if (totalRecords && startRecord < totalRecords) {
    console.log(`\nResume with: --start=${startRecord}`);
  }

}, { noTimeout: true });
