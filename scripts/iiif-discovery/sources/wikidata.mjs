#!/usr/bin/env node
/**
 * Wikidata Discovery Crawler
 *
 * Harvests IIIF manifest URLs from Wikidata property P6108 ("IIIF manifest")
 * into the import_candidates staging collection. ~306K items carry a manifest;
 * ~74K of those are instance-of manuscript (Q87167) — multipage codices (median
 * ~188 canvases). Wikidata P6108 is a cross-institution channel the OAI-PMH/SRU
 * sources here don't cover (SMK, Yale, NGA, Penn, Wales, Toronto, …).
 *
 * Endpoint: https://query.wikidata.org/sparql
 *   bulk:        SELECT ?item ?manifest WHERE { ?item wdt:P6108 ?manifest }
 *   manuscripts: + ?item wdt:P31 wd:Q87167
 *
 * Labels are NOT fetched (the SPARQL label service times out at scale, and the
 * import step resolves the real title from the manifest). Pagination uses no
 * ORDER BY (sorting 306K times out WDQS); unordered LIMIT/OFFSET may overlap
 * slightly across pages — the unique manifest_url index makes that harmless.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/sources/wikidata.mjs --manuscripts        # ~74K codices
 *   node scripts/iiif-discovery/sources/wikidata.mjs                      # full ~306K
 *   node scripts/iiif-discovery/sources/wikidata.mjs --manuscripts --max-records=5000 --dry-run
 *
 * Options:
 *   --manuscripts        Restrict to P31 = manuscript (Q87167)
 *   --max-records=N      Stop after N unique manifests
 *   --page=5000          SPARQL page size (LIMIT)
 *   --start=0            Starting OFFSET
 *   --dry-run            Query only; do not write candidates
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';

const SOURCE = 'wikidata';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const MANUSCRIPTS = !!args.manuscripts;
const DRY_RUN = !!args['dry-run'];
const PAGE = parseInt(args.page) || 5000;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const START = parseInt(args.start) || 0;

// Map manifest host → human-readable holding institution.
const HOST_MAP = [
  [/gallica\.bnf\.fr/, 'Bibliothèque nationale de France'],
  [/irht\.cnrs\.fr/, 'IRHT (CNRS)'],
  [/digitale-sammlungen\.de/, 'Bayerische Staatsbibliothek'],
  [/bodleian/, 'Bodleian Library'],
  [/uni-heidelberg/, 'Heidelberg University Library'],
  [/vatlib\.it/, 'Biblioteca Apostolica Vaticana'],
  [/e-codices/, 'e-codices'],
  [/colenda\.library\.upenn/, 'University of Pennsylvania'],
  [/(\.|^)smk\.dk/, 'Statens Museum for Kunst'],
  [/yale\.edu/, 'Yale University'],
  [/harvard\.edu/, 'Harvard Library'],
  [/llgc\.org\.uk/, 'National Library of Wales'],
  [/utoronto\.ca/, 'University of Toronto'],
  [/loc\.gov/, 'Library of Congress'],
  [/archive\.org/, 'Internet Archive'],
];
function libraryFor(url) {
  let host = '';
  try { host = new URL(url).host; } catch { return 'Unknown'; }
  for (const [re, name] of HOST_MAP) if (re.test(host)) return name;
  return host.replace(/^www\./, '');
}

function buildQuery(offset) {
  const filter = MANUSCRIPTS ? '?item wdt:P31 wd:Q87167 .' : '';
  return `SELECT ?item ?manifest WHERE { ?item wdt:P6108 ?manifest . ${filter} } LIMIT ${PAGE} OFFSET ${offset}`;
}

async function runQuery(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      });
      if (res.ok) return (await res.json()).results.bindings;
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      console.error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return null;
    } catch { await sleep(2000 * (attempt + 1)); }
  }
  return null;
}

withMongo(async (db) => {
  await ensureIndexes(db);
  // manifest_url is intentionally non-unique here (dedup is by dedupe-candidates.mjs
  // clustering, not the DB), so insertCandidates' skip-if-exists isn't DB-enforced.
  // We therefore dedup in-app against existing rows — which is also the point of this
  // source: contribute only the institutions the OAI/SRU sources don't already cover
  // (the ~13K Gallica/BSB/Bodleian overlap is dropped, ~48K net-new added).
  const col = db.collection('import_candidates');
  console.log(`Wikidata discovery — ${MANUSCRIPTS ? 'manuscripts (P31=Q87167)' : 'all P6108'}${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const seen = new Set();
  let totalDiscovered = 0, totalOverlap = 0, offset = START;

  while (seen.size < MAX_RECORDS) {
    const rows = await runQuery(buildQuery(offset));
    if (rows === null) { console.error('query failed; stopping'); break; }
    if (rows.length === 0) break;

    // build candidates for manifests not seen this run
    const batch = [];
    for (const b of rows) {
      const manifest_url = b.manifest.value;
      if (seen.has(manifest_url)) continue;
      seen.add(manifest_url);
      const qid = (b.item.value.match(/Q\d+$/) || [])[0];
      const library = libraryFor(manifest_url);
      batch.push({
        manifest_url, source: SOURCE, origin_library: library, provider_name: library,
        source_url: b.item.value, source_id: qid, categories: [],
        metadata: { wikidata_qid: qid, ...(MANUSCRIPTS ? { instance_of: 'manuscript' } : {}) },
      });
    }

    // drop any already present in import_candidates (any source) — indexed lookup
    let fresh = batch;
    if (batch.length) {
      const existing = await col.find(
        { manifest_url: { $in: batch.map((c) => c.manifest_url) } },
        { projection: { manifest_url: 1, _id: 0 } },
      ).toArray();
      const have = new Set(existing.map((d) => d.manifest_url));
      totalOverlap += have.size;
      fresh = batch.filter((c) => !have.has(c.manifest_url));
    }

    if (fresh.length && !DRY_RUN) {
      const { inserted } = await insertCandidates(db, fresh);
      totalDiscovered += inserted;
    } else if (fresh.length) {
      totalDiscovered += fresh.length;
    }

    process.stdout.write(`\r  offset ${offset}  seen ${seen.size}  new ${totalDiscovered}  already-known ${totalOverlap}   `);
    if (rows.length < PAGE) break;
    offset += PAGE;
    await sleep(500);
  }

  console.log(`\n=== Wikidata discovery complete ===`);
  console.log(`Unique manifests seen:    ${seen.size.toLocaleString()}`);
  console.log(`Newly discovered (added): ${totalDiscovered.toLocaleString()}`);
  console.log(`Already in candidates:    ${totalOverlap.toLocaleString()}`);
}, { noTimeout: true });
