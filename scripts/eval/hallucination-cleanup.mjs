#!/usr/bin/env node
/**
 * Hallucination Detection & Cleanup
 *
 * Identifies hallucinated pages in production using the 3x-median-char-count
 * heuristic from Study 1, then re-OCRs them with Lite + thinkingLevel: HIGH.
 *
 * Usage:
 *   node scripts/eval/hallucination-cleanup.mjs scan                    # detect hallucinated pages
 *   node scripts/eval/hallucination-cleanup.mjs scan --lang=Hebrew      # one language
 *   node scripts/eval/hallucination-cleanup.mjs fix --limit=10          # re-OCR top N worst pages
 *   node scripts/eval/hallucination-cleanup.mjs fix --lang=Hebrew       # re-OCR one language
 *   node scripts/eval/hallucination-cleanup.mjs stats                   # show detection stats
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
    } else { args._.push(arg); }
  }
  return args;
}

const args = parseArgs(process.argv);
const command = args._[0];

// Language medians from Study 1
const MEDIANS = {
  'Hebrew': { flash: 2035, lite: 2149 },
  'Greek': { flash: 2164, lite: 2177 },
  'Arabic': { flash: 1734, lite: 2019 },
  'Chinese': { flash: 531, lite: 655 },
  'Syriac': { flash: 1729, lite: 2094 },
  'Sanskrit': { flash: 1709, lite: 1836 },
  'Persian': { flash: 1912, lite: 542 },
  'Armenian': { flash: 2063, lite: 1698 },
  'Japanese': { flash: 1921, lite: 818 },
  "Ge'ez": { flash: 1232, lite: 765 },
  'Russian': { flash: 2058, lite: 2359 },
  'Sumerian': { flash: 1923, lite: 1891 },
  'Coptic': { flash: 2492, lite: 2357 },
  'Tibetan': { flash: 2560, lite: 2609 },
  'Tamil': { flash: 2022, lite: 2066 },
};

const THRESHOLD = 3; // pages with > 3x median are flagged

const RESULTS_FILE = path.join(__dirname, 'results', 'hallucination-detections.json');

// ── Scan ─────────────────────────────────────────────────────────────

async function cmdScan() {
  const targetLangs = args.lang ? [args.lang] : Object.keys(MEDIANS);

  console.log('=== HALLUCINATION SCAN ===');
  console.log(`Languages: ${targetLangs.length}`);
  console.log(`Threshold: ${THRESHOLD}x median\n`);

  // Get book IDs for target languages
  const bookMap = new Map();
  for (const lang of targetLangs) {
    let offset = 0;
    while (true) {
      const { data } = await sb.from('books_catalog')
        .select('id,language,title')
        .eq('language', lang)
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const b of data) bookMap.set(b.id, b);
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  console.log(`Books to scan: ${bookMap.size}`);
  const allBookIds = [...bookMap.keys()];

  // Scan pages in batches
  const detections = [];
  const BATCH = 20;

  for (let i = 0; i < allBookIds.length; i += BATCH) {
    const batchIds = allBookIds.slice(i, i + BATCH);
    let offset = 0;

    while (true) {
      const { data, error } = await sb.from('pages')
        .select('id,book_id,page_number,ocr_model,ocr_data')
        .in('book_id', batchIds)
        .not('ocr_data', 'is', null)
        .range(offset, offset + 999);

      if (error || !data || data.length === 0) break;

      for (const p of data) {
        const book = bookMap.get(p.book_id);
        if (!book) continue;
        const lang = book.language;
        const medians = MEDIANS[lang];
        if (!medians) continue;

        const charCount = p.ocr_data.length;
        const isFlash = p.ocr_model?.includes('flash') && !p.ocr_model?.includes('lite');
        const median = isFlash ? medians.flash : medians.lite;

        if (charCount > median * THRESHOLD) {
          detections.push({
            page_id: p.id,
            book_id: p.book_id,
            page_number: p.page_number,
            language: lang,
            book_title: book.title,
            ocr_model: p.ocr_model,
            ocr_chars: charCount,
            median,
            ratio: +(charCount / median).toFixed(1),
            model_type: isFlash ? 'flash' : 'lite',
          });
        }
      }

      if (data.length < 1000) break;
      offset += 1000;
    }

    if (i % 200 === 0 && i > 0) {
      process.stdout.write(`\r  scanned ${i}/${allBookIds.length} books, ${detections.length} detections...`);
    }
  }

  console.log(`\n\nTotal detections: ${detections.length}`);

  // Sort by ratio descending
  detections.sort((a, b) => b.ratio - a.ratio);

  // Summary by language x model
  console.log('\n--- BY LANGUAGE x MODEL ---\n');
  const summary = {};
  for (const d of detections) {
    const key = `${d.language}:${d.model_type}`;
    if (!summary[key]) summary[key] = { language: d.language, model: d.model_type, count: 0 };
    summary[key].count++;
  }
  console.log('Language'.padEnd(20), 'Model'.padEnd(8), 'Count'.padStart(8));
  for (const s of Object.values(summary).sort((a, b) => b.count - a.count)) {
    console.log(s.language.padEnd(20), s.model.padEnd(8), s.count.toString().padStart(8));
  }

  // Top 20 worst
  console.log('\n--- TOP 20 WORST ---\n');
  for (const d of detections.slice(0, 20)) {
    console.log(`  ${d.language.padEnd(12)} ${d.model_type.padEnd(6)} ${d.ocr_chars.toString().padStart(8)} chars (${d.ratio}x) ${d.book_title?.slice(0, 40)} p${d.page_number}`);
  }

  // Save
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    detections,
    summary: Object.values(summary),
    meta: { date: new Date().toISOString(), threshold: THRESHOLD, total: detections.length },
  }, null, 2));
  console.log(`\nSaved: ${RESULTS_FILE}`);
}

// ── Stats ────────────────────────────────────────────────────────────

function cmdStats() {
  if (!fs.existsSync(RESULTS_FILE)) { console.log('No detections. Run scan first.'); return; }
  const data = JSON.parse(fs.readFileSync(RESULTS_FILE));
  console.log(`\nTotal hallucination detections: ${data.total}`);
  console.log(`Threshold: ${data.meta.threshold}x median`);
  console.log('\nBy language x model:');
  for (const s of data.summary.sort((a, b) => b.count - a.count)) {
    console.log(`  ${s.language.padEnd(20)} ${s.model.padEnd(8)} ${s.count}`);
  }
}

// ── Fix (placeholder — needs pipeline integration) ───────────────────

async function cmdFix() {
  console.log('=== HALLUCINATION FIX ===\n');
  console.log('Strategy: re-OCR flagged pages with Lite + thinkingLevel: HIGH');
  console.log('This requires pipeline integration (createRevision + OCR worker).');
  console.log('');
  console.log('For now, this script outputs the list of page IDs to re-process.');
  console.log('Feed these to the batch-translate or realtime-ocr scripts.\n');

  if (!fs.existsSync(RESULTS_FILE)) { console.log('Run scan first.'); return; }
  const data = JSON.parse(fs.readFileSync(RESULTS_FILE));

  let detections = data.detections;
  if (args.lang) detections = detections.filter(d => d.language === args.lang);
  if (args.limit) detections = detections.slice(0, parseInt(args.limit));

  console.log(`Pages to re-OCR: ${detections.length}`);
  console.log(`Estimated cost (Lite + HIGH thinking): ~$${(detections.length * 0.002).toFixed(2)}\n`);

  // Output as book_id:page_number list for pipeline consumption
  const outputPath = path.join(__dirname, 'results', 'reocr-queue.txt');
  const lines = detections.map(d => `${d.book_id}\t${d.page_number}\t${d.language}\t${d.ratio}`);
  fs.writeFileSync(outputPath, lines.join('\n'));
  console.log(`Queue saved: ${outputPath} (${lines.length} pages)`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  switch (command) {
    case 'scan': await cmdScan(); break;
    case 'fix': await cmdFix(); break;
    case 'stats': cmdStats(); break;
    default:
      console.log('Usage: hallucination-cleanup.mjs <scan|fix|stats>');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
