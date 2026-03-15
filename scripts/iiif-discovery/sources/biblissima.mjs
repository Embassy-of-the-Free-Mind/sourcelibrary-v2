#!/usr/bin/env node
/**
 * Biblissima Discovery Crawler
 *
 * Harvests IIIF manifests from Biblissima's Wikibase knowledge graph.
 * Property P196 contains IIIF manifest URLs for ~60K+ items across
 * dozens of European libraries, all pre-1800.
 *
 * Wikibase API: https://data.biblissima.fr/w/api.php
 * IIIF Collections (HTML): https://iiif.biblissima.fr/collections/
 *
 * Strategy: Sweep entity Q-IDs in batches of 50, extracting P196
 * (manifeste IIIF) values. Entities in the "cote" (shelfmark) referential
 * span roughly Q90000-Q300000+.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/biblissima.mjs
 *
 * Options:
 *   --max-records=50000    Stop after N records
 *   --start=90000          Start Q-ID number (default: 90000)
 *   --end=350000           End Q-ID number (default: 350000)
 *   --batch=50             Entities per API call (max 50)
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';

const SOURCE = 'biblissima';
const API_BASE = 'https://data.biblissima.fr/w/api.php';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const START_QID = parseInt(args.start) || 90000;
const END_QID = parseInt(args.end) || 350000;
const BATCH_SIZE = Math.min(parseInt(args.batch) || 50, 50);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Property IDs in Biblissima Wikibase
const P_IIIF_MANIFEST = 'P196';   // manifeste IIIF
const P_SHELFMARK = 'P195';       // cote (shelfmark)
const P_HELD_BY = 'P194';         // institution
const P_DIGITIZATION_URL = 'P197'; // numérisation disponible

/**
 * Fetch a batch of entities from Biblissima Wikibase.
 */
async function fetchEntities(qids) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.join('|'),
    format: 'json',
    props: 'claims|labels|descriptions',
    languages: 'en|fr|la|de',
  });

  const res = await fetch(`${API_BASE}?${params}`, {
    headers: {
      'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly library crawler)',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`Wikibase API failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Extract IIIF manifest and metadata from a Wikibase entity.
 */
function extractManifestFromEntity(qid, entity) {
  if (!entity || entity.missing !== undefined) return null;

  const claims = entity.claims || {};

  // P196 = IIIF manifest URL
  const iiifClaim = claims[P_IIIF_MANIFEST]?.[0];
  if (!iiifClaim) return null;

  const manifestUrl = iiifClaim.mainsnak?.datavalue?.value;
  if (!manifestUrl || typeof manifestUrl !== 'string') return null;

  // P195 = shelfmark
  const shelfmark = claims[P_SHELFMARK]?.[0]?.mainsnak?.datavalue?.value || null;

  // P197 = digitization URL
  const digitizationUrl = claims[P_DIGITIZATION_URL]?.[0]?.mainsnak?.datavalue?.value || null;

  // P194 = held by (institution Q-ID)
  const institutionQid = claims[P_HELD_BY]?.[0]?.mainsnak?.datavalue?.value?.id || null;

  // Labels
  const labels = entity.labels || {};
  const label = labels.en?.value || labels.fr?.value || labels.la?.value || labels.de?.value || null;

  // Descriptions
  const descriptions = entity.descriptions || {};
  const description = descriptions.en?.value || descriptions.fr?.value || null;

  // Try to extract title from label or shelfmark
  const title = label || shelfmark || `Biblissima ${qid}`;

  // Determine origin library from manifest URL patterns
  let originLibrary = 'Biblissima partner';
  if (manifestUrl.includes('vatlib.it')) originLibrary = 'Vatican Library';
  else if (manifestUrl.includes('gallica.bnf.fr')) originLibrary = 'Bibliothèque nationale de France';
  else if (manifestUrl.includes('bodleian.ox.ac.uk')) originLibrary = 'Bodleian Library (Oxford)';
  else if (manifestUrl.includes('bsb-muenchen.de') || manifestUrl.includes('digitale-sammlungen.de')) originLibrary = 'Bayerische Staatsbibliothek';
  else if (manifestUrl.includes('bl.uk')) originLibrary = 'British Library';
  else if (manifestUrl.includes('e-codices.unifr.ch')) originLibrary = 'e-codices (Swiss manuscripts)';
  else if (manifestUrl.includes('nli.org.il')) originLibrary = 'National Library of Israel';
  else if (manifestUrl.includes('bvmm.irht.cnrs.fr')) originLibrary = 'IRHT (CNRS)';
  else if (manifestUrl.includes('polona.pl')) originLibrary = 'National Library of Poland';
  else if (manifestUrl.includes('hab.de')) originLibrary = 'Herzog August Bibliothek';

  return {
    manifest_url: manifestUrl,
    source: SOURCE,
    origin_library: originLibrary,
    title,
    author: 'Unknown', // Wikibase cote entities don't store author
    language: 'Unknown',
    date_text: null,
    date_earliest: null,
    date_latest: null,
    page_count: null,
    categories: [],
    provider_name: `Biblissima (${originLibrary})`,
    source_url: digitizationUrl || `https://data.biblissima.fr/w/Item:${qid}`,
    source_id: qid,
    metadata: {
      biblissima_qid: qid,
      shelfmark,
      institution_qid: institutionQid,
      description,
    },
  };
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  console.log(`\n=== Biblissima Wikibase IIIF Discovery ===`);
  console.log(`Entity range: Q${START_QID} → Q${END_QID}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  let totalDiscovered = 0;
  let totalSkipped = 0;
  let totalEmpty = 0;
  let batchNum = 0;
  let current = START_QID;
  const totalRange = END_QID - START_QID;

  while (current < END_QID && totalDiscovered < MAX_RECORDS) {
    batchNum++;

    // Build batch of Q-IDs
    const qids = [];
    for (let i = 0; i < BATCH_SIZE && current + i < END_QID; i++) {
      qids.push(`Q${current + i}`);
    }

    try {
      const data = await fetchEntities(qids);
      const entities = data.entities || {};

      const candidates = [];
      for (const qid of qids) {
        const entity = entities[qid];
        const candidate = extractManifestFromEntity(qid, entity);
        if (candidate) {
          candidates.push(candidate);
        } else {
          totalEmpty++;
        }
      }

      if (candidates.length > 0) {
        const { inserted, skipped } = await insertCandidates(db, candidates);
        totalDiscovered += inserted;
        totalSkipped += skipped;
      }

      // Progress every 20 batches
      if (batchNum % 20 === 0) {
        const pct = ((current - START_QID) / totalRange * 100).toFixed(1);
        console.log(`[${pct}%] Q${current}: ${totalDiscovered} manifests found, ${totalEmpty} empty entities`);
      }

    } catch (err) {
      console.error(`Batch ${batchNum} (Q${current}): ${err.message}`);
      await sleep(5000);
    }

    current += BATCH_SIZE;

    // Rate limit: 1 req/sec (standard MediaWiki courtesy)
    await sleep(1000);
  }

  console.log(`\n=== Discovery Complete ===`);
  console.log(`Manifests found: ${totalDiscovered.toLocaleString()}`);
  console.log(`Already known: ${totalSkipped.toLocaleString()}`);
  console.log(`Empty entities: ${totalEmpty.toLocaleString()}`);
  console.log(`Entity range scanned: Q${START_QID} → Q${current}`);

}, { noTimeout: true });
