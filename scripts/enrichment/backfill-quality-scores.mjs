#!/usr/bin/env node
/**
 * Backfill quality scores for books that have summaries/indexes but no quality_score.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-quality-scores.mjs
 *
 * Options:
 *   --limit=50       Max books to process (default: all)
 *   --dry-run        Count candidates without scoring
 *   --book-id=ID     Score a single specific book
 *   --force          Re-score books that already have a quality_score
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3-flash-preview';
const DELAY_MS = 500;

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// Parse CLI args
const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  const [key, val] = arg.replace(/^--/, '').split('=');
  flags[key] = val ?? true;
}
const limit = flags.limit ? parseInt(flags.limit) : 0;
const dryRun = flags['dry-run'] === true;
const bookId = flags['book-id'];
const force = flags.force === true;

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Build query
  const query = {};
  if (bookId) {
    query.id = bookId;
  } else {
    // Need at least one of: summary, index, description
    query.$or = [
      { 'reading_summary.overview': { $exists: true, $ne: '' } },
      { 'index.generatedAt': { $exists: true } },
      { description: { $exists: true, $ne: '' } },
    ];
    if (!force) {
      query.quality_score = { $exists: false };
    }
    query.hidden = { $ne: true };
  }

  const cursor = db.collection('books')
    .find(query)
    .sort({ read_count: -1 })
    .project({
      id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1,
      categories: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
      reading_summary: 1, index: 1, description: 1, read_count: 1, doi: 1,
      chapters: 1, quality_score: 1,
    });

  if (limit > 0) cursor.limit(limit);
  const books = await cursor.toArray();

  console.log(`Found ${books.length} books to score${dryRun ? ' (dry run)' : ''}`);
  if (dryRun) {
    for (const b of books.slice(0, 20)) {
      console.log(`  - "${b.display_title || b.title}" (reads: ${b.read_count || 0}, current: ${b.quality_score ?? 'none'})`);
    }
    await client.close();
    return;
  }

  // Dynamically import the scoring module
  // We call the API since this is a standalone script
  const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

  let scored = 0;
  let failed = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const title = book.display_title || book.title;

    try {
      // Count gallery images
      const galleryCount = await db.collection('gallery_images')
        .countDocuments({ book_id: book.id });

      // Build prompt (inline to avoid ESM import issues)
      const summary = book.reading_summary;
      const overview = (summary?.overview || '').substring(0, 500);
      const themes = (summary?.themes || []).join(', ');
      const description = (book.description || '').substring(0, 200);

      const prompt = `You are a rare books curator rating books for Source Library, a digital library of Western esotericism, alchemy, Hermeticism, and related traditions.

Rate this book on four dimensions (0-25 each). Be discriminating — 15 is average. Reserve 20+ for genuinely outstanding books.

Book: "${title}" by ${book.author || 'Unknown'}
Language: ${book.language || 'Unknown'}, Year: ${book.year || 'Unknown'}
Categories: ${(book.categories || []).join(', ') || 'none'}
Pages: ${book.pages_count || 0}
Summary: ${overview || '(none)'}
Themes: ${themes || '(none)'}
Description: ${description || '(none)'}
Illustrations: ${galleryCount} detected
Has DOI: ${book.doi ? 'yes' : 'no'}

Respond with JSON only — no markdown fences, no explanation.

{
  "historical_significance": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "visual_appeal": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "accessibility": { "score": <0-25>, "reasoning": "<1 sentence>" },
  "scholarly_value": { "score": <0-25>, "reasoning": "<1 sentence>" }
}

Guidelines:
- Historical significance: author fame, text's role in intellectual history, rarity
- Visual appeal: LOW (0-5) for pure text. Higher for illustrations, emblems, diagrams, frontispieces
- Accessibility: broad appeal (alchemy, magic, Hermetica) > narrow (obscure theology, legal texts)
- Scholarly value: primary sources > derivative compilations, major authors > anonymous fragments`;

      const model = genai.getGenerativeModel({
        model: MODEL,
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text().trim();
      const usageMeta = response.usageMetadata;

      let aiScores;
      try {
        aiScores = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        aiScores = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      }

      if (!aiScores) {
        console.error(`  [${i + 1}/${books.length}] "${title}" — FAILED: could not parse JSON`);
        failed++;
        continue;
      }

      const aiTotal = (aiScores.historical_significance?.score || 0)
        + (aiScores.visual_appeal?.score || 0)
        + (aiScores.accessibility?.score || 0)
        + (aiScores.scholarly_value?.score || 0);

      // Mechanical adjustments
      let mechanical = 0;
      const pagesCount = book.pages_count || 0;
      const pagesOcr = book.pages_ocr || 0;
      const pagesTranslated = book.pages_translated || 0;
      const mechDetail = {};

      // Completeness
      let completeness = 0;
      if (pagesCount > 0 && pagesOcr / pagesCount >= 0.9) completeness += 2;
      if (pagesCount > 0 && pagesTranslated / pagesCount >= 0.9) completeness += 3;
      if (book.reading_summary) completeness += 1;
      if (book.index?.generatedAt) completeness += 1;
      if (book.chapters) completeness += 1;
      mechDetail.completeness = completeness;
      mechanical += completeness;

      // Incomplete penalty
      if (pagesCount > 0) {
        const pct = pagesTranslated / pagesCount;
        if (pct < 0.1) { mechDetail.incomplete_penalty = -5; mechanical -= 5; }
        else if (pct < 0.5) { mechDetail.incomplete_penalty = -2; mechanical -= 2; }
      }

      // Engagement
      const readCount = book.read_count || 0;
      const eng = Math.min(5, Math.round(Math.log10(readCount + 1) * 2.5 * 10) / 10);
      mechDetail.engagement = eng;
      mechanical += eng;

      // Gallery
      if (galleryCount >= 10) { mechDetail.gallery = 5; mechanical += 5; }
      else if (galleryCount >= 5) { mechDetail.gallery = 3; mechanical += 3; }
      else if (galleryCount >= 1) { mechDetail.gallery = 1; mechanical += 1; }

      // Edition
      if (book.doi) { mechDetail.edition = 2; mechanical += 2; }

      const finalScore = Math.max(0, Math.min(100, Math.round(aiTotal + mechanical)));

      const assessment = {
        ai_scores: aiScores,
        ai_total: aiTotal,
        mechanical_adjustments: mechDetail,
        mechanical_total: mechanical,
        final_score: finalScore,
        model: MODEL,
        scored_at: new Date(),
      };

      // Save
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { quality_score: finalScore, quality_assessment: assessment, updated_at: new Date() } },
      );

      // Log to gemini_usage
      await db.collection('gemini_usage').insertOne({
        id: `gu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date(),
        type: 'other',
        mode: 'realtime',
        model: MODEL,
        book_id: book.id,
        book_title: title,
        input_tokens: usageMeta?.promptTokenCount || 0,
        output_tokens: usageMeta?.candidatesTokenCount || 0,
        cost_usd: 0, // Will be computed from tokens if needed
        status: 'success',
        endpoint: 'quality-scoring-backfill',
      });

      scored++;
      console.log(`  [${i + 1}/${books.length}] "${title}" — ${finalScore}/100 (AI: ${aiTotal}, mech: ${mechanical > 0 ? '+' : ''}${Math.round(mechanical)})`);

      // Rate limit
      if (i < books.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    } catch (err) {
      console.error(`  [${i + 1}/${books.length}] "${title}" — ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${scored} scored, ${failed} failed out of ${books.length} total`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
