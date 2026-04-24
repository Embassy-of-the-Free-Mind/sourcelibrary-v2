#!/usr/bin/env node
/**
 * Study 1: Mine existing OCR outputs from Supabase
 *
 * Uses Supabase pages + books_catalog tables (Atlas times out on aggregations).
 * Computes OCR char lengths client-side for targeted subsets.
 *
 * Usage:
 *   node scripts/eval/mine-existing-ocr.mjs counts              # model/page_type/script_type counts
 *   node scripts/eval/mine-existing-ocr.mjs manuscript-scan      # full scan of handwritten/manuscript pages
 *   node scripts/eval/mine-existing-ocr.mjs hallucination-scan   # find long-output pages by language×model
 *   node scripts/eval/mine-existing-ocr.mjs model-comparison     # books with multiple OCR models
 *   node scripts/eval/mine-existing-ocr.mjs export-csv           # export latest results to CSV
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
  } catch {}
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.length > 0 ? rest.join('=') : true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const command = args._[0];

// ── Helpers ────────────────────────────────────────────────────────────

/** Paginate a Supabase query, returning all rows. */
async function fetchAll(table, select, filters = {}, { pageSize = 1000, maxRows = Infinity } = {}) {
  const rows = [];
  let offset = 0;
  while (rows.length < maxRows) {
    let q = sb.from(table).select(select).range(offset, offset + pageSize - 1);
    for (const [col, val] of Object.entries(filters)) {
      if (val === null) q = q.is(col, null);
      else if (typeof val === 'object' && val._op === 'not') q = q.not(col, 'is', null);
      else if (typeof val === 'object' && val._op === 'neq') q = q.neq(col, val.value);
      else q = q.eq(col, val);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Supabase error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
    process.stdout.write(`\r  fetched ${rows.length} rows...`);
  }
  if (rows.length > 0) process.stdout.write(`\r  fetched ${rows.length} rows total\n`);
  return rows.slice(0, maxRows);
}

/** Get exact count with filters. */
async function countRows(table, filters = {}) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filters)) {
    if (val === null) q = q.is(col, null);
    else if (typeof val === 'object' && val._op === 'not') q = q.not(col, 'is', null);
    else if (typeof val === 'object' && val._op === 'neq') q = q.neq(col, val.value);
    else q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) throw new Error(`Count error: ${error.message}`);
  return count;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1)];
}

function printDistribution(label, values) {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return;
  console.log(`\n${label} (n=${sorted.length}):`);
  console.log(`  P5=${percentile(sorted,5)}  P25=${percentile(sorted,25)}  P50=${percentile(sorted,50)}  P75=${percentile(sorted,75)}  P95=${percentile(sorted,95)}  max=${sorted[sorted.length-1]}`);
  console.log(`  mean=${Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length)}`);
}

function printGroupCounts(label, rows, key) {
  const counts = {};
  for (const r of rows) counts[r[key] || 'null'] = (counts[r[key] || 'null'] || 0) + 1;
  console.log(`\n${label}:`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${k.padEnd(40)} ${n.toLocaleString()}`);
  }
  return counts;
}

// ── Counts: fast overview via count queries ────────────────────────────

async function cmdCounts() {
  console.log('\n=== Study 1: OCR Model Distribution ===\n');

  // Total pages with OCR
  const totalOcr = await countRows('pages', { ocr_data: { _op: 'not', value: null } });
  console.log(`Total pages with OCR: ${totalOcr.toLocaleString()}`);

  // Count by model — we know the main models, query each
  const models = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-preview-04-17',
  ];

  console.log('\nPages per OCR model:');
  for (const model of models) {
    const n = await countRows('pages', {
      ocr_model: model,
      ocr_data: { _op: 'not', value: null },
    });
    if (n > 0) console.log(`  ${model.padEnd(40)} ${n.toLocaleString()}`);
  }
  // Also check null/missing model
  const nullModel = await countRows('pages', {
    ocr_model: null,
    ocr_data: { _op: 'not', value: null },
  });
  if (nullModel > 0) console.log(`  ${'(null/missing)'.padEnd(40)} ${nullModel.toLocaleString()}`);

  // Count by page_type
  console.log('\nPages by page_type (with OCR):');
  for (const pt of ['text', 'illustration', 'title_page', 'table_of_contents', 'index', 'blank', 'map', 'diagram', 'music', 'mixed']) {
    const n = await countRows('pages', { page_type: pt, ocr_data: { _op: 'not', value: null } });
    if (n > 0) console.log(`  ${pt.padEnd(25)} ${n.toLocaleString()}`);
  }
  const nullPt = await countRows('pages', { page_type: null, ocr_data: { _op: 'not', value: null } });
  if (nullPt > 0) console.log(`  ${'(null)'.padEnd(25)} ${nullPt.toLocaleString()}`);

  // Count by script_type
  console.log('\nPages by script_type (with OCR):');
  for (const st of ['latin', 'arabic', 'hebrew', 'devanagari', 'tibetan', 'greek', 'chinese', 'japanese', 'korean', 'cyrillic', 'thai', 'ethiopic', 'hieroglyphic', 'cuneiform', 'gothic']) {
    const n = await countRows('pages', { script_type: st, ocr_data: { _op: 'not', value: null } });
    if (n > 0) console.log(`  ${st.padEnd(20)} ${n.toLocaleString()}`);
  }
  const nullSt = await countRows('pages', { script_type: null, ocr_data: { _op: 'not', value: null } });
  if (nullSt > 0) console.log(`  ${'(null)'.padEnd(20)} ${nullSt.toLocaleString()}`);
}

// ── Manuscript scan: non-Latin-script pages via book language ──────────

async function cmdManuscriptScan() {
  console.log('\n=== Study 1: Non-Latin Script Page Scan ===\n');
  console.log('(script_type is 98.5% null — using book language from books_catalog instead)\n');

  // Languages that use non-Latin scripts (hallucination-prone)
  const targetLanguages = [
    'Hebrew', 'Arabic', 'Sanskrit', 'Chinese', 'Classical Chinese',
    'Tibetan', 'Greek', 'Ancient Greek', 'Syriac', 'Japanese', 'Korean',
    'Sumerian', 'Egyptian hieroglyphs', 'Persian', 'Armenian',
    "Ge'ez", 'Coptic', 'Demotic', 'Akkadian', 'Tamil', 'Hindi',
    'Burmese', 'Thai', 'Ethiopic', 'Devanagari', 'Russian',
    'Hebrew and Aramaic', 'Hebrew and Judeo-Arabic',
  ];

  // Step 1: Get book IDs for each target language
  console.log('Fetching book IDs for non-Latin languages...');
  const booksByLang = {};
  for (const lang of targetLanguages) {
    const { data, error: langErr } = await sb.from('books_catalog')
      .select('id,language,resource_type,provider_name,quality_score')
      .eq('language', lang);
    if (langErr) { console.error(`  Error querying ${lang}: ${langErr.message}`); continue; }
    if (data && data.length > 0) {
      booksByLang[lang] = data;
      console.log(`  ${lang.padEnd(30)} ${data.length} books`);
    }
  }

  const bookMap = new Map();
  for (const books of Object.values(booksByLang)) {
    for (const b of books) bookMap.set(b.id, b);
  }
  const allBookIds = [...bookMap.keys()];
  console.log(`\nTotal books: ${allBookIds.length}`);

  // Step 2: Fetch pages for these books (batch by book ID)
  // Only select metadata + ocr_data (for char length computation)
  console.log('\nFetching pages...');
  const allRows = [];
  const BATCH = 20; // batch book IDs per query

  for (let i = 0; i < allBookIds.length; i += BATCH) {
    const batchIds = allBookIds.slice(i, i + BATCH);
    let offset = 0;
    while (true) {
      const { data, error } = await sb.from('pages')
        .select('book_id,page_number,ocr_model,ocr_data,ocr_output_tokens,page_type,script_type,columns')
        .in('book_id', batchIds)
        .not('ocr_data', 'is', null)
        .range(offset, offset + 999);
      if (error) { console.error(`  Error at batch ${i}: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      for (const p of data) {
        allRows.push({
          book_id: p.book_id,
          page_number: p.page_number,
          ocr_model: p.ocr_model || 'unknown',
          ocr_char_count: p.ocr_data ? p.ocr_data.length : 0,
          ocr_output_tokens: p.ocr_output_tokens || 0,
          page_type: p.page_type || 'unknown',
          script_type: p.script_type || null,
          columns: p.columns || 1,
        });
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
    if (i % 200 === 0 && i > 0) process.stdout.write(`\r  processed ${i}/${allBookIds.length} books, ${allRows.length} pages...`);
  }
  console.log(`\nTotal non-Latin pages with OCR: ${allRows.length}`);

  // Enrich with book metadata
  for (const r of allRows) {
    const book = bookMap.get(r.book_id) || {};
    r.language = book.language || 'unknown';
    r.resource_type = book.resource_type || 'unknown';
    r.provider = book.provider_name || 'unknown';
    r.quality_score = book.quality_score || null;
  }

  // ── Analysis ──
  const isFlash = m => m?.includes('flash') && !m?.includes('lite');
  const isLite = m => m?.includes('lite');

  const flashRows = allRows.filter(r => isFlash(r.ocr_model));
  const liteRows = allRows.filter(r => isLite(r.ocr_model));

  console.log('\n=== DISTRIBUTIONS BY MODEL ===');
  console.log(`Flash pages: ${flashRows.length}`);
  console.log(`Lite pages:  ${liteRows.length}`);

  printDistribution('Flash OCR char count', flashRows.map(r => r.ocr_char_count));
  printDistribution('Lite OCR char count', liteRows.map(r => r.ocr_char_count));

  // Per-language breakdown
  const langSet = [...new Set(allRows.map(r => r.language))].sort();
  console.log('\n=== PER-LANGUAGE CHAR COUNT (median) ===');
  console.log(`${'Language'.padEnd(25)} ${'Flash n'.padStart(8)} ${'Flash med'.padStart(10)} ${'Lite n'.padStart(8)} ${'Lite med'.padStart(10)} ${'Ratio'.padStart(8)}`);
  for (const lang of langSet) {
    const fChars = flashRows.filter(r => r.language === lang).map(r => r.ocr_char_count).sort((a,b)=>a-b);
    const lChars = liteRows.filter(r => r.language === lang).map(r => r.ocr_char_count).sort((a,b)=>a-b);
    if (fChars.length < 5 && lChars.length < 5) continue;
    const fMed = fChars.length > 0 ? percentile(fChars, 50) : 0;
    const lMed = lChars.length > 0 ? percentile(lChars, 50) : 0;
    const ratio = fMed > 0 && lMed > 0 ? (lMed / fMed).toFixed(2) : '-';
    console.log(`${lang.padEnd(25)} ${fChars.length.toString().padStart(8)} ${fMed.toString().padStart(10)} ${lChars.length.toString().padStart(8)} ${lMed.toString().padStart(10)} ${ratio.toString().padStart(8)}`);
  }

  // Hallucination candidates: char count > 3x median for that language+model
  console.log('\n=== HALLUCINATION CANDIDATES (>3x language median) ===\n');

  const medians = {};
  for (const lang of langSet) {
    for (const modelType of ['flash', 'lite']) {
      const subset = (modelType === 'flash' ? flashRows : liteRows).filter(r => r.language === lang);
      const chars = subset.map(r => r.ocr_char_count).filter(c => c > 0).sort((a,b)=>a-b);
      if (chars.length > 5) medians[`${lang}:${modelType}`] = percentile(chars, 50);
    }
  }

  let hallCount = 0;
  const hallCandidates = [];
  for (const r of allRows) {
    const modelType = isFlash(r.ocr_model) ? 'flash' : isLite(r.ocr_model) ? 'lite' : null;
    if (!modelType) continue;
    const median = medians[`${r.language}:${modelType}`];
    if (median && r.ocr_char_count > median * 3) {
      hallCount++;
      r.hallucination_ratio = +(r.ocr_char_count / median).toFixed(1);
      hallCandidates.push(r);
    }
  }

  // Sort by ratio descending
  hallCandidates.sort((a, b) => b.hallucination_ratio - a.hallucination_ratio);
  for (const r of hallCandidates.slice(0, 40)) {
    const modelType = isFlash(r.ocr_model) ? 'Flash' : 'Lite';
    console.log(`  ${r.language.padEnd(20)} ${modelType.padEnd(6)} ${r.ocr_char_count.toString().padStart(8)} chars (${r.hallucination_ratio}x) book=${r.book_id} p${r.page_number}`);
  }

  // Summary by language × model
  console.log('\n=== HALLUCINATION RATE BY LANGUAGE × MODEL ===\n');
  console.log(`${'Language'.padEnd(25)} ${'Flash total'.padStart(10)} ${'Flash hall'.padStart(10)} ${'Flash %'.padStart(8)} ${'Lite total'.padStart(10)} ${'Lite hall'.padStart(10)} ${'Lite %'.padStart(8)}`);
  for (const lang of langSet) {
    const fTotal = flashRows.filter(r => r.language === lang).length;
    const lTotal = liteRows.filter(r => r.language === lang).length;
    if (fTotal < 5 && lTotal < 5) continue;
    const fHall = hallCandidates.filter(r => r.language === lang && isFlash(r.ocr_model)).length;
    const lHall = hallCandidates.filter(r => r.language === lang && isLite(r.ocr_model)).length;
    const fPct = fTotal > 0 ? (fHall/fTotal*100).toFixed(1) : '-';
    const lPct = lTotal > 0 ? (lHall/lTotal*100).toFixed(1) : '-';
    console.log(`${lang.padEnd(25)} ${fTotal.toString().padStart(10)} ${fHall.toString().padStart(10)} ${fPct.padStart(7)}% ${lTotal.toString().padStart(10)} ${lHall.toString().padStart(10)} ${lPct.padStart(7)}%`);
  }

  console.log(`\nTotal hallucination candidates: ${hallCount} / ${allRows.length} (${(hallCount/allRows.length*100).toFixed(1)}%)`);
  console.log(`  Flash: ${hallCandidates.filter(r => isFlash(r.ocr_model)).length}`);
  console.log(`  Lite:  ${hallCandidates.filter(r => isLite(r.ocr_model)).length}`);

  // Save results
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `study1-manuscript-${new Date().toISOString().slice(0,10)}.json`);
  // Don't save ocr_data text in results — just the computed fields
  fs.writeFileSync(outPath, JSON.stringify({
    rows: allRows,
    hallucination_candidates: hallCandidates,
    medians,
    meta: { date: new Date().toISOString(), total: allRows.length, languages: langSet },
  }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

// ── Hallucination scan: sampled scan across all languages ──────────────

async function cmdHallucinationScan() {
  const samplePerModel = parseInt(args.sample || '5000');
  console.log(`\n=== Hallucination Scan (${samplePerModel} per model) ===\n`);

  // Sample from each major model
  const modelPatterns = [
    { name: 'Flash', filter: 'gemini-3-flash-preview' },
    { name: 'Lite', filter: 'gemini-3.1-flash-lite-preview' },
    { name: 'Flash-2.0', filter: 'gemini-2.0-flash' },
    { name: 'Lite-2.0', filter: 'gemini-2.0-flash-lite' },
  ];

  const allRows = [];

  for (const { name, filter } of modelPatterns) {
    console.log(`Sampling ${name} (${filter})...`);
    // Random sample: order by a hash of ID, limit
    const pages = await fetchAll('pages',
      'book_id,page_number,ocr_model,ocr_data,page_type,script_type,columns',
      { ocr_model: filter },
      { maxRows: samplePerModel }
    );

    for (const p of pages) {
      allRows.push({
        book_id: p.book_id,
        page_number: p.page_number,
        ocr_model: name,
        ocr_model_full: p.ocr_model,
        ocr_char_count: p.ocr_data ? p.ocr_data.length : 0,
        page_type: p.page_type || 'unknown',
        script_type: p.script_type || 'null',
        columns: p.columns || 1,
      });
    }
  }

  // Enrich with language from books_catalog
  const bookIds = [...new Set(allRows.map(r => r.book_id))];
  console.log(`\nEnriching ${bookIds.length} books with catalog data...`);
  const bookMap = new Map();
  for (let i = 0; i < bookIds.length; i += 100) {
    const batch = bookIds.slice(i, i + 100);
    const { data } = await sb.from('books_catalog')
      .select('id,language,resource_type')
      .in('id', batch);
    if (data) for (const b of data) bookMap.set(b.id, b);
    if (i % 500 === 0 && i > 0) process.stdout.write(`\r  enriched ${i}/${bookIds.length} books...`);
  }
  console.log(`  enriched ${bookMap.size} books`);

  for (const r of allRows) {
    const book = bookMap.get(r.book_id) || {};
    r.language = book.language || 'unknown';
    r.resource_type = book.resource_type || 'unknown';
  }

  // Compute medians per language×model, find outliers
  const groups = {};
  for (const r of allRows) {
    const key = `${r.language}:${r.ocr_model}`;
    if (!groups[key]) groups[key] = { language: r.language, model: r.ocr_model, chars: [] };
    groups[key].chars.push(r.ocr_char_count);
  }

  console.log('\n=== LANGUAGE × MODEL DISTRIBUTIONS ===\n');
  console.log(`${'Language'.padEnd(15)} ${'Model'.padEnd(12)} ${'n'.padStart(7)} ${'median'.padStart(7)} ${'P95'.padStart(7)} ${'mean'.padStart(7)} ${'>3x%'.padStart(6)}`);

  const sortedGroups = Object.values(groups).sort((a, b) => b.chars.length - a.chars.length);
  for (const g of sortedGroups.slice(0, 40)) {
    const sorted = g.chars.sort((a, b) => a - b);
    const med = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const mean = Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length);
    const over3x = sorted.filter(c => c > med * 3).length;
    console.log(`${g.language.padEnd(15)} ${g.model.padEnd(12)} ${sorted.length.toString().padStart(7)} ${med.toString().padStart(7)} ${p95.toString().padStart(7)} ${mean.toString().padStart(7)} ${(over3x/sorted.length*100).toFixed(1).padStart(5)}%`);
  }

  // Top hallucination candidates
  console.log('\n=== TOP HALLUCINATION CANDIDATES ===\n');
  const medianMap = {};
  for (const g of sortedGroups) {
    if (g.chars.length > 10) {
      medianMap[`${g.language}:${g.model}`] = percentile(g.chars.sort((a,b)=>a-b), 50);
    }
  }

  for (const r of allRows) {
    const med = medianMap[`${r.language}:${r.ocr_model}`];
    r.hallucination_ratio = med && med > 0 ? +(r.ocr_char_count / med).toFixed(1) : 0;
  }

  const candidates = allRows.filter(r => r.hallucination_ratio > 3).sort((a,b) => b.hallucination_ratio - a.hallucination_ratio);
  for (const r of candidates.slice(0, 30)) {
    console.log(`  ${r.language.padEnd(12)} ${r.ocr_model.padEnd(10)} ${r.ocr_char_count.toString().padStart(8)} chars (${r.hallucination_ratio}x) ${(r.script_type||'').padEnd(10)} book=${r.book_id} p${r.page_number}`);
  }
  console.log(`\nTotal candidates: ${candidates.length} / ${allRows.length} (${(candidates.length/allRows.length*100).toFixed(1)}%)`);

  // Save
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `study1-hallucination-scan-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    rows: allRows.map(({ ocr_data, ...r }) => r), // don't save full text
    candidates: candidates.slice(0, 200),
    medians: medianMap,
    meta: { date: new Date().toISOString(), total: allRows.length },
  }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

// ── Model comparison: books with multiple OCR models ──────────────────

async function cmdModelComparison() {
  console.log('\n=== Model Comparison: Books with Multiple OCR Models ===\n');

  // Get a sample of pages with their models, group by book
  console.log('Fetching pages with model info...');
  const pages = await fetchAll('pages',
    'book_id,ocr_model',
    { ocr_data: { _op: 'not', value: null } },
    { maxRows: 100000 }
  );

  // Group by book, find those with multiple models
  const bookModels = {};
  for (const p of pages) {
    if (!bookModels[p.book_id]) bookModels[p.book_id] = new Set();
    if (p.ocr_model) bookModels[p.book_id].add(p.ocr_model);
  }

  const multiModel = Object.entries(bookModels)
    .filter(([, models]) => models.size > 1)
    .map(([id, models]) => ({ id, models: [...models] }))
    .sort((a, b) => b.models.length - a.models.length);

  console.log(`Books with multiple OCR models: ${multiModel.length} (out of ${Object.keys(bookModels).length} sampled)\n`);

  // Enrich top results with titles
  const topIds = multiModel.slice(0, 30).map(b => b.id);
  const { data: books } = await sb.from('books_catalog')
    .select('id,title,language')
    .in('id', topIds);
  const titleMap = new Map();
  if (books) for (const b of books) titleMap.set(b.id, b);

  for (const b of multiModel.slice(0, 30)) {
    const book = titleMap.get(b.id) || {};
    console.log(`  ${(book.title || b.id).slice(0, 50).padEnd(50)} ${(book.language || '?').padEnd(12)} ${b.models.join(', ')}`);
  }

  // Overall model distribution
  const modelCounts = {};
  for (const p of pages) {
    modelCounts[p.ocr_model || 'null'] = (modelCounts[p.ocr_model || 'null'] || 0) + 1;
  }
  console.log('\nModel distribution in sample:');
  for (const [m, n] of Object.entries(modelCounts).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(40)} ${n.toLocaleString()}`);
  }
}

// ── Export CSV ────────────────────────────────────────────────────────

async function cmdExportCsv() {
  const outFile = args.output || 'results/study1.csv';
  const resultsDir = path.join(__dirname, 'results');
  const files = fs.readdirSync(resultsDir).filter(f => f.startsWith('study1-') && f.endsWith('.json')).sort();
  const latest = files.pop();

  if (!latest) { console.error('No study1 results found. Run a scan first.'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, latest)));
  const rows = data.rows || data.hallucination_candidates || [];
  if (rows.length === 0) { console.error('No rows in result file'); process.exit(1); }

  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
    const v = r[h];
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }).join(','))].join('\n');

  const outPath = path.join(__dirname, outFile);
  fs.writeFileSync(outPath, csv);
  console.log(`Exported ${rows.length} rows to ${outPath}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  switch (command) {
    case 'counts': await cmdCounts(); break;
    case 'manuscript-scan': await cmdManuscriptScan(); break;
    case 'hallucination-scan': await cmdHallucinationScan(); break;
    case 'model-comparison': await cmdModelComparison(); break;
    case 'export-csv': await cmdExportCsv(); break;
    default:
      console.log('Usage: mine-existing-ocr.mjs <counts|manuscript-scan|hallucination-scan|model-comparison|export-csv>');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
