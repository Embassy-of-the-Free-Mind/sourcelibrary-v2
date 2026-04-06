#!/usr/bin/env node
/**
 * Audit all sub-collection assignments using Gemini with a careful prompt.
 * For each sub-collection, asks Gemini whether each book truly belongs.
 * Removes books that are cross-references rather than primary members.
 *
 * Usage:
 *   node scripts/audit-subcollections.mjs [--dry-run] [--parent medicine] [--sub early-modern-medicine-sub]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const parentFilter = args.find(a => a.startsWith('--parent='))?.split('=')[1]
  || (args.includes('--parent') ? args[args.indexOf('--parent') + 1] : null);
const subFilter = args.find(a => a.startsWith('--sub='))?.split('=')[1]
  || (args.includes('--sub') ? args[args.indexOf('--sub') + 1] : null);

async function auditSubcollection(ai, db, sub) {
  const books = await db.collection('books').find(
    { collections: sub.slug, status: { $ne: 'deleted' }, hidden: { $ne: true } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1 } },
  ).toArray();

  if (books.length === 0) return { kept: 0, removed: 0 };

  const toRemove = [];
  const BATCH = 15; // Smaller batches for more careful evaluation

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const bookList = batch.map((b, idx) =>
      `${idx + 1}. "${b.display_title || b.title}" by ${b.author || 'Unknown'} (${b.year || '?'}, ${b.language || '?'}) [categories: ${(b.categories || []).join(', ') || 'none'}]`
    ).join('\n');

    const prompt = `You are auditing the "${sub.name}" sub-collection within the "${sub.parent}" collection of a digital library of pre-modern texts.

"${sub.name}" is described as: ${sub.subtitle || sub.name}

Your task: For each book below, determine whether ${sub.name} is a PRIMARY subject of this book — not merely a tangential connection.

IMPORTANT GUIDELINES:
- Use your knowledge of these authors and works. You likely know what Kircher's Musurgia is about, what Fludd's Utriusque Cosmi is about, etc. Use that knowledge.
- A book BELONGS if: the topic of "${sub.name}" is a central, primary subject. The book would naturally be shelved in this section of a physical library.
- A book DOES NOT BELONG if: the connection is incidental, the book is primarily about something else, or the book merely touches on this topic in passing. Many books in pre-modern scholarship cross domains — an alchemy book might mention medicine, a theology book might discuss natural philosophy. That doesn't make them medical or scientific texts.
- When in doubt, remove. It's better to have a focused sub-collection of genuinely relevant books than a padded one full of tangential connections.
- Be strict. Probably 20-40% of books in any sub-collection are cross-references that don't truly belong.

For each book, respond with ONE line in this format:
NUMBER: KEEP or REMOVE (brief reason)

Books:
${bookList}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: prompt,
      });
      const text = response.text || '';
      const lines = text.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+):\s*(KEEP|REMOVE)\b/i);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          const action = match[2].toUpperCase();
          if (idx >= 0 && idx < batch.length && action === 'REMOVE') {
            toRemove.push(batch[idx].id);
          }
        }
      }
    } catch (err) {
      console.error(`    Gemini error (offset ${i}):`, err.message);
    }

    if (i + BATCH < books.length) await new Promise(r => setTimeout(r, 800));
  }

  return { total: books.length, kept: books.length - toRemove.length, removed: toRemove.length, removeIds: toRemove };
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  // Get all sub-collections to audit
  const query = { parent: { $exists: true }, hidden: { $ne: true } };
  if (parentFilter) query.parent = parentFilter;
  if (subFilter) query.slug = subFilter;

  const subs = await db.collection('collections').find(query).sort({ parent: 1, book_count: -1 }).toArray();
  console.log(`Auditing ${subs.length} sub-collections...\n`);

  let totalRemoved = 0;
  let totalKept = 0;
  let currentParent = '';

  for (const sub of subs) {
    if (sub.parent !== currentParent) {
      currentParent = sub.parent;
      console.log(`\n${'═'.repeat(50)}`);
      console.log(`  ${currentParent.toUpperCase()}`);
      console.log(`${'═'.repeat(50)}`);
    }

    process.stdout.write(`  ${sub.name} (${sub.book_count || '?'})...`);
    const result = await auditSubcollection(ai, db, sub);

    if (result.removed === 0) {
      console.log(` OK (${result.total} kept)`);
      totalKept += result.total;
      continue;
    }

    const pct = Math.round(result.removed / result.total * 100);
    console.log(` ${result.removed}/${result.total} to remove (${pct}%)`);

    if (!DRY_RUN && result.removeIds?.length > 0) {
      const bulkResult = await db.collection('books').updateMany(
        { id: { $in: result.removeIds } },
        { $pull: { collections: sub.slug } },
      );
      console.log(`    Removed from ${bulkResult.modifiedCount} books`);

      // Update book_count
      const newCount = await db.collection('books').countDocuments({
        collections: sub.slug, status: { $ne: 'deleted' }, hidden: { $ne: true },
        pages_translated: { $gt: 0 },
      });
      await db.collection('collections').updateOne({ slug: sub.slug }, { $set: { book_count: newCount } });
      console.log(`    New count: ${newCount}`);
    }

    totalRemoved += result.removed;
    totalKept += result.kept;
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done. Kept: ${totalKept}, Removed: ${totalRemoved} (${Math.round(totalRemoved / (totalKept + totalRemoved) * 100)}%)`);
  if (DRY_RUN) console.log('(dry run — no changes made)');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
