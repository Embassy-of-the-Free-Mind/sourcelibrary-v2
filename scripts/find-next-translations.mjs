#!/usr/bin/env node
/**
 * Find the next batch of books ready for translation.
 * Usage: set -a; source .env.local; set +a; node scripts/find-next-translations.mjs
 */
import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find all books with active translation jobs from this session
  const activeJobs = await db.collection('jobs').find({
    initiated_by: 'script:queue-translations',
    created_at: { $gte: new Date(Date.now() - 86400000) }
  }).toArray();
  const alreadyQueued = new Set(activeJobs.map(j => j.book_id));

  console.log(`Already queued: ${alreadyQueued.size} books\n`);

  // Find candidates: OCR complete or metadata enriched, Western languages
  const candidates = await db.collection('books').find({
    'pipeline_auto.status': { $in: ['ocr_complete', 'metadata_enriched'] },
    pages_ocr: { $gt: 0 },
    language: { $nin: ['Sanskrit', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Chinese'] }
  }, {
    projection: { id: 1, title: 1, author: 1, language: 1, pages_ocr: 1, pages_translated: 1, read_count: 1 }
  }).sort({ read_count: -1, pages_ocr: -1 }).toArray();

  const next = candidates.filter(b => {
    if (alreadyQueued.has(b.id)) return false;
    const untranslated = (b.pages_ocr || 0) - (b.pages_translated || 0);
    return untranslated > 0;
  });

  // Group by language
  const byLang = {};
  let totalPages = 0;
  for (const b of next) {
    const lang = b.language || 'Unknown';
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(b);
    totalPages += (b.pages_ocr || 0) - (b.pages_translated || 0);
  }

  console.log(`=== Remaining Candidates (${next.length} books, ${totalPages} pages) ===\n`);

  for (const [lang, books] of Object.entries(byLang).sort((a, b) => b[1].length - a[1].length)) {
    const langPages = books.reduce((s, b) => s + (b.pages_ocr || 0) - (b.pages_translated || 0), 0);
    console.log(`--- ${lang} (${books.length} books, ${langPages} pages) ---`);
    books.slice(0, 8).forEach(b => {
      const untranslated = (b.pages_ocr || 0) - (b.pages_translated || 0);
      console.log(`  [${b.read_count || 0}r] ${untranslated}p | ${(b.title || '').substring(0, 55)} | ${b.id}`);
    });
    if (books.length > 8) console.log(`  ... and ${books.length - 8} more`);
    console.log('');
  }

  // Print as BOOKS array for easy copy into queue script
  console.log('\n=== Copy-paste for queue-translations.mjs ===\n');
  const topN = next.slice(0, 50);
  for (const b of topN) {
    const untranslated = (b.pages_ocr || 0) - (b.pages_translated || 0);
    console.log(`  { id: '${b.id}', note: '${(b.title || '').substring(0, 45).replace(/'/g, "\\'")} — ${untranslated}p ${b.language || "?"}' },`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
