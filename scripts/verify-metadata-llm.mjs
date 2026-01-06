#!/usr/bin/env node
/**
 * LLM-based metadata verification using Claude Haiku
 *
 * Uses Haiku to match books against catalog entries intelligently,
 * handling Latin declensions, name variations, etc.
 *
 * Usage:
 *   node scripts/verify-metadata-llm.mjs --dry-run
 *   node scripts/verify-metadata-llm.mjs --apply
 *   node scripts/verify-metadata-llm.mjs --book "Agrippa"
 */

import Anthropic from '@anthropic-ai/sdk';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// Load env
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
      }
    }
  } catch (e) {
    console.log('No .env.local found');
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

// Get candidate matches from catalog - prioritize author matches
async function getCandidates(db, book, limit = 30) {
  // Extract author surname (most reliable identifier)
  const authorWords = (book.author || '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);

  let docs = [];

  // First: search by author surname in author field
  if (authorWords.length > 0) {
    const surname = authorWords[authorWords.length - 1];
    docs = await db.collection('external_catalog')
      .find({ author: { $regex: surname, $options: 'i' } })
      .limit(limit)
      .toArray();
  }

  // Fallback: search by title words
  if (docs.length === 0) {
    const titleWords = (book.title || '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4)
      .slice(0, 3);

    if (titleWords.length >= 2) {
      docs = await db.collection('external_catalog')
        .find({
          $and: titleWords.map(w => ({
            title: { $regex: w, $options: 'i' }
          }))
        })
        .limit(limit)
        .toArray();
    }
  }

  return docs.map(d => ({
    id: d.identifier,
    source: d.source === 'bph' ? 'EFM' : 'IA',
    title: d.title,
    author: d.author,
    year: d.year,
    language: d.language,
    place: d.placeOfPublication
  }));
}

// Use Haiku to find best match
async function findBestMatch(book, candidates) {
  if (candidates.length === 0) return null;

  const prompt = `You are matching a book from a digital library to catalog entries.

BOOK TO MATCH:
Title: ${book.title}
Author: ${book.author}
Current year: ${book.published || 'Unknown'}
Current language: ${book.language || 'Unknown'}

CATALOG CANDIDATES:
${candidates.map((c, i) => `${i + 1}. [${c.source}] "${c.title}" by ${c.author || 'Unknown'} (${c.year || 'n.d.'}) - ${c.language || 'Unknown language'}`).join('\n')}

Which catalog entry best matches this book? Consider:
- Latin name variations (Agrippa/Agrippae, Cornelius/Cornelii)
- Title variations (abbreviated vs full titles)
- Same work, different editions

Respond with JSON only:
{
  "match_index": <1-${candidates.length} or null if no good match>,
  "confidence": <"high", "medium", or "low">,
  "reason": "<brief explanation>"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.match_index) return null;

    const matched = candidates[result.match_index - 1];
    return {
      ...matched,
      confidence: result.confidence,
      reason: result.reason
    };
  } catch (e) {
    console.error('LLM error:', e.message);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 50;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY CHANGES'}`);
  console.log(`Using Claude Haiku for matching\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find books needing verification
  const filter = {
    $or: [
      { published: 'Unknown' },
      { published: { $exists: false } },
      { language: 'Unknown' },
    ]
  };

  if (specificBook) {
    filter.title = { $regex: specificBook, $options: 'i' };
  }

  const books = await db.collection('books')
    .find(filter)
    .sort({ title: 1 })
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books to verify\n`);

  const results = { high: [], medium: [], low: [], none: [] };
  let processed = 0;

  for (const book of books) {
    processed++;
    process.stdout.write(`\r[${processed}/${books.length}] ${book.title.substring(0, 50)}...`);

    const candidates = await getCandidates(db, book);
    if (candidates.length === 0) {
      results.none.push({ title: book.title, author: book.author });
      continue;
    }

    const match = await findBestMatch(book, candidates);
    if (!match) {
      results.none.push({ title: book.title, author: book.author });
      continue;
    }

    const entry = {
      id: book.id,
      title: book.title,
      author: book.author,
      currentYear: book.published,
      currentLang: book.language,
      match: {
        source: match.source,
        title: match.title,
        year: match.year,
        language: match.language,
        reason: match.reason
      }
    };

    results[match.confidence].push(entry);

    // Apply high-confidence matches
    if (!dryRun && match.confidence === 'high') {
      const updates = { updated_at: new Date() };
      if (match.year && match.year !== 'Unknown' && book.published === 'Unknown') {
        updates.published = match.year;
      }
      if (match.language && match.language !== 'Unknown' && book.language === 'Unknown') {
        updates.language = match.language;
      }
      if (Object.keys(updates).length > 1) {
        await db.collection('books').updateOne({ id: book.id }, { $set: updates });
      }
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`High confidence: ${results.high.length}`);
  console.log(`Medium confidence: ${results.medium.length}`);
  console.log(`Low confidence: ${results.low.length}`);
  console.log(`No match: ${results.none.length}`);

  if (results.high.length > 0) {
    console.log('\n--- HIGH CONFIDENCE MATCHES ---');
    for (const r of results.high.slice(0, 20)) {
      console.log(`✅ ${r.title}`);
      console.log(`   → ${r.match.year} | ${r.match.language} [${r.match.source}]`);
      console.log(`   ${r.match.reason}`);
    }
  }

  if (results.medium.length > 0) {
    console.log('\n--- MEDIUM CONFIDENCE (review recommended) ---');
    for (const r of results.medium.slice(0, 10)) {
      console.log(`⚠️  ${r.title}`);
      console.log(`   → ${r.match.year} | ${r.match.language} [${r.match.source}]`);
      console.log(`   ${r.match.reason}`);
    }
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
