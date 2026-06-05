#!/usr/bin/env node
/**
 * Internet Archive printed-book harvester  (issue #2419) — the printed-book
 * counterpart to the Wikidata manuscript channel (Wikidata P6108 has ~0 printed
 * books; they live in IA).
 *
 * IA is ~40M texts, so we DON'T dump it — we scope to our domain via the Scrape
 * API and template the IIIF manifest URL (every IA text has one):
 *
 *   Scrape:   https://archive.org/services/search/v1/scrape?q=<query>&fields=...&cursor=<c>
 *   Manifest: https://iiif.archive.org/iiif/3/{identifier}/manifest.json   (verified 200)
 *
 * Writes into the iiif_manifests discovery index, kind:'printed'.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/ia-harvest.mjs            # DRY RUN
 *   node scripts/research/ia-harvest.mjs --commit
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCandidate, upsertCandidates, recordRun } from './lib/harvest-store.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'output');
mkdirSync(OUT, { recursive: true });

const SCRAPE = 'https://archive.org/services/search/v1/scrape';
const MANIFEST = (id) => `https://iiif.archive.org/iiif/3/${id}/manifest.json`;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const MAX = flag('--max') ? Number(flag('--max')) : Infinity;
const COLLECTION = flag('--collection') || 'iiif_manifests';

// Domain-scoped: printed texts in our traditions. IA metadata search.
const QUERY = 'mediatype:texts AND ('
  + 'alchemy OR alchemia OR alchimie OR alchimia OR spagyric OR chymistry OR '
  + 'hermetica OR hermetic OR "hermes trismegistus" OR '
  + 'kabbalah OR cabala OR cabbala OR "jewish mysticism" OR '
  + 'rosicrucian OR rosenkreutz OR "rosy cross" OR '
  + 'paracelsus OR "occult philosophy" OR theosophy OR "natural magic"'
  + ')';

async function scrapePage(cursor) {
  const params = new URLSearchParams({ q: QUERY, fields: 'identifier,title,creator,year,language', count: '5000' });
  if (cursor) params.set('cursor', cursor);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${SCRAPE}?${params}`, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      console.error(`scrape ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return null;
    } catch (e) { await sleep(1500 * (attempt + 1)); }
  }
  return null;
}

const first = (v) => (Array.isArray(v) ? v[0] : v) || null;

async function main() {
  console.log(`IA harvest — ${COMMIT ? 'COMMIT' : 'DRY RUN'} → ${COLLECTION}`);
  const byId = new Map();
  let cursor = null;
  do {
    const json = await scrapePage(cursor);
    if (!json || !json.items?.length) break;
    for (const it of json.items) {
      if (!it.identifier || byId.has(it.identifier)) continue;
      byId.set(it.identifier, makeCandidate({
        id: `ia:${it.identifier}`,
        manifest_url: MANIFEST(it.identifier),
        source_uri: `https://archive.org/details/${it.identifier}`,
        label: first(it.title),
        aggregator: 'internet_archive',
        kind: 'printed',
        language: first(it.language),
        source_library: 'Internet Archive',
      }));
    }
    cursor = json.cursor || null;
    process.stdout.write(`\r  scraped ${byId.size}${json.total ? `/${json.total}` : ''}${cursor ? ' …' : ''}   `);
    if (byId.size >= MAX) break;
    await sleep(400);
  } while (cursor);
  process.stdout.write('\n');

  const candidates = [...byId.values()];
  console.log(`Harvested ${candidates.length} IA printed-text manifests.`);

  if (COMMIT) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('bookstore');
    const now = new Date();
    const res = await upsertCandidates(db, candidates, now, COLLECTION);
    await recordRun(db, 'internet_archive', { candidate_count: candidates.length, collection: COLLECTION, query: QUERY }, now);
    console.log(`Upserted into ${COLLECTION}: ${res.upserted} new, ${res.modified} updated.`);
    await client.close();
  } else {
    const path = join(OUT, 'ia-candidates.json');
    writeFileSync(path, JSON.stringify({ count: candidates.length, candidates: candidates.slice(0, 500) }, null, 2));
    console.log(`DRY RUN — wrote sample (≤500) to ${path}. Re-run with --commit.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
