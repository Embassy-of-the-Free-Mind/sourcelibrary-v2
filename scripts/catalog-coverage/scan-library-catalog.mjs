#!/usr/bin/env node
/**
 * Library Catalog Scanner — identify undigitized works from any collection.
 *
 * Takes a library catalog (Supabase table, CSV, or JSON) and:
 *   1. Matches each item to USTC (word-overlap + AI matcher)
 *   2. Checks catalog_coverage for digitization status
 *   3. Produces a report: unscanned, scanned-elsewhere, not-in-USTC
 *
 * Usage:
 *   # Scan BPH catalog from Supabase
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/scan-library-catalog.mjs --source supabase --table bph_works --name "Embassy of the Free Mind"
 *
 *   # Scan from CSV
 *   node scripts/catalog-coverage/scan-library-catalog.mjs --source csv --file catalog.csv --name "Library Name"
 *
 *   # Scan from JSON (array of {title, author, year, language?})
 *   node scripts/catalog-coverage/scan-library-catalog.mjs --source json --file items.json --name "Library Name"
 *
 * Options:
 *   --source        Input type: supabase, csv, json
 *   --table         Supabase table name (for --source supabase)
 *   --file          File path (for --source csv or json)
 *   --name          Library display name
 *   --year-from     Filter: earliest year (default: 1450)
 *   --year-to       Filter: latest year (default: 1700)
 *   --limit         Max items to process
 *   --output        Output JSON path (default: scripts/output/catalog-scan-{name}.json)
 *   --skip-ai       Skip AI matching, use word-overlap only
 *
 * GitHub issue: #361
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

// ── Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const source = getArg('source') || 'supabase';
const table = getArg('table') || 'bph_works';
const file = getArg('file');
const libraryName = getArg('name') || table;
const yearFrom = parseInt(getArg('year-from') || '1450');
const yearTo = parseInt(getArg('year-to') || '1700');
const limit = getArg('limit') ? parseInt(getArg('limit')) : Infinity;
const outputPath = getArg('output') || `scripts/output/catalog-scan-${libraryName.toLowerCase().replace(/\s+/g, '-')}.json`;
const skipAi = hasFlag('skip-ai');

// ── Load catalog items ───────────────────────────────────────────────

async function loadFromSupabase(tableName) {
  const items = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${tableName}?year=gte.${yearFrom}&year=lte.${yearTo}&select=ubn,title,author,year,detected_language&order=year&limit=1000&offset=${offset}`;
    const res = await fetch(url, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data.map(d => ({
      id: d.ubn || `${tableName}-${offset}`,
      title: d.title,
      author: d.author,
      year: d.year,
      language: d.detected_language || d.language,
    })));
    offset += 1000;
    if (items.length >= limit) break;
  }
  return items.slice(0, limit);
}

function loadFromCsv(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const records = parse(content, { columns: true, skip_empty_lines: true });
  return records
    .filter(r => {
      const y = parseInt(r.year || r.Year || r.date || '0');
      return y >= yearFrom && y <= yearTo;
    })
    .slice(0, limit)
    .map((r, i) => ({
      id: r.id || r.ID || `csv-${i}`,
      title: r.title || r.Title,
      author: r.author || r.Author,
      year: parseInt(r.year || r.Year || r.date || '0'),
      language: r.language || r.Language || null,
    }));
}

function loadFromJson(filePath) {
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const items = Array.isArray(data) ? data : data.items || data.records || [];
  return items
    .filter(r => {
      const y = r.year || 0;
      return y >= yearFrom && y <= yearTo;
    })
    .slice(0, limit)
    .map((r, i) => ({
      id: r.id || `json-${i}`,
      title: r.title,
      author: r.author,
      year: r.year,
      language: r.language || null,
    }));
}

// ── USTC matching ────────────────────────────────────────────────────

// Import the matcher (TS via tsx loader)
const { matchToUstc } = await import('../../src/lib/ustc-matcher.ts');

// ── Coverage lookup ──────────────────────────────────────────────────

async function checkCoverage(db, ustcSn) {
  const doc = await db.collection('catalog_coverage').findOne(
    { ustc_id: ustcSn },
    { projection: { has_iiif_scan: 1, scan_sources: 1, scan_quality: 1, has_english_translation: 1, translation_sources: 1, in_source_library: 1, source_library_id: 1 } },
  );
  return doc || null;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nLibrary Catalog Scanner`);
  console.log(`Library: ${libraryName}`);
  console.log(`Source: ${source} (${source === 'supabase' ? table : file})`);
  console.log(`Year range: ${yearFrom}–${yearTo}`);
  if (skipAi) console.log('AI matching: DISABLED (word-overlap only)');
  console.log('');

  // Load items
  let items;
  switch (source) {
    case 'supabase': items = await loadFromSupabase(table); break;
    case 'csv': items = loadFromCsv(file); break;
    case 'json': items = loadFromJson(file); break;
    default: console.error(`Unknown source: ${source}`); process.exit(1);
  }
  console.log(`Loaded ${items.length} items\n`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  const results = {
    library: libraryName,
    scanned_at: new Date().toISOString(),
    year_range: `${yearFrom}–${yearTo}`,
    total_items: items.length,
    matched_to_ustc: 0,
    unscanned: [],       // No digital scan anywhere
    scanned_elsewhere: [],  // Scanned by another library
    in_source_library: [],  // Already in SL
    not_in_ustc: [],     // No USTC match (manuscripts, post-scope, rare)
    match_failed: [],    // AI/word-overlap couldn't determine
  };

  let processed = 0;
  let totalCost = 0;

  for (const item of items) {
    processed++;

    // Step 1: Match to USTC
    const matchResult = await matchToUstc(db, {
      title: item.title,
      author: item.author,
      year: item.year,
      language: item.language,
      id: item.id,
    }, { skipFastPath: false });

    if (!matchResult.success) {
      results.match_failed.push({ ...item, error: matchResult.error });
      logProgress(processed, items.length, 'ERROR', item.title);
      continue;
    }

    if (!matchResult.match) {
      results.not_in_ustc.push({
        ...item,
        reason: matchResult.skipped || 'No USTC match found',
      });
      logProgress(processed, items.length, 'NO USTC', item.title);
      continue;
    }

    results.matched_to_ustc++;
    totalCost += matchResult.match.cost_usd;

    // Step 2: Check coverage
    const coverage = await checkCoverage(db, matchResult.match.ustc_sn);

    const enriched = {
      ...item,
      ustc_sn: matchResult.match.ustc_sn,
      ustc_title: matchResult.match.ustc_title,
      match_confidence: matchResult.match.confidence,
      match_method: matchResult.match.match_method,
    };

    if (!coverage || !coverage.has_iiif_scan) {
      results.unscanned.push(enriched);
      logProgress(processed, items.length, 'UNSCANNED', item.title);
    } else if (coverage.in_source_library) {
      results.in_source_library.push({
        ...enriched,
        sl_id: coverage.source_library_id,
        scan_sources: coverage.scan_sources,
      });
      logProgress(processed, items.length, 'IN SL', item.title);
    } else {
      results.scanned_elsewhere.push({
        ...enriched,
        scan_sources: coverage.scan_sources,
        scan_quality: coverage.scan_quality,
      });
      logProgress(processed, items.length, 'SCANNED', item.title);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary
  console.log('\n=== REPORT ===');
  console.log(`Library: ${libraryName}`);
  console.log(`Items scanned: ${items.length}`);
  console.log(`Matched to USTC: ${results.matched_to_ustc} (${pct(results.matched_to_ustc, items.length)}%)`);
  console.log(`Unscanned (priority targets): ${results.unscanned.length}`);
  console.log(`Scanned elsewhere: ${results.scanned_elsewhere.length}`);
  console.log(`In Source Library: ${results.in_source_library.length}`);
  console.log(`Not in USTC: ${results.not_in_ustc.length}`);
  console.log(`Match errors: ${results.match_failed.length}`);
  console.log(`AI cost: $${totalCost.toFixed(4)}`);

  // Provider breakdown for scanned-elsewhere
  if (results.scanned_elsewhere.length > 0) {
    const providers = {};
    for (const r of results.scanned_elsewhere) {
      for (const s of (r.scan_sources || [])) {
        providers[s] = (providers[s] || 0) + 1;
      }
    }
    console.log('\nScan sources for scanned-elsewhere:');
    for (const [p, c] of Object.entries(providers).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${p}: ${c}`);
    }
  }

  // Write output
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nReport written to ${outputPath}`);

  await client.close();
}

function logProgress(n, total, status, title) {
  const t = title?.length > 50 ? title.slice(0, 47) + '...' : title;
  process.stdout.write(`  [${n}/${total}] ${status.padEnd(10)} ${t}\n`);
}

function pct(n, total) {
  return total > 0 ? (n / total * 100).toFixed(1) : '0.0';
}

main().catch(err => { console.error(err); process.exit(1); });
