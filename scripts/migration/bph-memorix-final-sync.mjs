#!/usr/bin/env node
/**
 * BPH Memorix final sync — 2026-05-19 archive → bph_works (+ bph_work_files).
 *
 * This is the FINAL Memorix sync. After it lands, bph_works becomes the
 * authoritative source for the BPH catalog; Memorix is no longer pulled.
 *
 * Plan:      .claude/docs/bph-memorix-alignment-2026-05-19.md
 * Diff JSON: .claude/docs/bph-memorix-alignment-2026-05-19.json
 * Schema:    scripts/migration/bph-memorix-final-sync.sql  (run that FIRST)
 * Tracker:   https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/1881
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *
 *   # Default: dry-run, all steps reported, no writes.
 *   node scripts/migration/bph-memorix-final-sync.mjs
 *
 *   # Single step, dry-run (recommended workflow — review per step):
 *   node scripts/migration/bph-memorix-final-sync.mjs --step 2
 *
 *   # Apply (writes!). Always run dry-run first.
 *   node scripts/migration/bph-memorix-final-sync.mjs --step 2 --apply
 *
 * Steps:
 *   0  Snapshot bph_works to ./backups/bph_works-<timestamp>.jsonl.gz
 *   2  Backfill memorix_raw/files/counters for ~27,703 in-both printed rows
 *   3  Apply ~105 field-level updates from upstream changes (uuid-keyed)
 *   4  Insert 467 new printed rows (record_type='printed')
 *   5  Insert 812 manuscript rows (record_type='manuscript')
 *   6  Insert 959 photocopy rows (record_type='photocopy')
 *   7  Set cross_listed_with_uuid for the 2 sammelband pairs
 *   8  Delete the 3 truly-removed rows (UBN 12507, 12204, plus one null-UBN)
 *
 *   Step 1 (SQL apply) and Step 9 (scans XML → bph_work_files) are out of
 *   scope here. Step 1 runs via the .sql file. Step 9 waits on Picturae's
 *   scans XML and will be a follow-up PR.
 *
 * Safety invariants enforced in code:
 *   - WHERE uuid IS NOT NULL on all uuid-keyed ops (never touches the 102
 *     Allard-Pierson PH-synthesized rows).
 *   - NEVER_OVERWRITE columns are skipped on every UPDATE (sl_book_id,
 *     ia_*, *_norm, field_provenance, search_tsv, bibliographic_format, etc.).
 *   - --apply is required to write; default is dry-run.
 *   - Each step reports counts + sample diffs before writing.
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { join } from 'node:path';

// ---------- CLI ----------
const { values: args } = parseArgs({
  options: {
    step: { type: 'string', default: 'all' },
    'xml-dir': { type: 'string', default: 'data/bph-memorix/2026-05-19' },
    'backup-dir': { type: 'string', default: 'backups' },
    apply: { type: 'boolean', default: false },
    limit: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n').slice(1, 50).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const STEP = args.step;
const APPLY = args.apply;
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const XML_DIR = args['xml-dir'];
const BACKUP_DIR = args['backup-dir'];

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const MODE = APPLY ? '\x1b[31mAPPLY\x1b[0m' : '\x1b[33mDRY-RUN\x1b[0m';
console.log(`[bph-memorix-final-sync] step=${STEP} mode=${MODE} xml-dir=${XML_DIR}`);

// ---------- Field maps ----------
// XML field name → bph_works column name. Each map covers one record_type.

const PRINTED_FIELDS = {
  titel: 'title',
  paralleltitel: 'parallel_title',
  alternatieve_titel: 'uniform_title',
  deeltitel_genummerd: 'volume_title',
  serietitel_genummerd: 'series_title',
  auteur: 'author',
  altern_aut_naam: 'variant_author',
  auteursvermelding: 'pseudonym',
  redacteur: 'editor',
  altern_red_naam: 'variant_editor',
  drukker: 'printer',
  altern_drukkersnaam: 'variant_printer',
  uitgever: 'publisher',
  altern_uitg_naam: 'variant_publisher',
  plaats_van_uitgave: 'place',
  jaar_van_uitgave: 'year_raw',
  keywords: 'keywords',
  language: 'language',
  signatuur: 'shelf_mark',
  band: 'binding',
  bijgebonden_in_bij: 'bound_with',
  provenance: 'provenance',
  bph_opmerkingen: 'internal_remarks',
  web_opmerkingen: 'remarks',
  referentie: 'bibliography',
  uniek_boek_nummer: 'ubn',
  picturae_barcode: 'picturae_barcode',
  status: 'work_status',
  aantal_exemplaren: 'number_of_copies',
  afmeting_in_cm_hxbxd: 'object_size_cm',
  present_location: 'present_location',
  acquisition_date: 'acquisition_date',
  acquisition_source: 'acquisition_source',
  price: 'price',
  fully_approved: 'fully_approved',
  delivered: 'delivered_to_customer',
  publish_scan: 'publish_scan',
};

// Manuscripts (derek10) use English-language XML field names.
// Note: 'statem_of_responsibility' has an upstream typo we preserve.
// Note: 'date' is free-form ("17th c., ca. 1650") — goes to ms_date, not year_raw.
const MANUSCRIPT_FIELDS = {
  picturae_barcode: 'picturae_barcode',
  shelf_mark: 'shelf_mark',
  icn_registration_number: 'icn_registration_number',
  author: 'author',
  statem_of_responsibility: 'statement_of_responsibility',
  full_title: 'full_title',
  uniform_title: 'uniform_title',
  object_size_in_cm: 'object_size_cm',
  date: 'ms_date',
  language: 'language',
  binding: 'binding',
  characterization: 'characterization',
  origin: 'origin',
  physical_description: 'physical_description',
  script: 'script',
  provenance: 'provenance',
  bibliography: 'bibliography',
  remarks: 'remarks',
  compiler: 'compiler',
  contents: 'contents',
  illumination_illustration: 'illumination_illustration',
  acquisition: 'acquisition_source',
  edition: 'edition_note',
  scribe: 'scribe',
  iconography: 'iconography',
  fully_approved: 'fully_approved',
  delivered: 'delivered_to_customer',
  publish_scan: 'publish_scan',
};

// Photocopies (derek 3) use Dutch field names matching printed plus journal-specific.
const PHOTOCOPY_FIELDS = {
  picturae_barcode: 'picturae_barcode',
  titel: 'title',
  auteur: 'author',
  auteursvermelding: 'pseudonym',
  jaar: 'year_raw',
  locatie: 'shelf_mark',
  titel_tijdschrift: 'journal_title',
  vol_nummer: 'volume_number',
  collatie: 'pagination',
  annotatie: 'annotation',
  fully_approved: 'fully_approved',
  delivered: 'delivered_to_customer',
  publish_scan: 'publish_scan',
};

const BOOLEAN_COLUMNS = new Set(['fully_approved', 'delivered_to_customer', 'publish_scan']);

// Columns we MUST NEVER overwrite via this sync. They are our own enrichments
// or derivations — not part of the Memorix authority.
const NEVER_OVERWRITE = new Set([
  'sl_book_id', 'sl_book_slug', 'sl_external_book_id', 'sl_external_slug', 'sl_external_source',
  'ia_identifier', 'ia_url', 'ia_match_confidence', 'ia_match_method',
  'ia_title_similarity', 'ia_author_match', 'ia_year_match', 'ia_matched_at',
  'ia_match_validated', 'ia_match_is_same_work', 'ia_match_is_same_edition',
  'ia_match_validated_by', 'ia_match_validation_notes', 'ia_match_validated_at',
  'ustc_sn', 'bibliographic_format', 'field_provenance',
  'title_norm', 'author_norm', 'editor_norm', 'place_norm',
  'printer_norm', 'publisher_norm', 'shelf_mark_norm', 'search_norm', 'search_tsv',
  'detected_language', 'created_at', 'id',
]);

// The 3 rows known to be deleted upstream (per .claude/docs/bph-memorix-alignment-2026-05-19.md).
// Identified by UBN; one has NULL UBN and is matched by uuid being NULL too (handled in Step 8).
const DELETE_TARGETS_BY_UBN = ['12507', '12204'];

// The 2 sammelband cross-listings (RIT001000026, RIT001000028).
// Each entry: printed bph_works.uuid (existing in DB) ↔ manuscript bph_works.uuid (to insert in Step 5).
const SAMMELBAND_PAIRS = [
  {
    barcode: 'RIT001000026',
    printedUuid: '25974bc9-96a9-b790-5c19-3b9d865a8e27',
    manuscriptUuid: '8aa695c2-28bf-4eb3-3794-2e633bb59fb5',
  },
  {
    barcode: 'RIT001000028',
    printedUuid: '2a1ceb4c-ef06-4a4c-2e77-7116f0fa4457',
    manuscriptUuid: '8cc9a6c1-e4a1-caab-3aae-54cf8e40f099',
  },
];

// XML file names inside --xml-dir
const XML_FILES = {
  printed: 'derek9_e4116d78-ecc5-585b-d348-bfe68d5e09b3.xml',
  manuscript: 'derek10_db422530-79ce-9f0c-12b6-208f9661d93c.xml',
  photocopy: 'derek 3_0bbd183b-6763-682b-a120-0b89c95ebaac.xml',
};

// ---------- Helpers ----------

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function normalizeText(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = decodeEntities(s);
  s = s.replace(/\s+/g, ' ');
  return s;
}

function parseYearFromRaw(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseIntOrNull(s) {
  if (s === null || s === undefined || s === '') return null;
  const n = parseInt(String(s).trim(), 10);
  return Number.isNaN(n) ? null : n;
}

// Parse one <record> body into a {fieldName: stringValue} map. Handles
// self-closing fields, pipe-joined multi-values, and TRUE/FALSE booleans.
function parseFields(body) {
  const map = {};
  const re = /<field name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/field>)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (m[2] === '/>') { map[name] = ''; continue; }
    const inner = m[3] || '';
    const values = [...inner.matchAll(/<value>([\s\S]*?)<\/value>/g)]
      .map(v => v[1].trim())
      .filter(Boolean);
    if (values.length === 0) { map[name] = ''; continue; }
    if (values[0] === 'TRUE' || values[0] === 'FALSE') {
      map[name] = values[0] === 'TRUE' ? '1' : '0';
    } else {
      map[name] = values.join('|');
    }
  }
  return map;
}

// Parse the <files> block of a record into [{uuid, name, filesize, mimetype}].
function parseFiles(body) {
  const filesMatch = body.match(/<files>([\s\S]*?)<\/files>/);
  if (!filesMatch) return [];
  const filesBlock = filesMatch[1];
  const out = [];
  const attrRe = /<file\s+([^>]+?)\/?>/g;
  let m;
  while ((m = attrRe.exec(filesBlock)) !== null) {
    const attrs = m[1];
    const get = (k) => {
      const r = attrs.match(new RegExp(`${k}="([^"]*)"`));
      return r ? r[1] : null;
    };
    const uuid = get('uuid');
    if (!uuid) continue;
    out.push({
      uuid,
      name: get('name'),
      filesize: parseIntOrNull(get('filesize')),
      mimetype: get('mimetype'),
    });
  }
  return out;
}

function readRecords(xmlPath, recordType) {
  if (!existsSync(xmlPath)) {
    throw new Error(`XML not found: ${xmlPath}\n  Hint: unzip ~/Downloads/Archive 2.zip into ${XML_DIR}/`);
  }
  process.stderr.write(`Parsing ${recordType} XML (${(statSync(xmlPath).size / 1024 / 1024).toFixed(1)} MB)…\n`);
  const xml = readFileSync(xmlPath, 'utf8');
  const recRe = /<record uuid="([^"]+)">([\s\S]*?)<\/record>/g;
  const records = [];
  let m;
  while ((m = recRe.exec(xml)) !== null) {
    const uuid = m[1];
    const body = m[2];
    const fields = parseFields(body);
    const files = parseFiles(body);
    records.push({ uuid, fields, files });
    if (records.length >= LIMIT) break;
  }
  process.stderr.write(`  ${records.length} records\n`);
  return records;
}

// Build the column-update object for a record, applying its field map.
// Returns null if no mappable values found.
function recordToColumns(record, fieldMap) {
  const cols = {};
  for (const [xmlField, dbCol] of Object.entries(fieldMap)) {
    if (NEVER_OVERWRITE.has(dbCol)) continue;
    const raw = record.fields[xmlField];
    if (raw === undefined || raw === '') continue;
    if (BOOLEAN_COLUMNS.has(dbCol)) {
      cols[dbCol] = raw === '1';
    } else {
      cols[dbCol] = normalizeText(raw);
    }
  }
  // Derived: year (int) from year_raw (string).
  if (cols.year_raw && cols.year === undefined) {
    const y = parseYearFromRaw(cols.year_raw);
    if (y !== null) cols.year = y;
  }
  // Numeric: number_of_copies.
  if (cols.number_of_copies !== undefined && cols.number_of_copies !== null) {
    cols.number_of_copies = parseIntOrNull(cols.number_of_copies);
  }
  return Object.keys(cols).length ? cols : null;
}

function buildMemorixRaw(record) {
  return {
    memorix_raw: record.fields,
    memorix_files: record.files,
    memorix_modified_time: parseModifiedTime(record.fields.modified_time),
    memorix_file_count: record.files.length,
    memorix_total_file_bytes: record.files.reduce((sum, f) => sum + (f.filesize || 0), 0),
  };
}

function parseModifiedTime(s) {
  if (!s) return null;
  const t = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

// ---------- Supabase REST helpers ----------

async function supabaseFetch(path, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${init.method || 'GET'} ${path} → ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res;
}

async function pageAll(table, select, filter = '') {
  const PAGE = 1000;
  let offset = 0;
  const out = [];
  while (true) {
    const res = await supabaseFetch(
      `/${table}?select=${select}${filter}&order=uuid.asc`,
      {
        headers: { Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' },
      }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`pageAll non-array: ${JSON.stringify(rows).slice(0, 300)}`);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
    process.stderr.write(`  loaded ${out.length}…\r`);
  }
  process.stderr.write(`  loaded ${out.length}.\n`);
  return out;
}

async function updateByUuid(uuid, body) {
  await supabaseFetch(`/bph_works?uuid=eq.${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { Prefer: 'return=minimal' },
  });
}

async function insertBatch(rows) {
  if (!rows.length) return;
  await supabaseFetch(`/bph_works`, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: 'return=minimal' },
  });
}

async function deleteByUuid(uuid) {
  await supabaseFetch(`/bph_works?uuid=eq.${encodeURIComponent(uuid)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

async function deleteByUbn(ubn) {
  await supabaseFetch(`/bph_works?ubn=eq.${encodeURIComponent(ubn)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

// ---------- Schema verification ----------

async function verifySchema() {
  const required = ['record_type', 'memorix_raw', 'memorix_files', 'memorix_modified_time',
    'memorix_file_count', 'memorix_total_file_bytes', 'cross_listed_with_uuid',
    'full_title', 'script', 'scribe', 'ms_date', 'journal_title', 'volume_number',
    'pagination', 'annotation', 'statement_of_responsibility'];
  try {
    await supabaseFetch(`/bph_works?select=${required.join(',')}&limit=1`);
  } catch (err) {
    throw new Error(
      `Schema verification failed — did you apply scripts/migration/bph-memorix-final-sync.sql?\n  ${err.message}`
    );
  }
}

// ---------- Step 0: Backup ----------

async function step0_backup() {
  console.log('\n=== Step 0: Backup bph_works to JSONL.gz ===');
  if (!APPLY) {
    console.log('  [DRY-RUN] Would page through bph_works and write to', BACKUP_DIR);
    return;
  }
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(BACKUP_DIR, `bph_works-pre-memorix-sync-${stamp}.jsonl.gz`);
  console.log(`  Writing ${out}`);
  // Stream rows: page → JSON.stringify → gzip → file.
  async function* lines() {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const res = await supabaseFetch(
        `/bph_works?select=*&order=id.asc`,
        { headers: { Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' } },
      );
      const rows = await res.json();
      for (const r of rows) yield JSON.stringify(r) + '\n';
      if (rows.length < PAGE) break;
      offset += PAGE;
      process.stderr.write(`  backed up ${offset}…\r`);
    }
    process.stderr.write('\n');
  }
  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(out));
  console.log(`  ✓ Backup complete: ${out}`);
  console.log(`  Now upload manually: aws s3 cp ${out} s3://bph-backups/  (or wrangler r2)`);
}

// ---------- Step 2: Backfill memorix_raw + counters for in-both printed rows ----------

async function step2_backfillRaw() {
  console.log('\n=== Step 2: Backfill memorix_raw/files/counters for in-both printed rows ===');
  await verifySchema();
  const dbRows = await pageAll('bph_works', 'uuid', '&record_type=eq.printed&uuid=not.is.null');
  const dbUuids = new Set(dbRows.map(r => r.uuid));
  const records = readRecords(join(XML_DIR, XML_FILES.printed), 'BPH printed');

  let toUpdate = 0, skipped = 0;
  const sample = [];
  for (const r of records) {
    if (!dbUuids.has(r.uuid)) { skipped++; continue; }
    toUpdate++;
    if (sample.length < 3) sample.push({ uuid: r.uuid, fileCount: r.files.length, totalBytes: r.files.reduce((s, f) => s + (f.filesize || 0), 0) });
  }
  console.log(`  Will UPDATE: ${toUpdate}`);
  console.log(`  Skipped (new-in-XML, handled in Step 4): ${skipped}`);
  console.log(`  Sample: ${JSON.stringify(sample, null, 2)}`);

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  let done = 0;
  for (const r of records) {
    if (!dbUuids.has(r.uuid)) continue;
    await updateByUuid(r.uuid, buildMemorixRaw(r));
    if (++done % 200 === 0) process.stderr.write(`  updated ${done}/${toUpdate}…\r`);
  }
  console.log(`  ✓ Updated ${done} rows.`);
}

// ---------- Step 3: Apply field-level updates ----------

async function step3_fieldUpdates() {
  console.log('\n=== Step 3: Apply field-level updates (~105 rows) ===');
  await verifySchema();
  const compareCols = Object.values(PRINTED_FIELDS).filter(c => !NEVER_OVERWRITE.has(c));
  const DB_COLS = ['uuid', 'ubn', 'year', ...compareCols];
  const dbRows = await pageAll('bph_works', DB_COLS.join(','), '&record_type=eq.printed&uuid=not.is.null');
  const dbByUuid = new Map(dbRows.map(r => [r.uuid, r]));
  const records = readRecords(join(XML_DIR, XML_FILES.printed), 'BPH printed');

  const updates = [];
  for (const r of records) {
    const db = dbByUuid.get(r.uuid);
    if (!db) continue;
    const diff = {};
    // Compare every mapped column — including cases where XML clears a value
    // that the DB still has. Matches the original _tmp-bph-field-diff.mjs
    // logic that produced the 105 figure in the plan.
    for (const [xmlField, dbCol] of Object.entries(PRINTED_FIELDS)) {
      if (NEVER_OVERWRITE.has(dbCol)) continue;
      const rawXml = r.fields[xmlField];
      let xv, dv = db[dbCol];
      if (BOOLEAN_COLUMNS.has(dbCol)) {
        xv = rawXml === '1';
        dv = !!dv;
        if (xv !== dv) diff[dbCol] = xv;
      } else {
        xv = (rawXml === undefined || rawXml === '') ? null : normalizeText(rawXml);
        const dvNorm = dv === null || dv === undefined || dv === '' ? null : String(dv);
        const xvNorm = xv === null ? null : String(xv);
        if (dvNorm !== xvNorm) diff[dbCol] = xv;
      }
    }
    if (diff.number_of_copies !== undefined && diff.number_of_copies !== null) {
      diff.number_of_copies = parseIntOrNull(diff.number_of_copies);
    }
    if (diff.year_raw !== undefined) {
      const y = parseYearFromRaw(diff.year_raw);
      if (y !== db.year) diff.year = y;
    }
    if (Object.keys(diff).length) updates.push({ uuid: r.uuid, ubn: db.ubn, diff });
  }
  console.log(`  Rows with field updates: ${updates.length}`);

  // Per-column change tallies (sanity check vs the plan's 105 figure).
  const colCounts = {};
  for (const u of updates) for (const c of Object.keys(u.diff)) colCounts[c] = (colCounts[c] || 0) + 1;
  console.log('  Changes by column:');
  for (const [c, n] of Object.entries(colCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c}: ${n}`);
  }
  console.log('  First 5 updates:');
  for (const u of updates.slice(0, 5)) {
    const small = Object.fromEntries(Object.entries(u.diff).map(([k, v]) => [k, typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v]));
    console.log(`    UBN ${u.ubn} uuid=${u.uuid.slice(0, 8)}…: ${JSON.stringify(small)}`);
  }

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  let done = 0;
  for (const u of updates) {
    await updateByUuid(u.uuid, u.diff);
    if (++done % 25 === 0) process.stderr.write(`  applied ${done}/${updates.length}…\r`);
  }
  console.log(`  ✓ Applied ${done} field-level updates.`);
}

// ---------- Step 4: Insert new printed rows ----------

async function step4_newPrinted() {
  console.log('\n=== Step 4: Insert 467 new printed rows ===');
  await verifySchema();
  const dbRows = await pageAll('bph_works', 'uuid', '&uuid=not.is.null');
  const dbUuids = new Set(dbRows.map(r => r.uuid));
  const records = readRecords(join(XML_DIR, XML_FILES.printed), 'BPH printed');

  const newRows = [];
  for (const r of records) {
    if (dbUuids.has(r.uuid)) continue;
    const cols = recordToColumns(r, PRINTED_FIELDS) || {};
    newRows.push({
      uuid: r.uuid,
      record_type: 'printed',
      ...cols,
      ...buildMemorixRaw(r),
    });
  }
  console.log(`  Will INSERT: ${newRows.length}`);
  console.log(`  First 3 (truncated):`);
  for (const row of newRows.slice(0, 3)) {
    console.log(`    uuid=${row.uuid.slice(0, 8)}… ubn=${row.ubn || '-'} title=${(row.title || '').slice(0, 60)}`);
  }

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < newRows.length; i += BATCH) {
    await insertBatch(newRows.slice(i, i + BATCH));
    done += Math.min(BATCH, newRows.length - i);
    process.stderr.write(`  inserted ${done}/${newRows.length}…\r`);
  }
  console.log(`  ✓ Inserted ${done} new printed rows.`);
}

// ---------- Step 5: Insert manuscripts ----------

async function step5_manuscripts() {
  console.log('\n=== Step 5: Insert 812 manuscript rows ===');
  await verifySchema();
  const records = readRecords(join(XML_DIR, XML_FILES.manuscript), 'Handschriften');
  // Manuscript records all have unique uuids (none currently in bph_works), but verify.
  const dbRows = await pageAll('bph_works', 'uuid', '&uuid=not.is.null');
  const dbUuids = new Set(dbRows.map(r => r.uuid));

  const newRows = [];
  let collisions = 0;
  for (const r of records) {
    if (dbUuids.has(r.uuid)) { collisions++; continue; }
    const cols = recordToColumns(r, MANUSCRIPT_FIELDS) || {};
    newRows.push({
      uuid: r.uuid,
      record_type: 'manuscript',
      ...cols,
      ...buildMemorixRaw(r),
    });
  }
  if (collisions) console.log(`  ⚠ ${collisions} uuid collisions with existing rows (expected 0); will skip those.`);
  console.log(`  Will INSERT: ${newRows.length}`);
  console.log(`  Sample:`);
  for (const row of newRows.slice(0, 3)) {
    console.log(`    uuid=${row.uuid.slice(0, 8)}… barcode=${row.picturae_barcode || '-'} shelf_mark=${row.shelf_mark || '-'} full_title=${(row.full_title || '').slice(0, 50)}`);
  }

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < newRows.length; i += BATCH) {
    await insertBatch(newRows.slice(i, i + BATCH));
    done += Math.min(BATCH, newRows.length - i);
    process.stderr.write(`  inserted ${done}/${newRows.length}…\r`);
  }
  console.log(`  ✓ Inserted ${done} manuscript rows.`);
}

// ---------- Step 6: Insert photocopies ----------

async function step6_photocopies() {
  console.log('\n=== Step 6: Insert 959 photocopy rows ===');
  await verifySchema();
  const records = readRecords(join(XML_DIR, XML_FILES.photocopy), 'Fotocopieen');
  const dbRows = await pageAll('bph_works', 'uuid', '&uuid=not.is.null');
  const dbUuids = new Set(dbRows.map(r => r.uuid));

  const newRows = [];
  let collisions = 0;
  for (const r of records) {
    if (dbUuids.has(r.uuid)) { collisions++; continue; }
    const cols = recordToColumns(r, PHOTOCOPY_FIELDS) || {};
    newRows.push({
      uuid: r.uuid,
      record_type: 'photocopy',
      ...cols,
      ...buildMemorixRaw(r),
    });
  }
  if (collisions) console.log(`  ⚠ ${collisions} uuid collisions; will skip.`);
  console.log(`  Will INSERT: ${newRows.length}`);
  console.log(`  Sample:`);
  for (const row of newRows.slice(0, 3)) {
    console.log(`    uuid=${row.uuid.slice(0, 8)}… title=${(row.title || '').slice(0, 50)} journal=${(row.journal_title || '').slice(0, 30)}`);
  }

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < newRows.length; i += BATCH) {
    await insertBatch(newRows.slice(i, i + BATCH));
    done += Math.min(BATCH, newRows.length - i);
    process.stderr.write(`  inserted ${done}/${newRows.length}…\r`);
  }
  console.log(`  ✓ Inserted ${done} photocopy rows.`);
}

// ---------- Step 7: Sammelband cross-listing ----------

async function step7_crossListing() {
  console.log('\n=== Step 7: Set cross_listed_with_uuid for 2 sammelband pairs ===');
  await verifySchema();
  // Verify both sides exist (after Step 5).
  const allUuids = new Set([
    ...SAMMELBAND_PAIRS.map(p => p.printedUuid),
    ...SAMMELBAND_PAIRS.map(p => p.manuscriptUuid),
  ]);
  const rows = await pageAll('bph_works', 'uuid,record_type,ubn,picturae_barcode',
    `&uuid=in.(${[...allUuids].join(',')})`);
  const byUuid = new Map(rows.map(r => [r.uuid, r]));

  const ops = [];
  for (const p of SAMMELBAND_PAIRS) {
    const printed = byUuid.get(p.printedUuid);
    const mss = byUuid.get(p.manuscriptUuid);
    if (!printed) { console.log(`  ⚠ printed side missing: ${p.barcode} ${p.printedUuid} — skipping`); continue; }
    if (!mss) { console.log(`  ⚠ manuscript side missing: ${p.barcode} ${p.manuscriptUuid} — did Step 5 run? skipping`); continue; }
    ops.push({ uuid: p.printedUuid, cross_listed_with_uuid: p.manuscriptUuid, label: `${p.barcode} printed→mss` });
    ops.push({ uuid: p.manuscriptUuid, cross_listed_with_uuid: p.printedUuid, label: `${p.barcode} mss→printed` });
  }
  console.log(`  Will UPDATE: ${ops.length} (expected 4)`);
  for (const o of ops) console.log(`    ${o.label}: uuid=${o.uuid.slice(0, 8)}… ← ${o.cross_listed_with_uuid.slice(0, 8)}…`);

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  for (const o of ops) {
    await updateByUuid(o.uuid, { cross_listed_with_uuid: o.cross_listed_with_uuid });
  }
  console.log(`  ✓ Linked ${ops.length} cross-listings.`);
}

// ---------- Step 8: Delete the 3 truly-removed rows ----------

async function step8_deletes() {
  console.log('\n=== Step 8: Delete 3 truly-removed rows ===');
  await verifySchema();

  // First two: identified by UBN.
  for (const ubn of DELETE_TARGETS_BY_UBN) {
    const res = await supabaseFetch(`/bph_works?ubn=eq.${encodeURIComponent(ubn)}&select=id,uuid,ubn,title,sl_book_id`);
    const rows = await res.json();
    if (rows.length === 0) {
      console.log(`  UBN ${ubn}: not found (already deleted?)`);
      continue;
    }
    for (const r of rows) {
      if (r.sl_book_id) {
        console.log(`  ⚠ UBN ${ubn} has sl_book_id=${r.sl_book_id} — REFUSING to delete (linked to live SL book). Skipping.`);
        continue;
      }
      console.log(`  Will DELETE: UBN ${r.ubn} id=${r.id} uuid=${r.uuid || 'null'} title=${(r.title || '').slice(0, 60)}`);
      if (APPLY) await deleteByUbn(ubn);
    }
  }

  // Third: the null-UBN orphan. Plan says exactly one such row; uuid may or
  // may not be null. Cross-reference against the diff to find which one is
  // the documented orphan (only Memorix uuid NOT present in any XML export
  // = truly-removed orphan).
  const res = await supabaseFetch(`/bph_works?ubn=is.null&select=id,uuid,ubn,title,sl_book_id,picturae_barcode`);
  const orphans = await res.json();
  if (orphans.length === 0) {
    console.log(`  Null-UBN orphan: not found (already deleted?)`);
  } else if (orphans.length > 1) {
    console.log(`  ⚠ Found ${orphans.length} null-UBN rows; the plan expected exactly 1. Listing them — investigate manually before applying Step 8.`);
    for (const r of orphans) {
      console.log(`    id=${r.id} uuid=${r.uuid || 'null'} sl=${r.sl_book_id || '-'} barcode=${r.picturae_barcode || '-'} title=${(r.title || '').slice(0, 60)}`);
    }
  } else {
    const r = orphans[0];
    if (r.sl_book_id) {
      console.log(`  ⚠ null-UBN orphan has sl_book_id=${r.sl_book_id} — REFUSING to delete. Skipping.`);
    } else {
      console.log(`  Will DELETE: id=${r.id} uuid=${r.uuid || 'null'} barcode=${r.picturae_barcode || '-'} title=${(r.title || '').slice(0, 60)}`);
      if (APPLY) {
        // id is the PK — narrow to exactly one row.
        await supabaseFetch(`/bph_works?id=eq.${r.id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
      }
    }
  }

  if (!APPLY) console.log('  [DRY-RUN] No deletes performed.');
}

// ---------- Dispatcher ----------

const STEPS = {
  0: step0_backup,
  2: step2_backfillRaw,
  3: step3_fieldUpdates,
  4: step4_newPrinted,
  5: step5_manuscripts,
  6: step6_photocopies,
  7: step7_crossListing,
  8: step8_deletes,
};

async function main() {
  const order = [0, 2, 3, 4, 5, 6, 7, 8];
  let toRun;
  if (STEP === 'all') {
    toRun = order;
  } else {
    const n = parseInt(STEP, 10);
    if (!Number.isInteger(n) || !STEPS[n]) {
      console.error(`Unknown --step "${STEP}". Valid: ${order.join(', ')} or "all".`);
      process.exit(1);
    }
    toRun = [n];
  }
  for (const n of toRun) {
    await STEPS[n]();
  }
  console.log('\n[done]');
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  console.error(err.stack);
  process.exit(1);
});
