#!/usr/bin/env node
/**
 * Backfill thin sub-collections from unassigned books in parent collections.
 * Uses the careful Gemini prompt to classify only genuinely relevant books.
 *
 * Usage:
 *   node scripts/backfill-thin-subs.mjs [--dry-run] [--min-books 20]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MIN_BOOKS = parseInt(args.find(a => a.startsWith('--min-books='))?.split('=')[1] || '20');

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  // Get all parent → sub mappings
  const allSubs = await db.collection('collections').find(
    { parent: { $exists: true }, hidden: { $ne: true } },
    { projection: { slug: 1, name: 1, subtitle: 1, parent: 1, book_count: 1 } }
  ).toArray();

  const parentMap = {};
  for (const s of allSubs) {
    if (!parentMap[s.parent]) parentMap[s.parent] = [];
    parentMap[s.parent].push(s);
  }

  // Find thin subs
  const thinSubs = allSubs.filter(s => (s.book_count || 0) < MIN_BOOKS);
  console.log(`Found ${thinSubs.length} sub-collections with < ${MIN_BOOKS} books\n`);

  let totalAdded = 0;

  // Group by parent for efficiency
  const parentGroups = {};
  for (const s of thinSubs) {
    if (!parentGroups[s.parent]) parentGroups[s.parent] = [];
    parentGroups[s.parent].push(s);
  }

  for (const [parentSlug, subs] of Object.entries(parentGroups)) {
    const allSubSlugs = parentMap[parentSlug].map(s => s.slug);
    const allSubDetails = parentMap[parentSlug];

    // Find unassigned books in this parent
    const unassigned = await db.collection('books').find(
      {
        $and: [
          { collections: parentSlug },
          { collections: { $not: { $elemMatch: { $in: allSubSlugs } } } },
        ],
        status: { $ne: 'deleted' },
        hidden: { $ne: true },
      },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1 } },
    ).toArray();

    console.log(`${parentSlug}: ${unassigned.length} unassigned books, ${subs.length} thin subs (${subs.map(s => s.slug + ':' + s.book_count).join(', ')})`);

    if (unassigned.length === 0) continue;

    // Classify unassigned books into ALL subs of this parent (not just thin ones)
    const BATCH = 15;
    const assignments = new Map();

    for (let i = 0; i < unassigned.length; i += BATCH) {
      const batch = unassigned.slice(i, i + BATCH);
      const bookList = batch.map((b, idx) =>
        `${idx + 1}. "${b.display_title || b.title}" by ${b.author || 'Unknown'} (${b.year || '?'}, ${b.language || '?'}) [categories: ${(b.categories || []).join(', ') || 'none'}]`
      ).join('\n');

      const subDescriptions = allSubDetails.map(s =>
        `- "${s.slug}": ${s.name} — ${s.subtitle || s.name}`
      ).join('\n');

      const prompt = `You are classifying unassigned books in the "${parentSlug}" collection into sub-collections.

Available sub-collections:
${subDescriptions}

IMPORTANT: Use your knowledge of these authors and works. A book belongs in a sub-collection ONLY if that topic is its primary subject — not a tangential connection. Most books should be "none" — they are cross-references in the parent collection, not primary members of any sub-collection.

For each book, respond with ONE line: NUMBER: SLUG or "none"

Books:
${bookList}`;

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt,
        });
        const text = response.text || '';
        for (const line of text.trim().split('\n')) {
          const match = line.match(/^(\d+):\s*(\S+)/);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            const slug = match[2].toLowerCase().replace(/"/g, '');
            if (idx >= 0 && idx < batch.length && slug !== 'none' && allSubSlugs.includes(slug)) {
              assignments.set(batch[idx].id, slug);
            }
          }
        }
      } catch (err) {
        console.error(`  Gemini error (offset ${i}):`, err.message);
      }

      if (i + BATCH < unassigned.length) await new Promise(r => setTimeout(r, 800));
    }

    // Show distribution
    const dist = {};
    for (const [, slug] of assignments) dist[slug] = (dist[slug] || 0) + 1;
    const thinSlugs = new Set(subs.map(s => s.slug));
    for (const [slug, count] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
      const marker = thinSlugs.has(slug) ? ' ← thin' : '';
      console.log(`  ${slug}: +${count}${marker}`);
    }
    console.log(`  Still unassigned: ${unassigned.length - assignments.size}`);

    // Apply
    if (!DRY_RUN && assignments.size > 0) {
      const bulkOps = [...assignments.entries()].map(([bookId, subSlug]) => ({
        updateOne: {
          filter: { id: bookId },
          update: { $addToSet: { collections: subSlug } },
        },
      }));
      const result = await db.collection('books').bulkWrite(bulkOps);
      console.log(`  Applied: ${result.modifiedCount} books`);
      totalAdded += result.modifiedCount;

      // Update book_counts
      for (const subDoc of allSubDetails) {
        const count = await db.collection('books').countDocuments({
          collections: subDoc.slug, status: { $ne: 'deleted' }, hidden: { $ne: true },
          pages_translated: { $gt: 0 },
        });
        await db.collection('collections').updateOne(
          { slug: subDoc.slug }, { $set: { book_count: count } },
        );
      }
    }
    console.log();
  }

  console.log(`Done. Total added: ${totalAdded}`);
  if (DRY_RUN) console.log('(dry run)');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
