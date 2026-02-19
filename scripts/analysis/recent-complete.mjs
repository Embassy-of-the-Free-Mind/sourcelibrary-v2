#!/usr/bin/env node
/**
 * Show recently completed books and what "complete" means for each.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (90s)'); client.close(); process.exit(1); }, 90000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // What does "complete" mean in the pipeline?
  // From pipeline.md: OCR + Translation + Summary/Index + Chapters + Image Extraction

  // Get the 20 most recently completed books
  const completedBooks = await db.collection('books').find({
    'pipeline_auto.status': 'complete'
  }).sort({ 'pipeline_auto.completed_at': -1 }).limit(20).project({
    id: 1, title: 1, author: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    'pipeline_auto.completed_at': 1, 'pipeline_auto.queued_at': 1,
    'reading_summary.generated_at': 1,
    'index.generatedAt': 1,
    chapters: 1,
  }).toArray();

  console.log('=== "Complete" means all pipeline stages done ===');
  console.log('OCR → Metadata Enrich → Translation → Summary+Index → Chapters → Image Extraction\n');

  console.log('=== 20 Most Recently Completed Books ===\n');

  for (const book of completedBooks) {
    const completedAt = book.pipeline_auto?.completed_at;
    const queuedAt = book.pipeline_auto?.queued_at;
    const duration = completedAt && queuedAt ?
      Math.round((new Date(completedAt) - new Date(queuedAt)) / (1000 * 60 * 60)) : '?';

    const hasChapters = book.chapters && book.chapters.length > 0;
    const hasSummary = !!book.reading_summary?.generated_at;
    const hasIndex = !!book.index?.generatedAt;

    console.log(`${book.title?.substring(0, 65)}`);
    console.log(`  Author: ${book.author || '?'} | Lang: ${book.language || '?'} | Pages: ${book.pages_count || '?'}`);
    console.log(`  OCR: ${book.pages_ocr || 0}/${book.pages_count || '?'} | Trans: ${book.pages_translated || 0}/${book.pages_count || '?'}`);
    console.log(`  Summary: ${hasSummary ? 'yes' : 'NO'} | Index: ${hasIndex ? 'yes' : 'NO'} | Chapters: ${hasChapters ? book.chapters.length : 'NO'}`);
    console.log(`  Completed: ${completedAt ? new Date(completedAt).toISOString().replace('T', ' ').substring(0, 19) : '?'} (${duration}h in pipeline)`);
    console.log(`  https://sourcelibrary.org/book/${book.id}`);
    console.log('');
  }

} finally {
  clearTimeout(timeout);
  await client.close();
}
