#!/usr/bin/env node
/**
 * Study 1: Mine existing OCR outputs from the database
 *
 * Extracts page-level covariates and OCR metadata for all pages with OCR,
 * grouped by model used. Identifies hallucination candidates via output length.
 *
 * Usage:
 *   node scripts/eval/mine-existing-ocr.mjs survey --sample=500
 *   node scripts/eval/mine-existing-ocr.mjs hallucination-scan --threshold=3
 *   node scripts/eval/mine-existing-ocr.mjs model-comparison
 *   node scripts/eval/mine-existing-ocr.mjs export-csv --output=results/study1.csv
 */

import { MongoClient } from 'mongodb';
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

let client;
async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  return client.db('bookstore');
}

// ── Survey: sample pages with full covariates ─────────────────────────

async function cmdSurvey() {
  const sampleSize = parseInt(args.sample || '500');
  const db = await getDb();

  console.log(`\nStudy 1: Feature Space Survey (${sampleSize} pages)\n`);

  // Sample pages with OCR, stratified across languages
  const pipeline = [
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $sample: { size: sampleSize } },
    { $project: {
      book_id: 1,
      page_number: 1,
      page_type: 1,
      script_type: 1,
      columns: 1,
      image_width: 1,
      image_height: 1,
      split_from_spread: 1,
      enhanced_photo: { $cond: [{ $ifNull: ['$enhanced_photo', false] }, true, false] },
      detected_images_count: { $size: { $ifNull: ['$detected_images', []] } },
      semantic_alignment_score: '$semantic_alignment.score',
      ocr_model: '$ocr.model',
      ocr_char_count: { $strLenCP: { $ifNull: ['$ocr.data', ''] } },
      ocr_input_tokens: '$ocr.input_tokens',
      ocr_output_tokens: '$ocr.output_tokens',
      translation_char_count: { $strLenCP: { $ifNull: ['$translation.data', ''] } },
    }}
  ];

  console.log('Sampling pages...');
  const pages = await db.collection('pages').aggregate(pipeline, { maxTimeMS: 60000 }).toArray();
  console.log(`  Got ${pages.length} pages`);

  // Enrich with book-level data
  const bookIds = [...new Set(pages.map(p => p.book_id))];
  console.log(`  From ${bookIds.length} books — fetching book metadata...`);

  const books = await db.collection('books').find(
    { $or: [{ id: { $in: bookIds } }, { _id: { $in: bookIds } }] },
    { projection: {
      id: 1, _id: 1,
      language: 1,
      resource_type: 1,
      'image_source.provider': 1,
      'scan_quality.score': 1,
      'scan_quality.classification': 1,
      pages_count: 1,
    }}
  ).toArray();

  const bookMap = new Map();
  for (const b of books) {
    bookMap.set(b.id || b._id.toString(), b);
  }

  // Combine and compute derived features
  const rows = [];
  for (const p of pages) {
    const book = bookMap.get(p.book_id) || {};
    rows.push({
      book_id: p.book_id,
      page_number: p.page_number,
      // Page features
      page_type: p.page_type || 'unknown',
      script_type: p.script_type || 'unknown',
      columns: p.columns || 1,
      image_width: p.image_width || 0,
      image_height: p.image_height || 0,
      aspect_ratio: p.image_width && p.image_height ? +(p.image_width / p.image_height).toFixed(3) : 0,
      resolution_mp: p.image_width && p.image_height ? +((p.image_width * p.image_height) / 1e6).toFixed(2) : 0,
      split_from_spread: !!p.split_from_spread,
      enhanced: !!p.enhanced_photo,
      has_illustrations: p.detected_images_count > 0,
      illustration_count: p.detected_images_count,
      semantic_alignment: p.semantic_alignment_score || null,
      // OCR features
      ocr_model: p.ocr_model || 'unknown',
      ocr_char_count: p.ocr_char_count || 0,
      ocr_input_tokens: p.ocr_input_tokens || 0,
      ocr_output_tokens: p.ocr_output_tokens || 0,
      translation_char_count: p.translation_char_count || 0,
      // Book features
      language: book.language || 'unknown',
      resource_type: book.resource_type || 'unknown',
      provider: book.image_source?.provider || 'unknown',
      scan_quality_score: book.scan_quality?.score || null,
      scan_quality_class: book.scan_quality?.classification || 'unknown',
      pages_total: book.pages_count || 0,
    });
  }

  // Summary statistics
  console.log('\n=== FEATURE DISTRIBUTIONS ===\n');

  // Language breakdown
  const byLang = {};
  for (const r of rows) { byLang[r.language] = (byLang[r.language] || 0) + 1; }
  console.log('Languages:');
  for (const [lang, n] of Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${lang.padEnd(15)} ${n}`);
  }

  // OCR model breakdown
  const byModel = {};
  for (const r of rows) { byModel[r.ocr_model] = (byModel[r.ocr_model] || 0) + 1; }
  console.log('\nOCR Models:');
  for (const [model, n] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model.padEnd(40)} ${n}`);
  }

  // Script type
  const byScript = {};
  for (const r of rows) { byScript[r.script_type] = (byScript[r.script_type] || 0) + 1; }
  console.log('\nScript type:');
  for (const [t, n] of Object.entries(byScript).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(20)} ${n}`);
  }

  // Resource type
  const byResource = {};
  for (const r of rows) { byResource[r.resource_type] = (byResource[r.resource_type] || 0) + 1; }
  console.log('\nResource type:');
  for (const [t, n] of Object.entries(byResource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(20)} ${n}`);
  }

  // OCR char count distribution
  const charCounts = rows.map(r => r.ocr_char_count).filter(c => c > 0).sort((a, b) => a - b);
  if (charCounts.length > 0) {
    const p = (pct) => charCounts[Math.floor(charCounts.length * pct / 100)] || 0;
    console.log('\nOCR char count:');
    console.log(`  P5=${p(5)}  P25=${p(25)}  P50=${p(50)}  P75=${p(75)}  P95=${p(95)}  max=${charCounts[charCounts.length-1]}`);
  }

  // Provider breakdown
  const byProvider = {};
  for (const r of rows) { byProvider[r.provider] = (byProvider[r.provider] || 0) + 1; }
  console.log('\nTop providers:');
  for (const [p, n] of Object.entries(byProvider).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${p.padEnd(25)} ${n}`);
  }

  // Hallucination candidates: char count > 3x median for that language
  console.log('\n=== HALLUCINATION CANDIDATES ===\n');
  const medianByLang = {};
  for (const lang of Object.keys(byLang)) {
    const langChars = rows.filter(r => r.language === lang && r.ocr_char_count > 0).map(r => r.ocr_char_count).sort((a, b) => a - b);
    if (langChars.length > 5) medianByLang[lang] = langChars[Math.floor(langChars.length / 2)];
  }

  let hallucinationCount = 0;
  for (const r of rows) {
    const median = medianByLang[r.language];
    if (median && r.ocr_char_count > median * 3) {
      hallucinationCount++;
      if (hallucinationCount <= 20) {
        console.log(`  ${r.language.padEnd(12)} ${r.ocr_model.padEnd(35)} ${r.ocr_char_count.toString().padStart(8)} chars (${(r.ocr_char_count/median).toFixed(1)}x median) book=${r.book_id} p${r.page_number}`);
      }
    }
  }
  console.log(`\nTotal hallucination candidates (>3x lang median): ${hallucinationCount} / ${rows.length} (${(hallucinationCount/rows.length*100).toFixed(1)}%)`);

  // Save results
  const outPath = path.join(__dirname, 'results', `study1-survey-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ rows, summary: { byLang, byModel, byScript, byResource, byProvider, medianByLang }, meta: { date: new Date().toISOString(), sampleSize: rows.length } }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

// ── Hallucination scan: find all potential hallucinations ─────────────

async function cmdHallucinationScan() {
  const threshold = parseFloat(args.threshold || '3');
  const db = await getDb();

  console.log(`\nHallucination Scan (threshold: ${threshold}x language median)\n`);

  // Get median OCR length per language (from a large sample)
  const langMedians = await db.collection('pages').aggregate([
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $project: { book_id: 1, ocr_len: { $strLenCP: '$ocr.data' }, ocr_model: '$ocr.model' } },
    { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
    { $unwind: '$book' },
    { $group: {
      _id: { language: '$book.language', model: '$ocr_model' },
      chars: { $push: '$ocr_len' },
      count: { $sum: 1 },
    }},
  ], { maxTimeMS: 120000 }).toArray();

  console.log('Language × Model medians:');
  for (const g of langMedians.sort((a, b) => b.count - a.count).slice(0, 20)) {
    const sorted = g.chars.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const overThreshold = sorted.filter(c => c > median * threshold).length;
    console.log(`  ${(g._id.language || '?').padEnd(12)} ${(g._id.model || '?').padEnd(35)} n=${g.count.toString().padStart(6)}  median=${median.toString().padStart(5)}  p95=${p95.toString().padStart(6)}  >${threshold}x: ${overThreshold} (${(overThreshold/g.count*100).toFixed(1)}%)`);
  }
}

// ── Model comparison: pages with both Flash and Lite ──────────────────

async function cmdModelComparison() {
  const db = await getDb();

  console.log('\nModel Comparison: Finding books with different OCR models...\n');

  // Find books where ocr.model varies across pages
  const modelMix = await db.collection('pages').aggregate([
    { $match: { 'ocr.data': { $exists: true, $ne: '' }, 'ocr.model': { $exists: true } } },
    { $group: {
      _id: '$book_id',
      models: { $addToSet: '$ocr.model' },
      count: { $sum: 1 },
    }},
    { $match: { 'models.1': { $exists: true } } }, // has at least 2 different models
    { $sort: { count: -1 } },
    { $limit: 50 },
  ], { maxTimeMS: 60000 }).toArray();

  console.log(`Books with multiple OCR models: ${modelMix.length}`);
  for (const b of modelMix.slice(0, 20)) {
    const book = await db.collection('books').findOne(
      { $or: [{ id: b._id }, { _id: b._id }] },
      { projection: { title: 1, language: 1 } }
    );
    console.log(`  ${(book?.title || b._id).slice(0, 50).padEnd(50)} ${(book?.language || '?').padEnd(12)} models: ${b.models.join(', ')}`);
  }

  // Also check: how many pages total per model?
  const modelCounts = await db.collection('pages').aggregate([
    { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
    { $group: { _id: '$ocr.model', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ], { maxTimeMS: 60000 }).toArray();

  console.log('\nTotal pages per OCR model:');
  for (const m of modelCounts) {
    console.log(`  ${(m._id || 'null/missing').padEnd(40)} ${m.count.toLocaleString()}`);
  }
}

// ── Export CSV ────────────────────────────────────────────────────────

async function cmdExportCsv() {
  const outFile = args.output || 'results/study1.csv';
  const latest = fs.readdirSync(path.join(__dirname, 'results'))
    .filter(f => f.startsWith('study1-survey-') && f.endsWith('.json'))
    .sort()
    .pop();

  if (!latest) { console.error('No survey results found. Run: mine-existing-ocr.mjs survey first'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', latest)));
  const headers = Object.keys(data.rows[0]);
  const csv = [headers.join(','), ...data.rows.map(r => headers.map(h => {
    const v = r[h];
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }).join(','))].join('\n');

  const outPath = path.join(__dirname, outFile);
  fs.writeFileSync(outPath, csv);
  console.log(`Exported ${data.rows.length} rows to ${outPath}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  try {
    switch (command) {
      case 'survey': await cmdSurvey(); break;
      case 'hallucination-scan': await cmdHallucinationScan(); break;
      case 'model-comparison': await cmdModelComparison(); break;
      case 'export-csv': await cmdExportCsv(); break;
      default:
        console.log('Usage: mine-existing-ocr.mjs <survey|hallucination-scan|model-comparison|export-csv>');
    }
  } finally {
    if (client) await client.close();
  }
}

main();
