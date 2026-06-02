#!/usr/bin/env node
/**
 * Europeana manifest harvester  (issue #2357) — second aggregator into the
 * same `harvest_candidates` ledger. Continuous + decoupled from import.
 *
 * Europeana is huge (50M+ items of all European heritage), so unlike Biblissima
 * we DON'T crawl a corpus — we run subject-scoped queries via the Search API and
 * keep only digitised TEXT items that expose a IIIF manifest.
 *
 * Requires an API key:  EUROPEANA_API_KEY  (free, https://pro.europeana.eu/page/get-api)
 *
 *   Search:   https://api.europeana.eu/record/v2/search.json?wskey=KEY&query=…&rows=100&cursor=*
 *   Manifest: https://iiif.europeana.eu/presentation{recordId}/manifest   (recordId = item.id, leading /)
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/europeana-harvest.mjs              # DRY RUN
 *   node scripts/research/europeana-harvest.mjs --commit
 *   node scripts/research/europeana-harvest.mjs --q alchemy --commit
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCandidate, upsertCandidates, recordRun } from './lib/harvest-store.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'output');
mkdirSync(OUT, { recursive: true });

const KEY = process.env.EUROPEANA_API_KEY;
const SEARCH = 'https://api.europeana.eu/record/v2/search.json';
const MANIFEST = (id) => `https://iiif.europeana.eu/presentation${id}/manifest`;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const DELAY_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const LIMIT = flag('--limit') ? Number(flag('--limit')) : null;
const AD_HOC = flag('--q');
const MAX_PER_QUERY = flag('--max') ? Number(flag('--max')) : 600;

const QUERIES = AD_HOC ? [AD_HOC] : [
  'alchemy', 'alchimie', 'alchemia',
  'hermetica', 'hermeticism', 'hermes trismegistus',
  'kabbalah', 'cabala', 'kabbale',
  'rosicrucian', 'rose-croix',
  'astrology', 'astrologia', 'paracelsus',
  'occult philosophy', 'ars magica', 'talisman',
];

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      return null;
    } catch { await sleep(800 * (attempt + 1)); }
  }
  return null;
}

async function harvestQuery(query) {
  const items = [];
  let cursor = '*';
  while (cursor && items.length < MAX_PER_QUERY) {
    const url = `${SEARCH}?wskey=${KEY}&query=${encodeURIComponent(query)}`
      + `&qf=TYPE:TEXT&media=true&rows=100&profile=rich&cursor=${encodeURIComponent(cursor)}`;
    const json = await fetchJson(url);
    if (!json || !json.items?.length) break;
    for (const it of json.items) {
      // keep only items that carry / can carry a IIIF manifest
      const id = it.id; // e.g. "/2021803/oai_..."
      if (!id) continue;
      items.push(makeCandidate({
        id: `europeana${id}`,
        manifest_url: MANIFEST(id),
        source_uri: first(it.edmIsShownAt) || `https://www.europeana.eu/item${id}`,
        label: first(it.title) || first(it.dcTitleLangAware?.def),
        thumbnail: first(it.edmPreview),
        aggregator: 'europeana',
        subjects: [query],
        language: first(it.dcLanguage),
        source_library: first(it.dataProvider) || first(it.edmDataProvider),
      }));
    }
    cursor = json.nextCursor || null;
    process.stdout.write(`\r  q="${query}"  ${items.length} items${cursor ? ' …' : ''}   `);
    await sleep(DELAY_MS);
  }
  process.stdout.write('\n');
  return items;
}

async function main() {
  if (!KEY) {
    console.error('EUROPEANA_API_KEY not set. Get a free key at https://pro.europeana.eu/page/get-api,');
    console.error('add it to .env.production.local, then: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  console.log(`Europeana harvest — ${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${QUERIES.length} queries`);
  const queryList = LIMIT ? QUERIES.slice(0, LIMIT) : QUERIES;

  const byUrl = new Map();
  for (const q of queryList) {
    for (const c of await harvestQuery(q)) {
      const ex = byUrl.get(c.manifest_url);
      if (ex) { ex.subjects = [...new Set([...ex.subjects, ...c.subjects])]; continue; }
      byUrl.set(c.manifest_url, c);
    }
  }
  const candidates = [...byUrl.values()];
  console.log(`\nHarvested ${candidates.length} unique Europeana manifests.`);

  if (COMMIT) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('bookstore');
    const now = new Date();
    const res = await upsertCandidates(db, candidates, now);
    await recordRun(db, 'europeana', { queries: queryList, candidate_count: candidates.length }, now);
    console.log(`Upserted: ${res.upserted} new, ${res.modified} updated.`);
    await client.close();
  } else {
    const path = join(OUT, 'europeana-candidates.json');
    writeFileSync(path, JSON.stringify({ count: candidates.length, candidates }, null, 2));
    console.log(`DRY RUN — wrote ${candidates.length} to ${path}. Re-run with --commit.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
