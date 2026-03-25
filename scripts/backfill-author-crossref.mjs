#!/usr/bin/env node
/**
 * Backfill author_cross_ref on all books.
 * For each book: find artworks by the same author (for book pages)
 *                find books by the same author (for artwork pages)
 * Stores the result so the component reads from the doc, zero live queries.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/backfill-author-crossref.mjs
 */

import { MongoClient } from 'mongodb';

const VISUAL_TYPES = ['painting', 'print', 'drawing', 'fresco', 'emblem', 'object', 'map'];
const PROJECTION = {
  slug: 1, title: 1, display_title: 1, published: 1,
  resource_type: 1, thumbnail: 1, thumbnail_blob: 1,
  commons_width: 1, commons_height: 1, pages_translated: 1, language: 1,
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Build author → items maps in one pass
  const allBooks = await books.find(
    { hidden: { $ne: true } },
    { projection: { id: 1, author: 1, resource_type: 1, ...PROJECTION } }
  ).toArray();

  console.log(`Loaded ${allBooks.length} books`);

  // Group by normalized author
  const authorArtworks = new Map(); // author_lower → artwork items
  const authorBooks = new Map();    // author_lower → book items

  for (const b of allBooks) {
    if (!b.author) continue;
    const key = b.author.toLowerCase();
    const isVisual = b.resource_type && VISUAL_TYPES.includes(b.resource_type);

    const item = {
      slug: b.slug,
      title: b.title,
      display_title: b.display_title,
      published: b.published,
      resource_type: b.resource_type,
      thumbnail: b.thumbnail,
      thumbnail_blob: b.thumbnail_blob,
      commons_width: b.commons_width,
      commons_height: b.commons_height,
      pages_translated: b.pages_translated,
      language: b.language,
    };
    // Clean undefined fields
    for (const k of Object.keys(item)) {
      if (item[k] === undefined) delete item[k];
    }

    if (isVisual) {
      if (!authorArtworks.has(key)) authorArtworks.set(key, []);
      authorArtworks.get(key).push({ ...item, _id: b.id });
    } else {
      if (!authorBooks.has(key)) authorBooks.set(key, []);
      authorBooks.get(key).push({ ...item, _id: b.id });
    }
  }

  // Now write author_cross_ref to each book
  const ops = [];
  for (const b of allBooks) {
    if (!b.author) continue;
    const key = b.author.toLowerCase();
    const isVisual = b.resource_type && VISUAL_TYPES.includes(b.resource_type);

    const crossRef = {};

    if (!isVisual) {
      // Book page: show artworks by this author
      const artworks = (authorArtworks.get(key) || [])
        .filter(a => a._id !== b.id)
        .sort((a, z) => (a.published || '').localeCompare(z.published || ''))
        .slice(0, 12)
        .map(({ _id, ...rest }) => rest);
      const totalArtworks = (authorArtworks.get(key) || []).filter(a => a._id !== b.id).length;
      if (artworks.length > 0) {
        crossRef.artworks = artworks;
        crossRef.total_artworks = totalArtworks;
      }
    } else {
      // Artwork page: show books by this author
      const authorBooksList = (authorBooks.get(key) || [])
        .filter(a => a._id !== b.id)
        .sort((a, z) => (a.published || '').localeCompare(z.published || ''))
        .slice(0, 8)
        .map(({ _id, ...rest }) => rest);
      if (authorBooksList.length > 0) {
        crossRef.books = authorBooksList;
      }
    }

    if (Object.keys(crossRef).length > 0) {
      ops.push({
        updateOne: {
          filter: { id: b.id },
          update: { $set: { author_cross_ref: crossRef } },
        },
      });
    } else {
      // Clear stale cross-ref if it exists
      ops.push({
        updateOne: {
          filter: { id: b.id, author_cross_ref: { $exists: true } },
          update: { $unset: { author_cross_ref: '' } },
        },
      });
    }
  }

  // Batch write
  if (ops.length > 0) {
    const batchSize = 500;
    let written = 0;
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      const result = await books.bulkWrite(batch, { ordered: false });
      written += result.modifiedCount;
      process.stdout.write(`\r  ${i + batch.length}/${ops.length} processed, ${written} modified`);
    }
    console.log(`\nDone. ${written} books updated.`);
  } else {
    console.log('No updates needed.');
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
