#!/usr/bin/env node
/**
 * Extract gallery image data for the image constellation visualization.
 * Outputs /tmp/image-vectors.json for the Python embedding pipeline.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/extract-image-vectors.mjs
 */

import { MongoClient } from 'mongodb';

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

// Get all gallery images with quality >= 0.7
const images = await db.collection('gallery_images')
  .find(
    { gallery_quality: { $gte: 0.7 } },
    {
      projection: {
        id: 1, type: 1, gallery_quality: 1,
        thumbnail_url: 1, extracted_url: 1,
        book_title: 1, book_author: 1, book_year: 1, book_id: 1,
        description: 1,
        'metadata.subjects': 1, 'metadata.figures': 1, 'metadata.symbols': 1,
      }
    }
  )
  .toArray();

console.log(`Fetched ${images.length} gallery images`);

// Build book slug map
const bookIds = [...new Set(images.map(i => i.book_id))];
const books = await db.collection('books')
  .find({ id: { $in: bookIds } }, { projection: { id: 1, slug: 1 } })
  .toArray();
const slugMap = new Map(books.map(b => [b.id, b.slug]));

// Build output
const output = images.map(img => {
  const subjects = img.metadata?.subjects || [];
  const figures = img.metadata?.figures || [];
  const symbols = img.metadata?.symbols || [];
  const description = img.description || '';

  // Build text for embedding (same approach as original)
  const parts = [];
  if (img.type) parts.push(img.type);
  if (subjects.length) parts.push(subjects.join(', '));
  if (figures.length) parts.push(figures.join(', '));
  if (symbols.length) parts.push(symbols.join(', '));
  if (description) parts.push(description.slice(0, 200));
  if (img.book_title) parts.push(img.book_title);

  return {
    id: img.id,
    type: img.type || 'unknown',
    quality: img.gallery_quality || 0,
    thumbnail: img.extracted_url || img.thumbnail_url || '',
    book_title: img.book_title || '',
    book_author: img.book_author || '',
    book_year: img.book_year || null,
    book_id: img.book_id || '',
    book_slug: slugMap.get(img.book_id) || img.book_id || '',
    subjects,
    figures,
    symbols,
    description: description.slice(0, 200),
    text_for_embedding: parts.join(' | ') || 'image',
  };
});

await client.close();

const fs = await import('fs');
fs.writeFileSync('/tmp/image-vectors.json', JSON.stringify(output));
const sizeMB = (fs.statSync('/tmp/image-vectors.json').size / 1024 / 1024).toFixed(1);
console.log(`Written /tmp/image-vectors.json (${output.length} images, ${sizeMB} MB)`);
