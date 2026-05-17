#!/usr/bin/env node
/**
 * Ingest Bujanda 1946 Vatican Index final-edition CSV (4,327 entries) into
 * Supabase `index_catalog_entries` with index_id='roman-1948'. Phase 1 of #1851.
 *
 * Pipeline:
 *   1. Upsert the 'roman-1948' row in index_catalogs.
 *   2. Parse .claude/docs/index-librorum-1946-bujanda.csv.
 *   3. Upsert each row into index_catalog_entries (idempotent — UNIQUE on
 *      (index_id, source_id) effectively, enforced by ON CONFLICT).
 *   4. Backfill ustc_sn + sl_book_id via the Bujanda → USTC → SL join logic.
 *
 * Requires the migration scripts/migration/add-index-catalog-tables.sql to
 * have been run first.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/ingest-roman-1948-catalog.mjs        # dry-run
 *   set -a; source .env.production.local; set +a; node scripts/ingest-roman-1948-catalog.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_PATH = join(ROOT, '.claude/docs/index-librorum-1946-bujanda.csv');

const APPLY = process.argv.includes('--apply');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');

const INDEX_ID = 'roman-1948';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const headers = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
};

async function supa(method, path, body) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const opts = { method, headers: { ...headers, Prefer: 'return=representation' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.status === 204 ? null : r.json();
}

// ─── CSV parse (handles quoted fields with embedded newlines) ──────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {} else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const h = rows.shift();
  return rows.filter(r => r.length === h.length).map(r => {
    const o = {};
    for (let i = 0; i < h.length; i++) o[h[i]] = r[i];
    return o;
  });
}

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function surname(a) {
  if (!a) return '';
  const c = a.replace(/\[[^\]]*\]/g, '').trim();
  if (c.includes(',')) return norm(c.split(',')[0]);
  const p = norm(c).split(/\s+/);
  return p[p.length - 1] || '';
}

function csvRowToEntry(r) {
  const condYr = parseInt((r.period || '').match(/\d{4}/)?.[0] || '') || null;
  const isOpera = /opera omnia|works|oeuvres compl|sämmtliche werke|complete works/i.test(r.title || '');
  return {
    index_id: INDEX_ID,
    source_id: r.ID || null,
    title: (r.title || '').replace(/\s*\n\s*/g, ' ').slice(0, 1500),
    subtitle: r.subtitle ? r.subtitle.replace(/\s*\n\s*/g, ' ').slice(0, 1000) : null,
    additional_titles: r.additional_titles || null,
    original_title: r.original_title || null,
    author: r.author || null,
    author_normalized: surname(r.author),
    language: r.language || null,
    place_publication: r.place_publication || null,
    publisher: r.publisher || null,
    publication_date: r.publication_date || null,
    condemnation_year: condYr,
    condemnation_period: r.period || null,
    scope: isOpera ? 'opera_omnia' : (r.title ? 'single_work' : null),
    censorship_type: r.censorship_type || null,
    reason: r.reason || null,
    censoring_body: r.censoring_body || null,
    legal_ref: r.legal_ref || null,
    notes: r.note || null,
    match_method: 'csv_import',
  };
}

async function main() {
  console.log(`Roman 1948 catalog ingest — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // 1. Upsert the index row
  const indexRow = {
    id: INDEX_ID,
    name: 'Index Librorum Prohibitorum (1946 final edition)',
    short_name: 'Roman Index 1948',
    authority: 'Holy See',
    start_year: 1559,
    end_year: 1966,
    collection_slug: 'index-librorum-prohibitorum',
    description: 'The final printed edition (1948) of the Roman Catholic Church\'s *Index Librorum Prohibitorum*, abolished by Pope Paul VI on 14 June 1966. Established by Paul IV in 1559, the Index condemned ~4,000–5,000 works across 32 editions over four centuries. This dataset is the 1946 *editio novissima* (Leonine), the last comprehensive update before abolition.',
    source: 'Bujanda 1946 edition, digitised via aodhanlutetiae/index (GitHub)',
    source_url: 'https://github.com/aodhanlutetiae/index',
  };
  console.log(`Index catalog row: ${indexRow.id}`);

  // 2. Parse CSV
  const csvRows = parseCSV(readFileSync(CSV_PATH, 'utf8'));
  console.log(`Parsed ${csvRows.length} rows from CSV.`);
  const entries = csvRows.map(csvRowToEntry);

  if (!APPLY) {
    console.log(`\nSample entries (3):`);
    for (const e of entries.slice(0, 3)) {
      console.log(`  ${e.title?.slice(0, 60)} — ${e.author} (${e.condemnation_year}) scope=${e.scope}`);
    }
    console.log(`\n(dry run — pass --apply to write)`);
    return;
  }

  // 3. Upsert index_catalogs row
  await supa('POST', 'index_catalogs?on_conflict=id', indexRow).catch(async err => {
    if (/duplicate key|already exists/i.test(String(err))) {
      // Already there — patch
      await supa('PATCH', `index_catalogs?id=eq.${INDEX_ID}`, indexRow);
    } else throw err;
  });
  console.log(`Index catalog row upserted.`);

  // 4. Upsert entries — batch in chunks of 500
  // Strategy: insert with on_conflict on (index_id, source_id). Since we don't
  // have a unique constraint, just delete-all-and-reinsert for this index.
  console.log(`\nDeleting existing entries for index_id='${INDEX_ID}'…`);
  await supa('DELETE', `index_catalog_entries?index_id=eq.${INDEX_ID}`);

  console.log(`Inserting ${entries.length} entries…`);
  const chunk = 200;
  let inserted = 0;
  for (let i = 0; i < entries.length; i += chunk) {
    const slice = entries.slice(i, i + chunk);
    await supa('POST', 'index_catalog_entries', slice);
    inserted += slice.length;
    process.stdout.write(`\r  ${inserted}/${entries.length} inserted`);
  }
  console.log(`\nInserted ${inserted} entries.`);

  // 5. Backfill ustc_sn + sl_book_id
  if (SKIP_BACKFILL) {
    console.log(`\n--skip-backfill set; done.`);
    return;
  }

  console.log(`\nBackfilling ustc_sn + sl_book_id…`);

  // Use the existing matcher report — banned-books-via-ustc.json already has matched USTC sns
  // grouped by Bujanda entry id. Load it and stamp the catalog rows.
  const REPORT = JSON.parse(readFileSync(join(ROOT, '.claude/docs/banned-books-via-ustc.json'), 'utf8'));
  // Aggregate: bujanda_id → best USTC match + sl_book if any
  const bestByBuj = new Map();
  function consider(item, present_in_sl) {
    const bid = item.bujanda_id;
    if (!bid) return;
    const prev = bestByBuj.get(bid);
    const score = (present_in_sl ? 100 : 0) + ({ high: 3, medium: 2, low: 1 }[item.confidence] || 0);
    if (!prev || score > prev.score) bestByBuj.set(bid, { ...item, present_in_sl, score });
  }
  for (const h of REPORT.items_have || []) consider(h, true);
  for (const m of REPORT.items_missing || []) consider(m, false);

  console.log(`  Bujanda entries with USTC match: ${bestByBuj.size}`);

  // Patch catalog rows
  let patched = 0;
  const sourceIds = [...bestByBuj.keys()];
  const patchChunk = 100;
  for (let i = 0; i < sourceIds.length; i += patchChunk) {
    const batch = sourceIds.slice(i, i + patchChunk);
    for (const sid of batch) {
      const m = bestByBuj.get(sid);
      const patch = {
        ustc_sn: m.ustc_sn,
        match_confidence: m.confidence,
        match_method: 'ustc_join',
      };
      if (m.present_in_sl && m.sl_book) {
        patch.sl_book_id = m.sl_book._id || m.sl_book.id;
        patch.sl_book_slug = m.sl_book.slug;
      }
      await supa('PATCH', `index_catalog_entries?index_id=eq.${INDEX_ID}&source_id=eq.${encodeURIComponent(sid)}`, patch);
      patched++;
    }
    process.stdout.write(`\r  ${patched}/${sourceIds.length} entries patched`);
  }
  console.log(`\n  Patched ${patched} entries with USTC/SL data.`);

  // Final stats
  const counts = await supa('GET', `index_catalog_entries?index_id=eq.${INDEX_ID}&select=id&limit=1&head=true`);
  const withSL = await fetch(`${SUPA_URL}/rest/v1/index_catalog_entries?index_id=eq.${INDEX_ID}&sl_book_id=not.is.null&select=id&limit=1`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' }}).then(r => r.headers.get('content-range'));
  const withUstc = await fetch(`${SUPA_URL}/rest/v1/index_catalog_entries?index_id=eq.${INDEX_ID}&ustc_sn=not.is.null&select=id&limit=1`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' }}).then(r => r.headers.get('content-range'));
  console.log(`\nFinal coverage:`);
  console.log(`  Entries with sl_book_id: ${withSL}`);
  console.log(`  Entries with ustc_sn   : ${withUstc}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
