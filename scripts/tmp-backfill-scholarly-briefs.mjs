#!/usr/bin/env node
/**
 * Backfill scholarly briefs: regenerate book summaries that start with
 * "Step into", "Discover the", "Explore the", "Embark on", etc.
 *
 * Uses the book's existing index data (section summaries, themes, quotes)
 * to regenerate just the brief/abstract/detailed without re-processing pages.
 *
 * Usage:
 *   node scripts/tmp-backfill-scholarly-briefs.mjs [--dry-run] [--limit N]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !GEMINI_API_KEY) {
  console.error('Missing MONGODB_URI or GEMINI_API_KEY');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 0;
})();

const BAD_OPENERS = [
  /^step into/i,
  /^journey into/i,
  /^dive into/i,
  /^explore the/i,
  /^discover the/i,
  /^delve into/i,
  /^embark on/i,
  /^immerse yourself/i,
  /^venture into/i,
  /^uncover the/i,
  /^unlock the/i,
  /^experience the/i,
];

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite',
  generationConfig: { temperature: 0.3, maxOutputTokens: 2000 }
});

async function regenerateSummary(book, indexData) {
  const title = book.display_title || book.title || 'Unknown';
  const author = book.author || 'Unknown';
  const language = book.language || '';

  // Build context from whatever index data is available
  const keywords = indexData.keywords?.map(k => k.term)?.slice(0, 20) || [];
  const themes = indexData.entries
    ?.filter(e => e.type === 'keyword')
    ?.map(e => e.term)
    ?.slice(0, 20) || [];
  const allTopics = [...new Set([...keywords, ...themes])];

  const sections = indexData.sectionSummaries || [];
  const sectionsText = sections.map(s =>
    `Pages ${s.startPage}-${s.endPage} (${s.title}): ${s.summary}`
  ).join('\n');

  const concepts = indexData.concepts?.map(c => c.name)?.slice(0, 15) || [];
  const people = indexData.people?.map(p => p.name)?.slice(0, 10) || [];

  // Use existing detailed/abstract as context (they have good info, just bad tone)
  const existingDetailed = indexData.bookSummary?.detailed || '';
  const existingAbstract = indexData.bookSummary?.abstract || '';

  // Collect quotes from sections
  const quotes = sections.flatMap(s => s.quotes || []).slice(0, 10);
  const quotesText = quotes.map(q => `- "${q.text}" (p.${q.page})`).join('\n');

  const contextParts = [];
  if (allTopics.length) contextParts.push(`Topics: ${allTopics.join(', ')}`);
  if (people.length) contextParts.push(`People: ${people.join(', ')}`);
  if (concepts.length) contextParts.push(`Concepts: ${concepts.join(', ')}`);
  if (sectionsText) contextParts.push(`Section summaries:\n${sectionsText}`);
  if (quotesText) contextParts.push(`Notable quotes:\n${quotesText}`);
  if (existingDetailed) contextParts.push(`Previous detailed description (rewrite in scholarly tone):\n${existingDetailed}`);
  else if (existingAbstract) contextParts.push(`Previous abstract (rewrite in scholarly tone):\n${existingAbstract}`);

  const prompt = `You are a scholarly cataloger. Write a description of "${title}" by ${author}${language ? ` (${language})` : ''}.

${contextParts.join('\n\n')}

Style: Write like a rare books librarian. State what the text is and contains. Do not sell or promote it. Never open with "Step into", "Discover", "Explore", "Unlock", or similar invitations. Never address the reader as "you". Be precise and concrete.

Output JSON only (no markdown fences):
{
  "brief": "2-3 declarative sentences: what the text is, what it argues or contains",
  "abstract": "1 paragraph (4-6 sentences) summarizing contents, structure, and context"
}

Use the actual quotes provided. Be accurate.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate the new brief doesn't have the same problem
  for (const pattern of BAD_OPENERS) {
    if (pattern.test(parsed.brief)) {
      throw new Error(`New brief still starts with bad opener: ${parsed.brief.substring(0, 50)}`);
    }
  }

  return {
    brief: parsed.brief || '',
    abstract: parsed.abstract || '',
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const indexesCol = db.collection('book_indexes');

  // Find books with bad briefs
  const query = {
    $or: BAD_OPENERS.map(r => ({
      'index.bookSummary.brief': { $regex: r.source, $options: 'i' }
    }))
  };

  // Also check book_indexes collection
  const badFromInline = await booksCol.find(query, {
    projection: { id: 1, display_title: 1, title: 1, author: 1, language: 1 }
  }).toArray();

  const badFromIndexes = await indexesCol.find({
    $or: BAD_OPENERS.map(r => ({
      'bookSummary.brief': { $regex: r.source, $options: 'i' }
    }))
  }, { projection: { book_id: 1 } }).toArray();

  const badBookIds = new Set([
    ...badFromInline.map(b => b.id),
    ...badFromIndexes.map(b => b.book_id)
  ]);

  console.log(`Found ${badBookIds.size} books with bad openers`);
  if (DRY_RUN) {
    console.log('DRY RUN - not modifying anything');
    await client.close();
    return;
  }

  const bookIds = [...badBookIds];
  const total = LIMIT > 0 ? Math.min(LIMIT, bookIds.length) : bookIds.length;
  let success = 0;
  let errors = 0;

  for (let i = 0; i < total; i++) {
    const bookId = bookIds[i];

    try {
      // Get book metadata
      const book = await booksCol.findOne(
        { id: bookId },
        { projection: { id: 1, display_title: 1, title: 1, author: 1, language: 1 } }
      );
      if (!book) { errors++; continue; }

      // Get index data (prefer dedicated collection)
      let indexData = await indexesCol.findOne({ book_id: bookId });
      if (!indexData) {
        const bookWithIndex = await booksCol.findOne(
          { id: bookId },
          { projection: { index: 1 } }
        );
        indexData = bookWithIndex?.index;
      }
      if (!indexData || (!indexData.sectionSummaries?.length && !indexData.bookSummary && !indexData.keywords?.length)) {
        console.log(`  [${i+1}/${total}] SKIP ${bookId} - no index data`);
        continue;
      }

      const result = await regenerateSummary(book, indexData);

      // Update book_indexes collection
      await indexesCol.updateOne(
        { book_id: bookId },
        { $set: {
          'bookSummary.brief': result.brief,
          'bookSummary.abstract': result.abstract,
        }}
      );

      // Update inline book.index if it exists
      await booksCol.updateOne(
        { id: bookId, 'index.bookSummary': { $exists: true } },
        { $set: {
          'index.bookSummary.brief': result.brief,
          'index.bookSummary.abstract': result.abstract,
        }}
      );

      // Update the book.summary.data field (displayed on book page)
      await booksCol.updateOne(
        { id: bookId },
        { $set: {
          'summary.data': result.brief,
          'reading_summary.overview': result.abstract || result.brief,
        }}
      );

      success++;
      const preview = result.brief.substring(0, 80);
      console.log(`  [${i+1}/${total}] OK ${bookId}: ${preview}...`);

      // Rate limit: ~30 RPM for flash-lite
      if (i % 25 === 24) {
        console.log('  (rate limit pause)');
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      errors++;
      console.error(`  [${i+1}/${total}] ERR ${bookId}: ${err.message}`);
      // Brief pause on error
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone: ${success} updated, ${errors} errors out of ${total} attempted`);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
