#!/usr/bin/env node

/**
 * Merge entities that share the same (name, wikidata_id) pair.
 *
 * These are exact duplicates created by running wikidata-align multiple times.
 * Different from name-variant dedup (Saint/St.) — these have identical names.
 *
 * Strategy: pick the richer entity as winner, merge books[] from losers,
 * copy missing fields, delete losers.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/merge-qid-duplicates.mjs
 *
 * Options:
 *   --dry-run    Show what would be done without writing
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const entities = db.collection('entities');

  const groups = await entities.aggregate([
    { $match: { wikidata_id: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: { name: '$name', wikidata_id: '$wikidata_id' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  console.log(`Found ${groups.length} duplicate groups (same name + QID)`);
  if (DRY_RUN) console.log('(dry run)\n');

  let merged = 0, deleted = 0, booksAdded = 0;

  for (const group of groups) {
    const docs = await entities.find({ _id: { $in: group.ids } }).toArray();

    // Score: more books > more mentions > has dates > has description > has coordinates
    const scored = docs.map((d) => {
      const booksLen = d.books?.length || 0;
      const mentions = d.total_mentions || 0;
      const hasDates = (d.wikidata_birth_date || d.wikidata_death_date) ? 10 : 0;
      const hasDesc = d.description ? 5 : 0;
      const hasCoords = d.wikidata_coordinates ? 3 : 0;
      return { doc: d, score: booksLen * 10000 + mentions * 10 + hasDates + hasDesc + hasCoords };
    });
    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0].doc;
    const losers = scored.slice(1).map((s) => s.doc);

    // Merge books from losers
    const winnerBookIds = new Set((winner.books || []).map((b) => b.book_id));
    const newBooks = [];
    for (const loser of losers) {
      for (const book of loser.books || []) {
        if (!winnerBookIds.has(book.book_id)) {
          newBooks.push(book);
          winnerBookIds.add(book.book_id);
          booksAdded++;
        }
      }
    }

    // Copy missing fields from losers
    const fieldUpdates = {};
    const fieldsToCopy = [
      'description', 'wikidata_birth_date', 'wikidata_death_date',
      'wikipedia_url', 'wikidata_coordinates',
    ];
    for (const field of fieldsToCopy) {
      if (!winner[field] && losers.some((l) => l[field])) {
        fieldUpdates[field] = losers.find((l) => l[field])[field];
      }
    }

    // Merge aliases
    const allAliases = new Set(winner.aliases || []);
    for (const loser of losers) {
      for (const alias of loser.aliases || []) allAliases.add(alias);
    }
    allAliases.delete(winner.name);
    if (allAliases.size > (winner.aliases?.length || 0)) {
      fieldUpdates.aliases = [...allAliases];
    }

    const allBooks = [...(winner.books || []), ...newBooks];
    const newBookCount = allBooks.length;
    const newMentions = allBooks.reduce((sum, b) => sum + (b.pages?.length || 0), 0);

    const addedInfo = newBooks.length > 0 ? ` +${newBooks.length} books` : '';
    const fieldInfo = Object.keys(fieldUpdates).length > 0
      ? ` +fields: ${Object.keys(fieldUpdates).join(',')}` : '';

    console.log(`${winner.name} (${group._id.wikidata_id}): merge ${losers.length} dupe(s)${addedInfo}${fieldInfo}`);

    if (!DRY_RUN) {
      await entities.updateOne({ _id: winner._id }, {
        $set: {
          books: allBooks,
          book_count: newBookCount,
          total_mentions: newMentions,
          updated_at: new Date(),
          ...fieldUpdates,
        },
      });

      await entities.deleteMany({ _id: { $in: losers.map((l) => l._id) } });
      deleted += losers.length;
    }
    merged++;
  }

  console.log(`\n=== Done ===`);
  console.log(`Groups merged: ${merged}`);
  console.log(`Duplicates deleted: ${deleted}`);
  console.log(`Books transferred: ${booksAdded}`);

  await client.close();
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
