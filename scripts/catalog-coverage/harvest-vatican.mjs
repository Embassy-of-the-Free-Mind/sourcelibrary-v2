#!/usr/bin/env node
/**
 * Harvest Vatican Library (DigiVatLib) manuscripts via IIIF manifest scraping.
 *
 * Vatican has no OAI-PMH. Instead:
 *   1. Scrape collection browse pages to get manuscript IDs
 *   2. Fetch IIIF manifests for metadata (date, language, shelfmark, page count)
 *   3. Store in import_candidates
 *
 * 88 collections, ~80K+ manuscripts total. The browse pages list all digitized
 * MSS in each collection (e.g. /mss/Vat.gr → 1,262 MSS).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-vatican.mjs
 *   node scripts/catalog-coverage/harvest-vatican.mjs --collection=Vat.gr
 *   node scripts/catalog-coverage/harvest-vatican.mjs --dry-run --limit=50
 *   node scripts/catalog-coverage/harvest-vatican.mjs --skip-manifests
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_MANIFESTS = process.argv.includes('--skip-manifests');
const COLLECTION = process.argv.find(a => a.startsWith('--collection='))?.split('=')[1];
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const DELAY_MS = 1500; // Respect crawl-delay: 10 in robots.txt (we go even slower for manifests)
const BROWSE_DELAY_MS = 3000; // Slower for browse pages

const BASE = 'https://digi.vatlib.it';
const IIIF_BASE = `${BASE}/iiif`;
const UA = 'SourceLibrary-CatalogCoverage/1.0 (academic research; https://sourcelibrary.org)';

// ─── Step 1: Get all collection names ─────────────────────────────────────

async function getCollections() {
  console.log('Fetching collection list...');
  const res = await fetch(`${BASE}/mss/`, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  const collections = [];
  const regex = /href="\/mss\/([^"]+)"/g;
  let m;
  while ((m = regex.exec(html))) {
    const name = m[1];
    // Skip non-collection links (resource, edition, etc.)
    if (name.startsWith('resource') || name.startsWith('edition') || name === '') continue;
    if (!collections.includes(name)) collections.push(name);
  }
  console.log(`  Found ${collections.length} collections`);
  return collections;
}

// ─── Step 2: Scrape manuscript IDs from a collection browse page ──────────

async function getManuscriptIds(collection) {
  const url = `${BASE}/mss/${collection}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60000), // These pages can be large
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) return [];
      const html = await res.text();

      const ids = [];
      const regex = /href="\/mss\/edition\/(MSS_[^"]+)"/g;
      let m;
      while ((m = regex.exec(html))) {
        if (!ids.includes(m[1])) ids.push(m[1]);
      }
      return ids;
    } catch (err) {
      if (attempt < 2) {
        console.error(`  Fetch error for ${collection}, retry ${attempt + 1}/3: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      } else {
        console.error(`  Failed to fetch ${collection}: ${err.message}`);
        return [];
      }
    }
  }
  return [];
}

// ─── Step 3: Fetch IIIF manifest for metadata ────────────────────────────

async function fetchManifestMetadata(msId) {
  const url = `${IIIF_BASE}/${msId}/manifest.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) return null;
      const manifest = await res.json();

      const meta = {};
      for (const m of manifest.metadata || []) {
        const label = (typeof m.label === 'string' ? m.label : m.label?.['@value'] || '').toLowerCase();
        const value = typeof m.value === 'string' ? m.value :
                      Array.isArray(m.value) ? m.value.join('; ') :
                      m.value?.['@value'] || '';
        if (label === 'shelfmark') meta.shelfmark = value;
        else if (label === 'date') meta.date = value;
        else if (label === 'language') meta.language = value;
        else if (label === 'other name' || label === 'author') meta.author = value;
        else if (label === 'title') meta.title = value;
        else if (label === 'contributor') meta.contributor = value;
        else if (label === 'content') meta.content = value;
        else if (label === 'material') meta.material = value;
      }

      // Page count from canvases
      const canvases = manifest.sequences?.[0]?.canvases || [];
      meta.pageCount = canvases.length;
      meta.label = manifest.label || '';

      return meta;
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      } else {
        return null;
      }
    }
  }
  return null;
}

// ─── Parse Vatican date strings ───────────────────────────────────────────

function parseVaticanDate(dateStr) {
  if (!dateStr) return { earliest: null, latest: null };

  // "sec. IX-X" → 800-999
  // "sec. XV" → 1400-1499
  // "sec. XIV ex." → 1375-1399
  // "sec. XIII in." → 1200-1225
  // "1450 ca." → 1440-1460
  // "1523" → 1523-1523

  const romanMap = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20 };

  // Try explicit year first
  const yearMatch = dateStr.match(/(\d{4})/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (dateStr.includes('ca.')) return { earliest: y - 10, latest: y + 10 };
    return { earliest: y, latest: y };
  }

  // Try "sec. XIV-XV" or "sec. XIV"
  const secRange = dateStr.match(/sec\.\s*(X{0,3}(?:IX|IV|V?I{0,3}))\s*(?:-\s*(X{0,3}(?:IX|IV|V?I{0,3})))?/i);
  if (secRange) {
    const c1 = romanMap[secRange[1].toUpperCase()];
    const c2 = secRange[2] ? romanMap[secRange[2].toUpperCase()] : c1;
    if (c1 && c2) {
      let earliest = (c1 - 1) * 100;
      let latest = c2 * 100 - 1;
      // "in." = first quarter, "ex." = last quarter, "med." = middle
      if (dateStr.includes('in.')) latest = earliest + 25;
      else if (dateStr.includes('ex.')) earliest = latest - 25;
      else if (dateStr.includes('med.')) { earliest += 25; latest -= 25; }
      return { earliest, latest };
    }
  }

  return { earliest: null, latest: null };
}

// ─── Extract surname ──────────────────────────────────────────────────────

function extractSurname(author) {
  if (!author) return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').replace(/\[.*?\]/g, '').trim();
  const comma = cleaned.indexOf(',');
  const name = comma > 0 ? cleaned.slice(0, comma) : cleaned.split(/\s+/)[0];
  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Harvest Vatican Library (DigiVatLib) ===');
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT || 'none'}, Collection: ${COLLECTION || 'all'}`);
  console.log(`Skip manifests: ${SKIP_MANIFESTS}\n`);

  // Get collections
  let collections;
  if (COLLECTION) {
    collections = [COLLECTION];
  } else {
    collections = await getCollections();
  }

  // Scrape manuscript IDs from each collection
  let allMsIds = [];
  for (let i = 0; i < collections.length; i++) {
    const col = collections[i];
    process.stdout.write(`  Scraping ${col} (${i + 1}/${collections.length})...\r`);
    const ids = await getManuscriptIds(col);
    console.log(`  ${col}: ${ids.length} manuscripts`);
    for (const id of ids) {
      allMsIds.push({ msId: id, collection: col });
    }
    if (i < collections.length - 1) await new Promise(r => setTimeout(r, BROWSE_DELAY_MS));
    if (LIMIT > 0 && allMsIds.length >= LIMIT) break;
  }

  if (LIMIT > 0) allMsIds = allMsIds.slice(0, LIMIT);
  console.log(`\nTotal manuscripts to process: ${allMsIds.length.toLocaleString()}\n`);

  // Connect to MongoDB
  let client, col;
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    col = client.db('bookstore').collection('import_candidates');
  }

  // Process manuscripts
  let processed = 0, stored = 0, skipped = 0, errors = 0;
  const langCounts = {};
  const dateCounts = { pre1000: 0, '1000-1300': 0, '1300-1500': 0, '1500-1700': 0, '1700+': 0, unknown: 0 };

  for (const { msId, collection } of allMsIds) {
    processed++;

    let meta = {};
    if (!SKIP_MANIFESTS) {
      meta = await fetchManifestMetadata(msId) || {};
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const shelfmark = meta.shelfmark || msId.replace('MSS_', '').replace(/_/g, '.');
    const { earliest, latest } = parseVaticanDate(meta.date);
    const lang = (meta.language || '').replace(/\.$/, '').toLowerCase();

    // Track stats
    const langKey = lang || 'unknown';
    langCounts[langKey] = (langCounts[langKey] || 0) + 1;
    if (!earliest) dateCounts.unknown++;
    else if (earliest < 1000) dateCounts.pre1000++;
    else if (earliest < 1300) dateCounts['1000-1300']++;
    else if (earliest < 1500) dateCounts['1300-1500']++;
    else if (earliest < 1700) dateCounts['1500-1700']++;
    else dateCounts['1700+']++;

    // Clean author — may be in array format like "['Name1', 'Name2']"
    let author = meta.author || '';
    if (author.startsWith('[')) {
      try {
        const arr = JSON.parse(author.replace(/'/g, '"'));
        author = arr[0] || '';
      } catch { author = author.replace(/[\[\]']/g, '').split(',')[0].trim(); }
    }

    const record = {
      source: 'vatican',
      scan_quality: 'high',
      oai_id: `vatican:${msId}`,
      title: meta.title || meta.content || meta.label || shelfmark,
      author: author,
      author_surname: extractSurname(author),
      language: lang || null,
      date_earliest: earliest,
      date_latest: latest,
      publisher: null,
      place: 'Vatican City',
      rights: null,
      physical_format: meta.material || null,
      page_count: meta.pageCount || null,
      subjects: [],
      manifest_url: `${IIIF_BASE}/${msId}/manifest.json`,
      viewer_url: `${BASE}/view/${msId}`,
      status: 'discovered',
      discovered_at: new Date(),
      harvested_at: new Date(),
    };

    if (!DRY_RUN && col) {
      try {
        const result = await col.updateOne(
          { oai_id: record.oai_id, source: 'vatican' },
          { $setOnInsert: record },
          { upsert: true }
        );
        if (result.upsertedCount > 0) stored++;
        else skipped++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error(`  Error storing ${msId}: ${err.message}`);
      }
    } else {
      stored++;
    }

    if (processed % 10 === 0 || processed === allMsIds.length) {
      process.stdout.write(`  ${processed.toLocaleString()}/${allMsIds.length.toLocaleString()} processed, ${stored.toLocaleString()} new, ${skipped.toLocaleString()} existing, ${errors} errors\r`);
    }
  }

  // Create index
  if (!DRY_RUN && col) {
    try { await col.createIndex({ oai_id: 1, source: 1 }, { sparse: true, name: 'oai_id_source' }); } catch {}
  }

  console.log(`\n\n=== Results ===`);
  console.log(`  Processed: ${processed.toLocaleString()}`);
  console.log(`  New: ${stored.toLocaleString()}`);
  console.log(`  Already existed: ${skipped.toLocaleString()}`);
  console.log(`  Errors: ${errors}`);

  console.log(`\n--- Languages ---`);
  Object.entries(langCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log(`\n--- Date ranges ---`);
  Object.entries(dateCounts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (client) await client.close();
  if (DRY_RUN) console.log('\n(DRY RUN — nothing written)');
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
