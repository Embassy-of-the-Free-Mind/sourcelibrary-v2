#!/usr/bin/env node
/**
 * Wikidata IIIF manifest harvester  (issue #2419) — the highest-yield bulk channel.
 *
 * Wikidata property P6108 ("IIIF manifest") carries ~306k manifest URLs across
 * every major institution, each with structured creator/date/subject already
 * attached — retrievable by SPARQL, no crawling, no per-manifest fetch.
 *
 *   Endpoint: https://query.wikidata.org/sparql
 *   Bulk:     SELECT ?item ?manifest WHERE { ?item wdt:P6108 ?manifest } (paginate)
 *   Domain:   add a P921 (main subject) filter to pull only on-topic manifests
 *
 * Writes into the same harvest_candidates ledger as the other channels.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/wikidata-harvest.mjs --max 10000        # DRY RUN (bulk)
 *   node scripts/research/wikidata-harvest.mjs --domain --commit   # domain-filtered, write
 *   node scripts/research/wikidata-harvest.mjs --commit            # full ~306k pull, write
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCandidate, upsertCandidates, recordRun } from './lib/harvest-store.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'output');
mkdirSync(OUT, { recursive: true });

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const DOMAIN = argv.includes('--domain');
const WITH_LABELS = argv.includes('--with-labels') || DOMAIN;
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const PAGE = flag('--page') ? Number(flag('--page')) : 5000;
const MAX = flag('--max') ? Number(flag('--max')) : Infinity;

// Domain main-subjects (P921) — Wikidata QIDs for our traditions.
const DOMAIN_QIDS = [
  'Q1132271', // alchemy
  'Q131227',  // Hermeticism
  'Q170978',  // Kabbalah
  'Q11653',   // astrology
  'Q178794',  // Rosicrucianism
  'Q189325',  // occultism / occult
  'Q40953',   // magic (supernatural)
];

function buildQuery(offset) {
  const subjectFilter = DOMAIN
    ? `?item wdt:P921 ?subj . VALUES ?subj { ${DOMAIN_QIDS.map((q) => `wd:${q}`).join(' ')} }`
    : '';
  const labels = WITH_LABELS
    ? `OPTIONAL { ?item wdt:P170 ?creator. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,la,de,fr,it". }`
    : '';
  const sel = WITH_LABELS ? '?item ?manifest ?itemLabel ?creatorLabel' : '?item ?manifest';
  return `SELECT ${sel} WHERE {
    ?item wdt:P6108 ?manifest .
    ${subjectFilter}
    ${labels}
  } LIMIT ${PAGE} OFFSET ${offset}`;
  // NB: no ORDER BY — sorting all ~306k rows times out WDQS (60s). Unordered
  // OFFSET paging may overlap/skip slightly across pages; the unique-by-URL
  // upsert makes overlaps harmless, and a re-run fills any gaps.
}

async function runQuery(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      });
      if (res.ok) return (await res.json()).results.bindings;
      if (res.status === 429 || res.status === 500) { await sleep(3000 * (attempt + 1)); continue; }
      console.error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return null;
    } catch (e) { await sleep(2000 * (attempt + 1)); }
  }
  return null;
}

function toCandidate(b) {
  const qid = (b.item.value.match(/Q\d+$/) || [])[0];
  return makeCandidate({
    id: `wikidata:${qid}`,
    manifest_url: b.manifest.value,
    label: b.itemLabel?.value || null,
    source_uri: b.item.value,
    aggregator: 'wikidata',
    subjects: DOMAIN ? ['wikidata-domain'] : [],
  });
}

async function main() {
  console.log(`Wikidata harvest — ${COMMIT ? 'COMMIT' : 'DRY RUN'}${DOMAIN ? ' (domain-filtered)' : ' (full P6108)'} — page ${PAGE}`);
  const byUrl = new Map();
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const rows = await runQuery(buildQuery(offset));
    if (rows === null) { console.error('query failed; stopping'); break; }
    if (rows.length === 0) break;
    for (const b of rows) {
      const c = toCandidate(b);
      if (!byUrl.has(c.manifest_url)) byUrl.set(c.manifest_url, c);
    }
    process.stdout.write(`\r  offset ${offset}  (+${rows.length}, unique ${byUrl.size})   `);
    if (rows.length < PAGE) break;
    await sleep(500);
  }
  process.stdout.write('\n');
  const candidates = [...byUrl.values()];
  console.log(`Harvested ${candidates.length} unique manifests.`);
  const byProv = {};
  for (const c of candidates) byProv[c.provider] = (byProv[c.provider] || 0) + 1;
  console.log('Top providers:', Object.entries(byProv).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => `${p}:${n}`).join('  '));

  if (COMMIT) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('bookstore');
    const now = new Date();
    const res = await upsertCandidates(db, candidates, now);
    await recordRun(db, DOMAIN ? 'wikidata-domain' : 'wikidata', { candidate_count: candidates.length }, now);
    console.log(`Upserted: ${res.upserted} new, ${res.modified} updated.`);
    await client.close();
  } else {
    const path = join(OUT, `wikidata-${DOMAIN ? 'domain' : 'all'}-candidates.json`);
    writeFileSync(path, JSON.stringify({ count: candidates.length, candidates: candidates.slice(0, 500) }, null, 2));
    console.log(`DRY RUN — wrote sample (≤500) to ${path}. Re-run with --commit to write all.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
