#!/usr/bin/env node
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const na = await db.collection('books').find({ 'pipeline_auto.status': 'needs_attention' })
  .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.error': 1, 'pipeline_auto.retry_count': 1, language: 1 })
  .toArray();

console.log('Total needs_attention:', na.length);

const empty = na.filter(b => !b.pages_count || b.pages_count === 0);
const noOcr = na.filter(b => b.pages_count > 0 && (!b.pages_ocr || b.pages_ocr === 0));
const hasOcr = na.filter(b => b.pages_ocr > 0);
const withError = na.filter(b => b.pipeline_auto?.error);

console.log('\nCategories:');
console.log('  Empty (0 pages):', empty.length);
console.log('  Has pages but 0 OCR:', noOcr.length);
console.log('  Has some OCR:', hasOcr.length);
console.log('  Has error message:', withError.length);

const errorCounts = {};
withError.forEach(b => {
  const err = (b.pipeline_auto.error || 'unknown').substring(0, 100);
  errorCounts[err] = (errorCounts[err] || 0) + 1;
});
console.log('\nError Breakdown (top 15):');
Object.entries(errorCounts).sort((a,b) => b[1] - a[1]).slice(0,15).forEach(([err, count]) => {
  console.log(`  ${count}x: ${err}`);
});

const retryCounts = {};
na.forEach(b => {
  const rc = b.pipeline_auto?.retry_count || 0;
  retryCounts[rc] = (retryCounts[rc] || 0) + 1;
});
console.log('\nRetry Counts:');
Object.entries(retryCounts).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([rc, count]) => {
  console.log(`  retries=${rc}: ${count}`);
});

const langCounts = {};
na.forEach(b => { const l = b.language || 'Unknown'; langCounts[l] = (langCounts[l] || 0) + 1; });
console.log('\nLanguages (top 15):');
Object.entries(langCounts).sort((a,b) => b[1] - a[1]).slice(0,15).forEach(([l, c]) => console.log(`  ${l}: ${c}`));

console.log('\nSample: Has OCR but stuck (10):');
hasOcr.slice(0,10).forEach(b => {
  console.log(`  ${(b.title||'').substring(0,45)} | OCR:${b.pages_ocr}/${b.pages_count} | tr:${b.pages_translated||0} | err:${(b.pipeline_auto?.error||'none').substring(0,50)}`);
});

console.log('\nSample: 0 OCR (10):');
noOcr.slice(0,10).forEach(b => {
  console.log(`  ${(b.title||'').substring(0,45)} | pg:${b.pages_count} | ${b.language||'?'} | err:${(b.pipeline_auto?.error||'none').substring(0,50)}`);
});

// Check: how many no-error needs_attention?
const noError = na.filter(b => !b.pipeline_auto?.error);
console.log('\nNo error message:', noError.length);
if (noError.length > 0) {
  console.log('Sample no-error:');
  noError.slice(0,5).forEach(b => {
    console.log(`  ${(b.title||'').substring(0,45)} | pg:${b.pages_count} | OCR:${b.pages_ocr||0} | ${b.language||'?'}`);
  });
}

await client.close();
