#!/usr/bin/env node
/**
 * Lint check: flag gallery_images and books with external image URLs.
 *
 * R2-only policy: every displayed image must be served from images.sourcelibrary.org.
 * This script finds violations.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/lint-external-images.mjs [--fix-count-only]
 *
 * Exit code 1 if violations found (for CI use).
 */
import { MongoClient } from 'mongodb';

const R2_DOMAIN = 'images.sourcelibrary.org';

// Known external museum domains to flag
const MUSEUM_DOMAINS = [
  'artic.edu',
  'images.metmuseum.org',
  'openaccess-api.clevelandart.org',
  'openaccess-cdn.clevelandart.org',
];

// Allowed external patterns (data URIs, placeholders, etc.)
const ALLOWED_PATTERNS = [
  'data:image/',
  'blob:',
];

function isExternal(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (url.includes(R2_DOMAIN)) return false;
  if (ALLOWED_PATTERNS.some(p => url.startsWith(p))) return false;
  return true;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  let violations = 0;

  // Check gallery_images
  console.log('=== gallery_images ===');
  const galleryFields = ['image_url', 'thumbnail_url', 'extracted_url'];
  for (const field of galleryFields) {
    const query = { [field]: { $regex: '^https?://', $not: { $regex: R2_DOMAIN.replace(/\./g, '\\.') } } };
    const count = await db.collection('gallery_images').countDocuments(query);
    if (count > 0) {
      violations += count;
      console.log(`  ✗ ${field}: ${count} external URLs`);
      // Show sample
      const samples = await db.collection('gallery_images').find(query).limit(3).project({ id: 1, [field]: 1 }).toArray();
      for (const s of samples) {
        console.log(`    - ${s.id}: ${s[field]?.substring(0, 80)}`);
      }
    } else {
      console.log(`  ✓ ${field}: all R2`);
    }
  }

  // Check books (artwork thumbnails)
  console.log('\n=== books (artworks) ===');
  const artworkExternalThumb = await db.collection('books').countDocuments({
    resource_type: { $exists: true },
    thumbnail: { $regex: '^https?://', $not: { $regex: R2_DOMAIN.replace(/\./g, '\\.') } },
  });
  if (artworkExternalThumb > 0) {
    violations += artworkExternalThumb;
    console.log(`  ✗ thumbnail: ${artworkExternalThumb} artworks with external URLs`);
  } else {
    console.log(`  ✓ thumbnail: all R2`);
  }

  // Summary
  console.log(`\n${violations === 0 ? '✓ PASS' : '✗ FAIL'}: ${violations} external image violations`);
  await client.close();
  process.exit(violations > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
