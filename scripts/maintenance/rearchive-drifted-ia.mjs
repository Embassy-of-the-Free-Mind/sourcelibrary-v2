#!/usr/bin/env node
/**
 * Re-archive drifted IA books by clearing archived_photo and re-running
 * the IIIF-direct archiver on affected books.
 *
 * Uses check-archive-drift logic: for each archived IA book, spot-checks
 * 3 pages by comparing a few pixels of the archived image vs the IIIF source.
 * If they differ, clears archived_photo for ALL pages in that book so the
 * archiver can re-fetch them correctly.
 *
 * Usage:
 *   node scripts/maintenance/rearchive-drifted-ia.mjs --scan           # detect drifted books
 *   node scripts/maintenance/rearchive-drifted-ia.mjs --fix            # clear + re-archive
 *   node scripts/maintenance/rearchive-drifted-ia.mjs --fix --limit=50 # first 50 drifted books
 *
 * Run on Hetzner for bandwidth.
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, '../..', '.env.production.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[match[1]]) process.env[match[1]] = val;
    }
  }
} catch {}

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const SCAN_ONLY = hasFlag('scan');
const FIX = hasFlag('fix');
const LIMIT = parseInt(getArg('limit') || '0', 10);
const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org)';

if (!SCAN_ONLY && !FIX) {
  console.error('Usage: --scan (detect) or --fix (clear + re-archive)');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);

/**
 * Fetch a small region of an image and return a fingerprint (avg color).
 */
async function imageFingerprint(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Resize to 8x8 and get raw pixel data — fast fingerprint
    const { data } = await sharp(buf).resize(8, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return Buffer.from(data).toString('hex');
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Check if an archived page matches its IIIF source.
 */
async function checkPage(page) {
  const archivedUrl = page.archived_photo;
  const iiifUrl = page.photo_original || page.photo;
  if (!archivedUrl || !iiifUrl) return true; // can't check

  // Request small versions for fast comparison
  const iiifSmall = iiifUrl.replace(/\/full\/[^/]+\//, '/full/!64,64/');

  const [archFp, iiifFp] = await Promise.all([
    imageFingerprint(archivedUrl),
    imageFingerprint(iiifSmall),
  ]);

  if (!archFp || !iiifFp) return true; // can't determine, assume OK
  return archFp === iiifFp;
}

async function run() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  // Find IA books that have archived pages
  const iaBooks = await books.find({
    $or: [
      { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
      { 'image_source.provider': 'ia' },
    ],
    deleted: { $ne: true },
  }, {
    projection: { _id: 1, id: 1, title: 1, ia_identifier: 1, pages_count: 1 },
  }).toArray();

  console.log(`Scanning ${iaBooks.length} IA books for archive drift...`);

  const drifted = [];
  let checked = 0;

  for (const book of iaBooks) {
    // Get 3 sample archived pages (beginning, middle, end)
    const bookPages = await pages.find({
      book_id: book.id,
      archived_photo: { $exists: true, $ne: null },
    }, {
      projection: { _id: 1, page_number: 1, archived_photo: 1, photo_original: 1, photo: 1 },
    }).sort({ page_number: 1 }).toArray();

    if (bookPages.length < 2) continue;

    // Sample 3 pages
    const sampleIdxs = [
      0,
      Math.floor(bookPages.length / 2),
      bookPages.length - 1,
    ];
    const samples = [...new Set(sampleIdxs)].map(i => bookPages[i]);

    let hasDrift = false;
    for (const sample of samples) {
      const matches = await checkPage(sample);
      if (!matches) {
        hasDrift = true;
        break;
      }
    }

    checked++;
    if (hasDrift) {
      drifted.push(book);
      console.log(`  DRIFT: ${book.title?.slice(0, 50)} (${bookPages.length} archived pages)`);
    }

    if (checked % 50 === 0) {
      console.log(`  ... checked ${checked}/${iaBooks.length}, found ${drifted.length} drifted`);
    }

    if (LIMIT && drifted.length >= LIMIT) break;
  }

  console.log(`\n=== Results ===`);
  console.log(`Checked: ${checked}`);
  console.log(`Drifted: ${drifted.length}`);

  if (FIX && drifted.length > 0) {
    console.log(`\nClearing archived_photo for ${drifted.length} drifted books...`);

    let totalCleared = 0;
    for (const book of drifted) {
      const result = await pages.updateMany(
        { book_id: book.id },
        { $unset: { archived_photo: 1 } },
      );
      totalCleared += result.modifiedCount;
      console.log(`  Cleared ${result.modifiedCount} pages: ${book.title?.slice(0, 50)}`);
    }

    console.log(`\nTotal pages cleared: ${totalCleared}`);
    console.log(`\nNow run archive-ia-bulk.mjs to re-archive these books.`);
    console.log(`The fixed archiver will fetch from IIIF URLs directly (no drift).`);
  }

  await client.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
