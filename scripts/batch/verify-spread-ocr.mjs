#!/usr/bin/env node
/**
 * End-to-end verification of spread OCR batch results.
 *
 * Run after batch-collector.mjs has collected results for spread OCR jobs.
 * Checks every step: OCR quality, split position, page-break presence,
 * metadata tags, and generates an HTML report for human review.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/batch/verify-spread-ocr.mjs
 *   node scripts/batch/verify-spread-ocr.mjs --book-id=69c8a26f6c6f3cc53c85e418
 *
 * Checks:
 *   1. Did the batch job complete?
 *   2. Was OCR saved to pages?
 *   3. Does OCR contain <split-position>?
 *   4. Does OCR contain <page-break/>?
 *   5. Does each page half have <language>, <page-type>, <vocab>?
 *   6. Is the split position reasonable (350-650)?
 *   7. Are there any safety blocks or missing pages?
 *
 * Generates: /tmp/spread-ocr-verify.html
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find books with recent spread OCR batch jobs
let query;
if (BOOK_ID) {
  query = { book_id: BOOK_ID, created_at: { $gte: new Date('2026-04-03') } };
} else {
  query = { created_at: { $gte: new Date('2026-04-03') }, job_name: /^batches\//, model: 'gemini-3.1-flash-lite-preview' };
}

const jobs = await db.collection('batch_jobs').find(query).toArray();
const bookIds = [...new Set(jobs.map(j => j.book_id))];

console.log(`Found ${jobs.length} jobs across ${bookIds.length} books`);

const results = [];

for (const bookId of bookIds) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, pages_count: 1, slug: 1 } });
  const bookJobs = jobs.filter(j => j.book_id === bookId);
  const pages = await db.collection('pages').find(
    { book_id: bookId },
    { projection: { id: 1, page_number: 1, photo: 1, 'ocr.data': 1, page_type: 1 } }
  ).sort({ page_number: 1 }).toArray();

  const bookResult = {
    bookId,
    title: book?.title,
    slug: book?.slug,
    pagesCount: book?.pages_count,
    jobCount: bookJobs.length,
    jobStatuses: bookJobs.map(j => j.status),
    totalPages: pages.length,
    checks: [],
    pages: [],
  };

  // Check 1: Job status
  const completed = bookJobs.filter(j => ['completed', 'saved'].includes(j.status));
  const pending = bookJobs.filter(j => j.status === 'pending');
  const failed = bookJobs.filter(j => ['failed', 'expired'].includes(j.status));

  if (pending.length > 0) {
    bookResult.checks.push({ name: 'Job status', status: 'WAITING', detail: `${pending.length} pending, ${completed.length} completed` });
  } else if (completed.length === bookJobs.length) {
    bookResult.checks.push({ name: 'Job status', status: 'PASS', detail: `All ${completed.length} jobs completed` });
  } else {
    bookResult.checks.push({ name: 'Job status', status: 'FAIL', detail: `${failed.length} failed, ${completed.length} completed` });
  }

  // Check 2-7: Per-page checks
  let hasOcr = 0, hasSplitPos = 0, hasPageBreak = 0, hasLanguage = 0, hasPageType = 0, hasVocab = 0;
  let splitPositions = [];
  let missingOcr = [];

  for (const page of pages) {
    const ocr = page.ocr?.data;
    const pageCheck = { pageNumber: page.page_number, photo: page.photo };

    if (!ocr) {
      missingOcr.push(page.page_number);
      pageCheck.status = 'NO_OCR';
      bookResult.pages.push(pageCheck);
      continue;
    }

    hasOcr++;

    const splitMatch = ocr.match(/<split-position>(\d+)<\/split-position>/);
    if (splitMatch) {
      hasSplitPos++;
      const pos = parseInt(splitMatch[1]);
      splitPositions.push(pos);
      pageCheck.splitPosition = pos;
    }

    if (ocr.includes('<page-break/>')) {
      hasPageBreak++;
      pageCheck.hasPageBreak = true;
    }

    if (/<language>[^<]+<\/language>/i.test(ocr)) hasLanguage++;
    if (/<page-type>[^<]+<\/page-type>/i.test(ocr)) hasPageType++;
    if (/<vocab>[^<]+<\/vocab>/i.test(ocr)) hasVocab++;

    // Extract left/right text lengths
    if (ocr.includes('<page-break/>')) {
      const parts = ocr.split('<page-break/>');
      pageCheck.leftLen = parts[0]?.length || 0;
      pageCheck.rightLen = parts[1]?.length || 0;
    }

    pageCheck.status = 'OK';
    pageCheck.ocrLen = ocr.length;
    bookResult.pages.push(pageCheck);
  }

  // Check 2: OCR coverage
  bookResult.checks.push({
    name: 'OCR coverage',
    status: hasOcr === pages.length ? 'PASS' : (hasOcr > 0 ? 'PARTIAL' : 'FAIL'),
    detail: `${hasOcr}/${pages.length} pages have OCR` + (missingOcr.length > 0 ? ` (missing: p.${missingOcr.join(', p.')})` : ''),
  });

  // Check 3: Split positions
  bookResult.checks.push({
    name: 'Split positions',
    status: hasSplitPos > 0 ? 'PASS' : 'FAIL',
    detail: `${hasSplitPos}/${hasOcr} pages have <split-position>`,
  });

  // Check 4: Page breaks (spread detection)
  bookResult.checks.push({
    name: 'Page breaks',
    status: hasPageBreak > 0 ? 'PASS' : 'FAIL',
    detail: `${hasPageBreak}/${hasOcr} pages have <page-break/> (detected as spreads)`,
  });

  // Check 5: Metadata tags
  bookResult.checks.push({
    name: 'Language tags',
    status: hasLanguage >= hasOcr * 0.9 ? 'PASS' : 'PARTIAL',
    detail: `${hasLanguage}/${hasOcr} pages`,
  });
  bookResult.checks.push({
    name: 'Page type tags',
    status: hasPageType >= hasOcr * 0.9 ? 'PASS' : 'PARTIAL',
    detail: `${hasPageType}/${hasOcr} pages`,
  });
  bookResult.checks.push({
    name: 'Vocab tags',
    status: hasVocab >= hasOcr * 0.5 ? 'PASS' : 'PARTIAL',
    detail: `${hasVocab}/${hasOcr} pages`,
  });

  // Check 6: Split position reasonableness
  if (splitPositions.length > 0) {
    const avg = splitPositions.reduce((a, b) => a + b, 0) / splitPositions.length;
    const outliers = splitPositions.filter(p => p < 350 || p > 650);
    bookResult.checks.push({
      name: 'Split position range',
      status: outliers.length === 0 ? 'PASS' : 'WARN',
      detail: `avg=${avg.toFixed(0)}, ${outliers.length} outliers outside 350-650`,
    });
  }

  results.push(bookResult);
}

// Print summary
console.log('\n=== VERIFICATION SUMMARY ===\n');
for (const r of results) {
  console.log(`${r.title?.slice(0, 50)} (${r.totalPages}pp)`);
  for (const c of r.checks) {
    const icon = c.status === 'PASS' ? 'OK' : c.status === 'WAITING' ? '...' : c.status === 'PARTIAL' ? '~' : 'XX';
    console.log(`  [${icon}] ${c.name}: ${c.detail}`);
  }
  console.log();
}

// Generate HTML report
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Spread OCR Batch Verification</title>
<style>
  body { background:#0a0a0a; color:#ccc; font-family:system-ui; padding:16px; }
  h1 { color:#fff; text-align:center; margin-bottom:16px; }
  .book { background:#141414; border:1px solid #222; border-radius:6px; padding:12px; margin-bottom:16px; }
  .book h2 { font-size:0.95rem; color:#ddd; margin-bottom:8px; }
  .checks { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .check { padding:3px 8px; border-radius:3px; font-size:0.7rem; }
  .check.PASS { background:#1a2a1a; color:#6a6; }
  .check.FAIL { background:#2a1a1a; color:#a66; }
  .check.PARTIAL { background:#2a2a00; color:#aa6; }
  .check.WAITING { background:#1a1a2a; color:#66a; }
  .check.WARN { background:#2a1a00; color:#c96; }
  .pages { font-size:0.65rem; color:#888; max-height:200px; overflow-y:auto; }
  .page { display:inline-block; padding:2px 4px; margin:1px; border-radius:2px; }
  .page.OK { background:#1a2a1a; color:#6a6; }
  .page.NO_OCR { background:#2a1a1a; color:#a66; }
</style></head><body>
<h1>Spread OCR Batch Verification</h1>`;

for (const r of results) {
  html += `<div class="book"><h2>${esc(r.title)} — ${r.totalPages} pages</h2>
  <div class="checks">${r.checks.map(c => `<span class="check ${c.status}">${c.name}: ${esc(c.detail)}</span>`).join('')}</div>
  <div class="pages">${r.pages.map(p => `<span class="page ${p.status}">p.${p.page_number}${p.splitPosition ? ' split:' + p.splitPosition : ''}${p.hasPageBreak ? ' PB' : ''}${p.ocrLen ? ' ' + p.ocrLen + 'ch' : ''}</span>`).join(' ')}</div>
  </div>`;
}

html += `</body></html>`;
writeFileSync('/tmp/spread-ocr-verify.html', html);
console.log('Report: /tmp/spread-ocr-verify.html');

await client.close();
