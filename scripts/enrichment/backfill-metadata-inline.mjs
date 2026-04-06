#!/usr/bin/env node
/**
 * Backfill metadata enrichment for books that missed Phase 3.5.
 * Runs verifyMetadataInline (catalog lookups, no Gemini) on books
 * that have pages but no ai_metadata.enriched_at.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-metadata-inline.mjs [--limit N] [--dry-run]
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1]) : 500;

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

function metaNormalize(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function metaSimilarity(a, b) {
  const normA = metaNormalize(a);
  const normB = metaNormalize(b);
  if (!normA || !normB) return 0;
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((intersection / union) * 100);
}

function extractYear(text) {
  if (!text) return undefined;
  const match = text.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : undefined;
}

async function verifyMetadataInline(db, book) {
  const matches = [];

  // 1. Search local external_catalog
  const searchTerms = [book.title, book.author]
    .filter(Boolean)
    .join(' ')
    .split(' ')
    .filter(w => w.length >= 3)
    .slice(0, 3);

  if (searchTerms.length > 0) {
    const wordConditions = searchTerms.map(word => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { author: { $regex: word, $options: 'i' } },
      ]
    }));

    const catalogDocs = await db.collection('external_catalog')
      .find({ $and: wordConditions })
      .limit(20)
      .toArray();

    for (const doc of catalogDocs) {
      const titleSim = metaSimilarity(book.title, doc.title);
      const authorSim = metaSimilarity(book.author, doc.author);
      const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));
      if (confidence > 30) {
        matches.push({
          source: doc.source === 'bph' ? 'EFM' : 'IA',
          confidence,
          title: doc.title,
          author: doc.author,
          year: doc.year || extractYear(doc.published),
          language: doc.language,
          publisher: doc.publisher,
          place: doc.place_of_publication,
        });
      }
    }
  }

  // 2. USTC search via Supabase
  if (book.title) {
    try {
      const titleWords = metaNormalize(book.title).split(' ').filter(w => w.length > 3).slice(0, 3);
      if (titleWords.length > 0) {
        const ilike = titleWords.map(w => `english_title.ilike.*${w}*`).join(',');
        const url = `${SUPABASE_URL}/rest/v1/ustc_enrichments?${ilike}&select=ustc_sn,english_title,original_author,year_published&limit=10`;
        const res = await fetch(url, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const docs = await res.json();
          for (const doc of docs) {
            const titleSim = metaSimilarity(book.title, doc.english_title);
            if (titleSim > 40) {
              matches.push({
                source: 'USTC',
                confidence: titleSim,
                title: doc.english_title,
                author: doc.original_author,
                year: doc.year_published?.toString(),
                ustc_sn: doc.ustc_sn,
              });
            }
          }
        }
      }
    } catch { /* timeout ok */ }
  }

  if (matches.length === 0) return { applied: 0, source: 'none', confidence: 0 };

  // Pick best match
  matches.sort((a, b) => b.confidence - a.confidence);
  const best = matches[0];
  if (best.confidence < 50) return { applied: 0, source: 'none', confidence: best.confidence };

  // Apply missing fields
  const updates = {};
  if ((!book.author || book.author === 'Unknown') && best.author) updates.author = best.author;
  if ((!book.year || book.year === 'Unknown') && best.year) updates.year = parseInt(best.year) || undefined;
  if ((!book.language || book.language === 'Unknown') && best.language) updates.language = best.language;
  if (!book.publisher && best.publisher) updates.publisher = best.publisher;
  if (!book.place_of_publication && best.place) updates.place_of_publication = best.place;

  const applied = Object.keys(updates).length;

  if (applied > 0 && !DRY_RUN) {
    updates['ai_metadata.enriched_at'] = new Date();
    updates['ai_metadata.source'] = best.source;
    updates['ai_metadata.confidence'] = best.confidence;
    updates.updated_at = new Date();
    await db.collection('books').updateOne({ id: book.id }, { $set: updates });
  } else if (!DRY_RUN) {
    // Mark as enriched even if no fields needed updating
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { 'ai_metadata.enriched_at': new Date(), 'ai_metadata.source': 'none_needed', updated_at: new Date() } }
    );
  }

  return { applied, source: best.source, confidence: best.confidence };
}

async function main() {
  console.log(`Metadata Backfill — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}, limit=${LIMIT}`);
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find({
      'ai_metadata.enriched_at': { $exists: false },
      pages_count: { $gt: 0 },
      hidden: { $ne: true },
    })
    .sort({ read_count: -1 })
    .project({ id: 1, title: 1, author: 1, year: 1, language: 1, publisher: 1, place_of_publication: 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} books without metadata enrichment`);

  let enriched = 0, fieldsApplied = 0, errors = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    try {
      const result = await verifyMetadataInline(db, book);
      if (result.applied > 0) {
        fieldsApplied += result.applied;
        console.log(`  [${i + 1}/${books.length}] ${book.title?.substring(0, 50)} — ${result.applied} fields from ${result.source} (${result.confidence}%)`);
      }
      enriched++;
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`  ERROR: ${book.title?.substring(0, 40)} — ${err.message}`);
    }

    if (i > 0 && i % 100 === 0) console.log(`  Progress: ${i}/${books.length}`);
  }

  console.log(`\nDone: ${enriched} books enriched, ${fieldsApplied} fields updated, ${errors} errors`);
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
