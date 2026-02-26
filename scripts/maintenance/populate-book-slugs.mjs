/**
 * Populate slug field for all books that don't have one.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/populate-book-slugs.mjs
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/populate-book-slugs.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Slug generation (mirrors src/lib/slugify.ts)
 */
function slugifyText(text, maxLength) {
  let slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > maxLength * 0.5) {
      slug = slug.substring(0, lastHyphen);
    }
  }

  return slug;
}

function extractLastName(author) {
  if (!author || author === 'Unknown' || author === 'Anonymous') {
    return (author || 'unknown').toLowerCase();
  }
  if (author.includes(',')) {
    return author.split(',')[0].trim();
  }
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function generateBookSlug(title, author, displayTitle) {
  const titleSource = displayTitle || title;
  const slugTitle = slugifyText(titleSource, 60);
  const authorLast = extractLastName(author);
  const slugAuthor = slugifyText(authorLast, 20);

  if (!slugAuthor || slugAuthor === 'unknown') {
    return slugTitle || 'untitled';
  }

  return `${slugTitle}-${slugAuthor}`;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books')
    .find({ slug: { $exists: false } }, { projection: { id: 1, title: 1, display_title: 1, author: 1 } })
    .toArray();

  console.log(`Found ${books.length} books without slugs${DRY_RUN ? ' (dry run)' : ''}`);

  // Track used slugs to detect duplicates within this batch
  // Also load existing slugs from DB
  const existingSlugs = new Set();
  const existingDocs = await db.collection('books')
    .find({ slug: { $exists: true } }, { projection: { slug: 1 } })
    .toArray();
  for (const doc of existingDocs) {
    existingSlugs.add(doc.slug);
  }

  let updated = 0;
  let duplicates = 0;
  const bulkOps = [];

  for (const book of books) {
    let slug = generateBookSlug(book.title, book.author, book.display_title);

    // Handle duplicates
    if (existingSlugs.has(slug)) {
      let suffix = 2;
      while (existingSlugs.has(`${slug}-${suffix}`)) {
        suffix++;
      }
      const original = slug;
      slug = `${slug}-${suffix}`;
      duplicates++;
      console.log(`  Duplicate: "${original}" → "${slug}" (${book.display_title || book.title})`);
    }

    existingSlugs.add(slug);

    if (!DRY_RUN) {
      bulkOps.push({
        updateOne: {
          filter: { id: book.id },
          update: { $set: { slug } },
        },
      });
    }

    updated++;
  }

  if (!DRY_RUN && bulkOps.length > 0) {
    // Execute in batches of 500
    for (let i = 0; i < bulkOps.length; i += 500) {
      const batch = bulkOps.slice(i, i + 500);
      const result = await db.collection('books').bulkWrite(batch);
      console.log(`  Batch ${Math.floor(i / 500) + 1}: ${result.modifiedCount} updated`);
    }
  }

  console.log(`\nDone. ${updated} slugs generated, ${duplicates} duplicates resolved.`);

  // Create unique index
  if (!DRY_RUN) {
    try {
      await db.collection('books').createIndex(
        { slug: 1 },
        { name: 'books_slug_idx', unique: true, sparse: true, background: true }
      );
      console.log('Created unique index on books.slug');
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('Index books_slug_idx already exists');
      } else {
        console.error('Failed to create index:', e.message);
      }
    }
  }

  await client.close();
}

main().catch(console.error);
