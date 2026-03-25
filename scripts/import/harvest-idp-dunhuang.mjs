#!/usr/bin/env node
/**
 * Harvest Buddhist and Manichaean manuscripts from the International Dunhuang Project (IDP).
 *
 * Strategy:
 *   1. Scrape paginated HTML search results to collect item UUIDs
 *   2. Fetch IIIF v3 manifest for each UUID
 *   3. Scrape HTML item page for rich metadata (language, date, subjects, description)
 *   4. Store in import_candidates for later import via /api/import/iiif
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/harvest-idp-dunhuang.mjs
 *
 * Options:
 *   --subject <name>     Subject filter: Buddhism, Manicheanism (default: Manicheanism)
 *   --classification <n> Optional: Painting, Manuscript, etc.
 *   --limit N            Max items to harvest
 *   --dry-run            Show what would be harvested without writing
 *   --delay N            Delay between requests in ms (default: 1500)
 *   --start-page N       Resume from page N (default: 1)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

const subject = getArg('--subject', 'Manicheanism');
const classification = getArg('--classification', null);
const maxItems = getArg('--limit', null) ? parseInt(getArg('--limit'), 10) : Infinity;
const delayMs = parseInt(getArg('--delay', '1500'), 10);
const startPage = parseInt(getArg('--start-page', '1'), 10);

const IDP_BASE = 'https://idp.bl.uk';
const IDP_IIIF = 'https://data.idp.bl.uk/iiif/3/manifest';
const SOURCE = 'idp_dunhuang';
const ITEMS_PER_PAGE = 24;

// ── Fetch with retry ─────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly research)',
          ...options.headers,
        },
      });
      if (res.ok) return res;
      if (res.status === 429) {
        console.log(`  Rate limited, waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      if (i === retries - 1) return res; // Return non-ok on last try
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`  Retry ${i + 1}: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── Scrape search results page for UUIDs ─────────────────────────────

async function scrapeSearchPage(page) {
  let url = `${IDP_BASE}/collection/?subject%5B%5D=${encodeURIComponent(subject)}&page=${page}`;
  if (classification) {
    url += `&classification%5B%5D=${encodeURIComponent(classification)}`;
  }

  const res = await fetchWithRetry(url);
  if (!res.ok) {
    console.log(`  Search page ${page}: ${res.status}`);
    return { uuids: [], hasMore: false };
  }

  const html = await res.text();

  // Extract UUIDs from collection links: /collection/{UUID}/
  const uuidRegex = /\/collection\/([A-F0-9]{32})\//g;
  const uuids = [...new Set([...html.matchAll(uuidRegex)].map(m => m[1]))];

  // Check if there's a next page
  const hasMore = html.includes(`page=${page + 1}`);

  return { uuids, hasMore };
}

// ── Scrape item HTML for rich metadata ───────────────────────────────

async function scrapeItemMetadata(uuid) {
  const url = `${IDP_BASE}/collection/${uuid}/`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;

  const html = await res.text();
  const meta = {};

  // IDP uses: <div class="detaildropdown__section field-label-{field}">
  //             <h4>Label</h4>
  //             <p><a class="facet-link">Value</a></p>
  //           </div>
  // Also: <div class="collectionheader__pressmark"><h1>BD00256</h1></div>
  // And:  <div class="collectionheader__form">scroll</div>

  // Pressmark from header
  const pressmarkMatch = html.match(/collectionheader__pressmark[^>]*>\s*<h1>\s*(.*?)\s*<\/h1>/s);
  if (pressmarkMatch) meta.pressmark = pressmarkMatch[1].trim();

  // Item form (scroll, codex, etc.) from header
  const formMatch = html.match(/collectionheader__form[^>]*>\s*(.*?)\s*<\/div>/s);
  if (formMatch) meta.item_subtype = formMatch[1].replace(/<[^>]+>/g, '').trim();

  // Extract field-label sections
  const fieldMap = {
    'language_or_script': 'language',
    'subject': 'subjects_raw',
    'institution.summary.title': 'institution',
    'creation.date.value': 'date',
    'provenance.text.value': 'provenance',
    'material.value': 'material',
    'classification': 'item_type',
    'find_site': 'find_site',
    'dimensions': 'dimensions',
  };

  for (const [fieldLabel, metaKey] of Object.entries(fieldMap)) {
    const regex = new RegExp(`field-label-${fieldLabel.replace(/\./g, '\\.')}[\\s\\S]*?<p>([\\s\\S]*?)<\\/p>`, 'i');
    const m = html.match(regex);
    if (m) {
      // Extract text from facet links
      const values = [...m[1].matchAll(/class="facet-link"[^>]*>([^<]+)</g)].map(v => v[1].trim());
      meta[metaKey] = values.length > 1 ? values.join('; ') : values[0] || m[1].replace(/<[^>]+>/g, '').trim();
    }
  }

  // Parse language from "Chinese (lang.)" or "Sogdian (lang.); Middle Persian (lang.)"
  if (meta.language) {
    meta.language = meta.language.replace(/\s*\((?:lang|script)\.\)/g, '').trim();
  }

  // Extract all subject tags from facet links
  const subjectTags = [...html.matchAll(/subject%5B%5D=([^"&]+)/g)].map(m => decodeURIComponent(m[1]));
  if (subjectTags.length > 0) meta.subject_tags = [...new Set(subjectTags)];

  // OG title as fallback
  const ogTitle = html.match(/<title>Collection object &quot;([^&]+)&quot;/);
  if (ogTitle) meta.og_title = ogTitle[1];

  return meta;
}

// ── Fetch IIIF manifest ──────────────────────────────────────────────

async function fetchManifest(uuid) {
  const url = `${IDP_IIIF}/${uuid}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

console.log(`IDP Dunhuang Harvest — Subject: ${subject}${classification ? ', Classification: ' + classification : ''}`);
console.log(`Settings: delay=${delayMs}ms, limit=${maxItems}, dry-run=${dryRun}, start-page=${startPage}\n`);

let totalDiscovered = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalErrors = 0;
let page = startPage;
let hasMore = true;

while (hasMore && totalDiscovered < maxItems) {
  console.log(`\n── Page ${page} ──`);
  const { uuids, hasMore: more } = await scrapeSearchPage(page);
  hasMore = more;

  if (uuids.length === 0) {
    console.log('  No items found, stopping.');
    break;
  }

  console.log(`  Found ${uuids.length} items`);

  for (const uuid of uuids) {
    if (totalDiscovered >= maxItems) break;
    totalDiscovered++;

    // Check if already harvested
    const existing = await db.collection('import_candidates').findOne({
      source: SOURCE,
      source_id: uuid,
    });
    if (existing) {
      totalSkipped++;
      continue;
    }

    // Fetch manifest
    await new Promise(r => setTimeout(r, delayMs));
    const manifest = await fetchManifest(uuid);
    if (!manifest) {
      console.log(`  ${uuid}: no manifest`);
      totalErrors++;
      continue;
    }

    // Scrape HTML for rich metadata
    await new Promise(r => setTimeout(r, delayMs));
    const meta = await scrapeItemMetadata(uuid);

    // Extract image info from manifest
    const canvases = manifest.items || [];
    const pageCount = canvases.length;
    const thumbnail = manifest.thumbnail?.[0]?.id || null;

    // Build title from pressmark + metadata
    const pressmark = meta?.pressmark || manifest.metadata?.find(m => m.label?.en?.[0] === 'Pressmark')?.value?.['@none']?.[0] || uuid;
    const title = meta?.title || pressmark;
    const manifestUrl = `${IDP_IIIF}/${uuid}`;

    // Parse date range
    let dateEarliest = null, dateLatest = null;
    if (meta?.date) {
      // IDP dates are like "5th-6th century", "9th century", "before 1036"
      const centuryMatch = meta.date.match(/(\d+)(?:st|nd|rd|th)\s*(?:-\s*(\d+)(?:st|nd|rd|th))?\s*century/i);
      if (centuryMatch) {
        dateEarliest = (parseInt(centuryMatch[1]) - 1) * 100;
        dateLatest = (parseInt(centuryMatch[2] || centuryMatch[1])) * 100;
      }
      const yearMatch = meta.date.match(/(\d{3,4})/);
      if (yearMatch && !centuryMatch) {
        dateEarliest = parseInt(yearMatch[1]);
        dateLatest = dateEarliest;
      }
    }

    const doc = {
      source: SOURCE,
      source_id: uuid,
      title,
      author: null,
      author_surname: null,
      language: meta?.language || null,
      date_earliest: dateEarliest,
      date_latest: dateLatest,
      publisher: null,
      place: meta?.find_site || null,
      manifest_url: manifestUrl,
      viewer_url: `${IDP_BASE}/collection/${uuid}/`,
      thumbnail,
      page_count: pageCount,
      scan_quality: 'high',
      rights: manifest.requiredStatement?.value?.en?.[0] || 'See IDP for terms',
      status: 'discovered',
      subjects: meta?.subject_tags || [subject],
      idp_metadata: {
        pressmark,
        script: meta?.script || null,
        material: meta?.material || null,
        item_type: meta?.item_type || null,
        item_subtype: meta?.item_subtype || null,
        institution: meta?.institution || null,
        dimensions: meta?.dimensions || null,
        description: meta?.description || null,
        date_raw: meta?.date || null,
      },
      discovered_at: new Date(),
      harvested_at: new Date(),
    };

    if (!dryRun) {
      await db.collection('import_candidates').insertOne(doc);
    }

    totalInserted++;

    if (totalInserted <= 5 || totalInserted % 50 === 0) {
      console.log(`  [${totalDiscovered}] ${pressmark} — ${title?.substring(0, 60)} (${pageCount} canvases, ${meta?.language || '?'})`);
    }
  }

  page++;
}

// ── Summary ──────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════');
console.log(`IDP DUNHUANG HARVEST — ${subject.toUpperCase()}`);
console.log('════════════════════════════════════════');
console.log(`Pages scraped: ${page - startPage}`);
console.log(`Items discovered: ${totalDiscovered}`);
console.log(`Inserted: ${totalInserted}`);
console.log(`Skipped (existing): ${totalSkipped}`);
console.log(`Errors: ${totalErrors}`);
console.log(`Dry run: ${dryRun}`);

await client.close();
