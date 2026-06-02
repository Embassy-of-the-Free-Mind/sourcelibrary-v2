#!/usr/bin/env node
/**
 * Biblissima IIIF manifest harvester  (issue #2357, stage 1)
 *
 * Biblissima (https://iiif.biblissima.fr/collections) aggregates pre-1800
 * MANUSCRIPTS + RARE BOOKS from 40+ libraries — our exact domain — already
 * normalized. Its search HTML embeds the ORIGINAL provider's manifest URL on
 * each result card, so harvesting is a plain HTML scrape (no API key, no SPARQL):
 *
 *   <li class="result ... cart-item"
 *       data-id="<sha1>"                      stable id
 *       data-thumbnail="…"                     thumb
 *       data-shelfmark="Paris. BnF … Latin …"  label / holding institution
 *       data-manifest="https://gallica.bnf.fr/iiif/ark:/12148/…/manifest.json">
 *
 * The manifest URL points back at the source library (Gallica, IRHT, Sorbonne,
 * BSB, Bodleian, …) — Biblissima is purely the DISCOVERY layer; page images are
 * still fetched from the original provider at import time.
 *
 * Flow (this script = harvest only): query our subject terms → scrape every
 * result card → coarse-dedup against our Mongo catalog → upsert into the
 * `harvest_candidates` ledger as decision:'pending'. Triage + promote are
 * separate stages (see issue #2357).
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/biblissima-harvest.mjs               # DRY RUN (writes JSON only)
 *   node scripts/research/biblissima-harvest.mjs --limit 2     # only first 2 queries
 *   node scripts/research/biblissima-harvest.mjs --commit      # upsert into Mongo harvest_candidates
 *   node scripts/research/biblissima-harvest.mjs --q alchimie  # single ad-hoc query
 *
 * Output (dry run): scripts/research/output/biblissima-candidates.json
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'output');
mkdirSync(OUT, { recursive: true });

const BASE = 'https://iiif.biblissima.fr/collections/search';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const DELAY_MS = 400; // be polite to Biblissima

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const LIMIT = flag('--limit') ? Number(flag('--limit')) : null;
const AD_HOC = flag('--q');

// Domain subject terms (FR is most productive on this French-led corpus; + EN + Latin).
// Keep curated — each term is one paginated crawl.
const QUERIES = AD_HOC ? [AD_HOC] : [
  'alchimie', 'alchemy', 'alchemia',
  'hermétisme', 'hermes trismegiste', 'hermetica', 'mercurius trismegistus',
  'kabbale', 'cabale', 'kabbalah', 'cabala',
  'rose-croix', 'rosicrucian', 'rosae crucis',
  'astrologie', 'astrology', 'astrologia',
  'magie', 'magia', 'philosophia occulta',
  'paracelse', 'paracelsus',
  'lullisme', 'ars notoria', 'géomancie', 'talisman',
];

// ── provider mapping from the manifest host ─────────────────────────────────
function providerFromManifest(url) {
  let host = '';
  try { host = new URL(url).host; } catch { return { provider: 'unknown', source_library: 'Unknown' }; }
  const map = [
    [/gallica\.bnf\.fr/, 'gallica', 'Bibliothèque nationale de France'],
    [/irht\.cnrs\.fr/, 'irht', 'IRHT (CNRS)'],
    [/bis-sorbonne\.fr/, 'sorbonne', 'Bibliothèque interuniversitaire de la Sorbonne'],
    [/digitale-sammlungen\.de/, 'bsb', 'Bayerische Staatsbibliothek'],
    [/bodleian|digital\.bodleian/, 'bodleian', 'Bodleian Library'],
    [/teca\.bmlonline|bmlonline/, 'laurenziana', 'Biblioteca Medicea Laurenziana'],
    [/digi\.ub\.uni-heidelberg/, 'heidelberg', 'Heidelberg University Library'],
    [/purl\.pt|bnportugal|bnd\.bn\.pt/, 'bnp', 'Biblioteca Nacional de Portugal'],
  ];
  for (const [re, provider, lib] of map) if (re.test(host)) return { provider, source_library: lib };
  return { provider: host.replace(/^www\./, ''), source_library: host };
}

// ── parse one search-results HTML page ──────────────────────────────────────
function parseResults(html) {
  const out = [];
  // each result card is an <li class="result ... cart-item" data-*="...">
  const re = /<li[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const attr = (name) => {
      const a = tag.match(new RegExp(`data-${name}="([^"]*)"`));
      return a ? a[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
    };
    const manifest = attr('manifest');
    if (!manifest) continue;
    out.push({
      biblissima_id: attr('id'),
      manifest_url: manifest,
      shelfmark: attr('shelfmark'),
      thumbnail: attr('thumbnail'),
    });
  }
  return out;
}

function totalResults(html) {
  const m = html.match(/<h2>\s*([\d.,\s]+)\s*results?\s*<\/h2>/i) || html.match(/([\d.,\s]+)\s+results? found/i);
  return m ? Number(m[1].replace(/[.,\s]/g, '')) : null;
}

const PAGE_SIZE = 20; // Biblissima paginates via &from=<offset> in steps of 20

async function fetchPage(query, page) {
  const from = (page - 1) * PAGE_SIZE;
  const url = `${BASE}?q=${encodeURIComponent(query)}${from > 0 ? `&from=${from}` : ''}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
      if (res.status === 404 || res.status === 400) return null;
    } catch (e) { /* retry */ }
    await sleep(DELAY_MS * (attempt + 1));
  }
  return null;
}

async function harvestQuery(query) {
  const seen = new Set();
  const items = [];
  let total = null;
  for (let page = 1; page <= 200; page++) {
    const html = await fetchPage(query, page);
    if (!html) break;
    if (page === 1) total = totalResults(html);
    const rows = parseResults(html);
    if (rows.length === 0) break;
    let added = 0;
    for (const r of rows) {
      const key = r.manifest_url;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...r, ...providerFromManifest(r.manifest_url) });
      added++;
    }
    process.stdout.write(`\r  q="${query}"  page ${page}  (+${added}, total seen ${items.length}${total ? `/${total}` : ''})   `);
    if (total && items.length >= total) break;
    if (added === 0) break; // no new manifests on this page
    await sleep(DELAY_MS);
  }
  process.stdout.write('\n');
  return { query, total, items };
}

// ── coarse dedup against our catalog (manifest/ark match) ───────────────────
function arkOf(url = '') {
  const m = url.match(/ark:\/[^/]+\/[^/?#]+/);
  return m ? m[0] : null;
}

async function main() {
  console.log(`Biblissima harvest — ${COMMIT ? 'COMMIT (Mongo)' : 'DRY RUN (JSON only)'} — ${QUERIES.length} queries`);

  // Build candidates across all queries (dedupe by manifest URL across queries,
  // tracking which subject terms surfaced each one).
  const byManifest = new Map();
  const queryList = LIMIT ? QUERIES.slice(0, LIMIT) : QUERIES;
  for (const q of queryList) {
    const { items } = await harvestQuery(q);
    for (const it of items) {
      const existing = byManifest.get(it.manifest_url);
      if (existing) { existing.subjects.add(q); continue; }
      byManifest.set(it.manifest_url, { ...it, subjects: new Set([q]) });
    }
  }

  const candidates = [...byManifest.values()].map((c) => ({
    _id: c.biblissima_id || arkOf(c.manifest_url) || c.manifest_url,
    provider: c.provider,
    source_library: c.source_library,
    manifest_url: c.manifest_url,
    source_uri: c.manifest_url.replace(/\/manifest(\.json)?$/, ''),
    label: c.shelfmark,           // shelfmark; true work-title comes from the manifest at promote time
    thumbnail: c.thumbnail,
    ark: arkOf(c.manifest_url),
    subjects: [...c.subjects],
    aggregator: 'biblissima',
    dedup_status: 'unchecked',
    matched_book_id: null,
    decision: 'pending',
    reason: null,
    imported_book_id: null,
  }));

  console.log(`\nHarvested ${candidates.length} unique manifests across ${queryList.length} queries.`);
  const byProv = {};
  for (const c of candidates) byProv[c.provider] = (byProv[c.provider] || 0) + 1;
  console.log('By provider:', Object.entries(byProv).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join('  '));

  // Coarse dedup: do we already hold this ARK / manifest?
  let client;
  if (process.env.MONGODB_URI) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db('bookstore');
    const arks = candidates.map((c) => c.ark).filter(Boolean);
    const owned = await db.collection('books').find(
      { $or: [
        { 'image_source.source_url': { $regex: '(ark:|/iiif/)', $options: 'i' } },
        { iiif_manifest: { $exists: true } },
      ] },
      { projection: { iiif_manifest: 1, 'image_source.source_url': 1 } },
    ).toArray();
    const ownedArks = new Set();
    for (const b of owned) {
      for (const u of [b.iiif_manifest, b.image_source?.source_url]) {
        const a = arkOf(u || ''); if (a) ownedArks.add(a);
      }
    }
    let dupes = 0;
    for (const c of candidates) {
      if (c.ark && ownedArks.has(c.ark)) { c.dedup_status = 'duplicate'; dupes++; }
      else c.dedup_status = 'novel';
    }
    console.log(`Dedup vs catalog: ${dupes} already held (by ARK), ${candidates.length - dupes} novel.`);

    if (COMMIT) {
      const col = db.collection('harvest_candidates');
      await col.createIndex({ manifest_url: 1 }, { unique: true }).catch(() => {});
      await col.createIndex({ decision: 1, provider: 1 });
      const now = new Date();
      const ops = candidates.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: { ...c, harvested_at: now },
            $setOnInsert: { first_seen: now },
          },
          upsert: true,
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      console.log(`Upserted: ${res.upsertedCount} new, ${res.modifiedCount} updated in harvest_candidates.`);
      // record harvest state per query
      const state = db.collection('harvest_state');
      await state.updateOne(
        { _id: 'biblissima' },
        { $set: { last_run_at: now, queries: queryList, candidate_count: candidates.length } },
        { upsert: true },
      );
    }
    await client.close();
  } else {
    console.log('(no MONGODB_URI — skipping dedup; source .env.production.local for the dedup pass)');
  }

  if (!COMMIT) {
    const path = join(OUT, 'biblissima-candidates.json');
    writeFileSync(path, JSON.stringify({ harvested_at: new Date().toISOString(), queries: queryList, count: candidates.length, candidates }, null, 2));
    console.log(`\nDRY RUN — wrote ${candidates.length} candidates to ${path}`);
    console.log('Re-run with --commit to upsert into Mongo harvest_candidates.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
