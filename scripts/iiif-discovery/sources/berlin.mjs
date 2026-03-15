#!/usr/bin/env node
/**
 * Berlin State Library (Staatsbibliothek zu Berlin) Discovery Crawler
 *
 * Harvests from SBB's OAI-PMH endpoint using METS format, which includes
 * IIIF manifest URLs directly in <dv:iiif> elements.
 *
 * OAI-PMH: https://oai.sbb.berlin/oai
 * Sets: Handschriften (manuscripts), Historische+Drucke (historical prints)
 * IIIF: https://content.staatsbibliothek-berlin.de/dc/{PPN}/manifest
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/berlin.mjs
 *
 * Options:
 *   --max-records=50000
 *   --set=Historische+Drucke   OAI set (default: Historische+Drucke)
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

const SOURCE = 'berlin-sbb';
const OAI_BASE = 'https://oai.sbb.berlin/oai';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const OAI_SET = args.set || 'Historische+Drucke';
const MAX_YEAR = parseInt(args['max-year']) || 1800;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseOAIResponse(xml) {
  const records = [];
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let match;

  while ((match = recordRegex.exec(xml)) !== null) {
    const recordXml = match[1];
    if (recordXml.includes('status="deleted"')) continue;

    // Extract IIIF manifest URL from METS <dv:iiif> element
    const iiifMatch = recordXml.match(/<dv:iiif>([^<]+)<\/dv:iiif>/);
    if (!iiifMatch) continue;
    const manifestUrl = iiifMatch[1].trim();

    // Extract PPN or identifier
    const idMatch = recordXml.match(/<identifier>([^<]+)<\/identifier>/);
    const oaiId = idMatch?.[1]?.trim() || '';
    const ppnMatch = manifestUrl.match(/\/dc\/([^/]+)\/manifest/);
    const ppn = ppnMatch?.[1] || oaiId.split(':').pop();

    // Extract title from MODS within METS
    const titleMatch = recordXml.match(/<mods:title>([^<]+)<\/mods:title>/)
      || recordXml.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.trim() || 'Unknown';

    // Extract author
    const authorMatch = recordXml.match(/<mods:displayForm>([^<]+)<\/mods:displayForm>/)
      || recordXml.match(/<mods:namePart[^>]*>([^<]+)<\/mods:namePart>/);
    const author = authorMatch?.[1]?.trim() || 'Unknown';

    // Extract date
    const dateMatch = recordXml.match(/<mods:dateIssued[^>]*>([^<]+)<\/mods:dateIssued>/)
      || recordXml.match(/<mods:dateCreated[^>]*>([^<]+)<\/mods:dateCreated>/);
    const dateText = dateMatch?.[1]?.trim() || null;
    const { earliest, latest } = parseDateRange(dateText);

    // Filter by year
    if (earliest && earliest > MAX_YEAR) continue;

    // Extract language
    const langMatch = recordXml.match(/<mods:languageTerm[^>]*>([^<]+)<\/mods:languageTerm>/);
    const language = normalizeLanguage(langMatch?.[1]?.trim());

    const sourceUrl = `https://digital.staatsbibliothek-berlin.de/werkansicht?PPN=${ppn}`;

    records.push({
      manifest_url: manifestUrl,
      source: SOURCE,
      origin_library: 'Staatsbibliothek zu Berlin',
      title,
      author,
      language,
      date_text: dateText,
      date_earliest: earliest,
      date_latest: latest,
      page_count: null,
      categories: [],
      provider_name: 'Staatsbibliothek zu Berlin',
      source_url: sourceUrl,
      source_id: ppn,
      metadata: { ppn, oai_id: oaiId, oai_set: OAI_SET },
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

await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== Berlin State Library IIIF Discovery ===`);
  console.log(`OAI endpoint: ${OAI_BASE}`);
  console.log(`Set: ${OAI_SET}`);
  console.log(`Max year: ${MAX_YEAR}\n`);

  let url = `${OAI_BASE}?verb=ListRecords&metadataPrefix=mets&set=${OAI_SET}`;
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

      const pct = totalSize ? ` (${(batchNum * 100 / (totalSize / records.length || 1)).toFixed(1)}%)` : '';
      console.log(`Batch ${batchNum}: ${records.length} records with IIIF${pct} | Total: ${totalDiscovered.toLocaleString()}`);

      if (resumptionToken && totalDiscovered < MAX_RECORDS) {
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

  console.log(`\n=== Discovery Complete ===`);
  console.log(`New candidates: ${totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${totalSkipped.toLocaleString()}`);

}, { noTimeout: true });
