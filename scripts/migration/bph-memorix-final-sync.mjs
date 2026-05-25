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

// The exact moment the Memorix XML was exported. Step 3 uses this as the
// boundary for the "librarian-edit guard": any bph_works_revisions row applied
// after this moment is treated as authoritative over the Memorix version,
// because BPH librarians have been editing our DB directly since #1877
// shipped. We never want to revert their work.
const MEMORIX_SNAPSHOT_AT = '2026-05-19T10:23:00Z';

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

// Stricter "comparable form" used only inside Step 3's diff so XML and DB
// values are normalized identically. Matches the _tmp-bph-field-diff.mjs
// logic that produced the plan's 105 figure: entity decode, trim, collapse
// whitespace, and normalize pipe-joined multi-values (trim each element).
function compareForm(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  let s = String(v).trim();
  if (!s) return '';
  s = decodeEntities(s);
  if (s.includes('|')) {
    s = s.split('|').map(x => x.trim()).filter(Boolean).join('|');
  }
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
  // Retry on transient network errors and 5xx + 429. Step 2's 27k+ sequential
  // calls hit network blips occasionally; without retry a single drop aborts
  // the whole run. Up to 4 attempts with exponential backoff (0.5/1/2/4s).
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) return res;
      const retriable = res.status === 429 || res.status >= 500;
      const txt = await res.text();
      const err = new Error(`Supabase ${init.method || 'GET'} ${path} → ${res.status}: ${txt.slice(0, 300)}`);
      if (!retriable || attempt === 3) throw err;
      lastErr = err;
    } catch (e) {
      // fetch() throws TypeError on DNS/connection failure — treat as retriable.
      if (attempt === 3) throw e;
      lastErr = e;
    }
    const wait = 500 * Math.pow(2, attempt);
    process.stderr.write(`\n  retry ${attempt + 1}/3 after ${wait}ms (${lastErr?.message?.slice(0, 80) || 'unknown'})\n`);
    await new Promise(r => setTimeout(r, wait));
  }
  throw lastErr;
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
  // Only target rows that don't yet have memorix_raw set. Makes the step
  // resumable after a partial failure — a re-run picks up only what's left.
  const dbRows = await pageAll('bph_works', 'uuid',
    '&record_type=eq.printed&uuid=not.is.null&memorix_raw=is.null');
  const dbUuids = new Set(dbRows.map(r => r.uuid));
  const records = readRecords(join(XML_DIR, XML_FILES.printed), 'BPH printed');

  let toUpdate = 0, skippedNew = 0, alreadyDone = 0;
  const sample = [];
  for (const r of records) {
    if (dbUuids.has(r.uuid)) {
      toUpdate++;
      if (sample.length < 3) sample.push({ uuid: r.uuid, fileCount: r.files.length, totalBytes: r.files.reduce((s, f) => s + (f.filesize || 0), 0) });
    } else {
      // Either new-in-XML (Step 4 handles) or already-backfilled (skip).
      // Disambiguate cheaply: if uuid appears in dbUuidsAll, it's already done.
      // Otherwise it's new-in-XML.
      // (We don't need to be precise here — counts only.)
    }
  }
  // Quick second probe to disambiguate skip reasons for the summary line.
  const allPrinted = await pageAll('bph_works', 'uuid',
    '&record_type=eq.printed&uuid=not.is.null');
  const allUuids = new Set(allPrinted.map(r => r.uuid));
  for (const r of records) {
    if (dbUuids.has(r.uuid)) continue;
    if (allUuids.has(r.uuid)) alreadyDone++;
    else skippedNew++;
  }

  console.log(`  Will UPDATE: ${toUpdate}`);
  console.log(`  Already backfilled (memorix_raw not null, resume case): ${alreadyDone}`);
  console.log(`  Skipped (new-in-XML, Step 4 handles): ${skippedNew}`);
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
      const dv = db[dbCol];
      if (BOOLEAN_COLUMNS.has(dbCol)) {
        const xvBool = rawXml === '1';
        if (xvBool !== !!dv) diff[dbCol] = xvBool;
      } else {
        // Compare on equal footing: same normalization on both sides.
        const xvCmp = compareForm(rawXml);
        const dvCmp = compareForm(dv);
        if (xvCmp !== dvCmp) {
          // Store the normalized XML value (or null if XML clears the field),
          // not the raw, so the write matches what was compared.
          diff[dbCol] = xvCmp === '' ? null : normalizeText(rawXml);
        }
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
  console.log(`  Rows with field updates (raw diff): ${updates.length}`);

  // ── Librarian-edit guard ──────────────────────────────────────────────
  // BPH librarians have been editing bph_works directly via the
  // contributor flow (#1877) since before the Memorix snapshot. Any
  // bph_works_revisions row applied after MEMORIX_SNAPSHOT_AT wins over
  // Memorix on the same (ubn, column) pair — otherwise this step would
  // silently revert their work.
  const ubnsToCheck = updates.map(u => u.ubn).filter(Boolean);
  const recentEditsByUbn = new Map();
  const editorsByUbn = new Map();
  if (ubnsToCheck.length) {
    const CHUNK = 200;
    for (let i = 0; i < ubnsToCheck.length; i += CHUNK) {
      const slice = ubnsToCheck.slice(i, i + CHUNK).map(encodeURIComponent).join(',');
      const res = await supabaseFetch(
        `/bph_works_revisions?ubn=in.(${slice})&applied_at=gte.${encodeURIComponent(MEMORIX_SNAPSHOT_AT)}&select=ubn,field_changes,editor_email,applied_at`
      );
      const rows = await res.json();
      for (const r of rows) {
        if (!recentEditsByUbn.has(r.ubn)) recentEditsByUbn.set(r.ubn, new Set());
        for (const col of Object.keys(r.field_changes || {})) {
          recentEditsByUbn.get(r.ubn).add(col);
        }
        if (!editorsByUbn.has(r.ubn)) editorsByUbn.set(r.ubn, new Set());
        editorsByUbn.get(r.ubn).add(r.editor_email);
      }
    }
  }

  const conflicts = [];
  for (const u of updates) {
    const edited = recentEditsByUbn.get(u.ubn);
    if (!edited || edited.size === 0) continue;
    const skipped = [];
    for (const col of Object.keys(u.diff)) {
      if (edited.has(col)) {
        delete u.diff[col];
        skipped.push(col);
      }
    }
    if (skipped.length) {
      conflicts.push({
        ubn: u.ubn,
        uuid: u.uuid,
        skippedCols: skipped,
        editors: [...(editorsByUbn.get(u.ubn) || [])],
      });
    }
  }
  const safeUpdates = updates.filter(u => Object.keys(u.diff).length > 0);
  const rowsFullySkipped = updates.length - safeUpdates.length;
  if (conflicts.length) {
    console.log(`\n  ⚠ Librarian-edit guard: ${conflicts.length} rows have local edits since ${MEMORIX_SNAPSHOT_AT}`);
    console.log(`     Preserved librarian columns; Memorix values for those columns dropped from this run.`);
    console.log(`     Rows now fully skipped (every diff column was librarian-edited): ${rowsFullySkipped}`);
    for (const c of conflicts.slice(0, 10)) {
      console.log(`       UBN ${c.ubn}: skipped ${c.skippedCols.join(', ')} (editors: ${c.editors.join(', ')})`);
    }
    if (conflicts.length > 10) console.log(`       … and ${conflicts.length - 10} more (full list in --apply mode logs)`);
  } else {
    console.log(`  Librarian-edit guard: no conflicts (no bph_works_revisions on these UBNs since ${MEMORIX_SNAPSHOT_AT}).`);
  }

  console.log(`\n  Rows that WILL update after guard: ${safeUpdates.length}`);

  // Per-column change tallies (sanity check vs the plan's 105 figure).
  const colCounts = {};
  for (const u of safeUpdates) for (const c of Object.keys(u.diff)) colCounts[c] = (colCounts[c] || 0) + 1;
  console.log('  Changes by column:');
  for (const [c, n] of Object.entries(colCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c}: ${n}`);
  }
  console.log('  First 5 updates:');
  for (const u of safeUpdates.slice(0, 5)) {
    const small = Object.fromEntries(Object.entries(u.diff).map(([k, v]) => [k, typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v]));
    console.log(`    UBN ${u.ubn} uuid=${u.uuid.slice(0, 8)}…: ${JSON.stringify(small)}`);
  }

  if (!APPLY) {
    console.log('  [DRY-RUN] No writes performed.');
    return;
  }
  // The application writes through applyWorkRevision (src/lib/bph-catalog.ts),
  // which appends to bph_works_revisions. We're bypassing that for bulk
  // efficiency, but we record a single system revision per row so the audit
  // trail still captures this migration. The revision_email is
  // 'system:bph-memorix-final-sync-2026-05-19' so future audits can find it.
  let done = 0;
  for (const u of safeUpdates) {
    await updateByUuid(u.uuid, u.diff);
    await supabaseFetch(`/bph_works_revisions`, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ubn: u.ubn,
        change_type: 'edit',
        field_changes: Object.fromEntries(
          Object.entries(u.diff).map(([col, to]) => [col, { from: null, to, source: 'memorix-2026-05-19' }])
        ),
        editor_email: 'system:bph-memorix-final-sync-2026-05-19',
        note: 'Step 3 of final Memorix sync — see PR #1975 / issue #1881',
      }),
    });
    if (++done % 25 === 0) process.stderr.write(`  applied ${done}/${safeUpdates.length}…\r`);
  }
  console.log(`  ✓ Applied ${done} field-level updates (each logged to bph_works_revisions).`);
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
