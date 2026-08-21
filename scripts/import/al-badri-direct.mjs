#!/usr/bin/env node
/**
 * One-off import for al-Badri's "Rahat al-Arwah fi al-Hashish wa-al-Rah"
 * (15th c. Arabic treatise on hashish).
 *
 * The text is bundled inside the multi-file IA item `20230305_20230305_1003`
 * along with ~300 unrelated Arabic books. Standard import scripts can't address
 * an individual file in a bundle, so this script hardcodes the URL pattern,
 * targeting the al-Badri JP2 zip via IA's IIIF image server with NFD-normalized
 * Arabic filenames (the encoding IA actually stores on disk).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/al-badri-direct.mjs [--dry-run]
 */

import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const BUNDLE_ID = '20230305_20230305_1003';
const BASENAME_NFC = 'البدري - راحة الأرواح في الحشيش والراح';
const BASENAME_NFD = BASENAME_NFC.normalize('NFD');
const PAGE_COUNT = 282;

const ZIP_FN = `${BASENAME_NFD}_jp2.zip`;
const ZIP_BASE = `${BASENAME_NFD}_jp2`;

function pageUrl(zeroIndex, pct) {
  const padded = String(zeroIndex).padStart(4, '0');
  const pageFile = `${BASENAME_NFD}_${padded}.jp2`;
  const path = `${encodeURIComponent(BUNDLE_ID)}%2F${encodeURIComponent(ZIP_FN)}%2F${encodeURIComponent(ZIP_BASE)}%2F${encodeURIComponent(pageFile)}`;
  const size = pct ? `pct:${pct}` : 'max';
  return `https://iiif.archive.org/image/iiif/3/${path}/full/${size}/0/default.jpg`;
}

function getPageUrl(zeroIndex) { return pageUrl(zeroIndex); }
function getThumbUrl(zeroIndex) { return pageUrl(zeroIndex, 15); }

function slugify(text, maxLen = 60) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function main() {
  const entry = {
    title: 'Rāḥat al-arwāḥ fī al-ḥashīsh wa-al-rāḥ',
    display_title: 'راحة الأرواح في الحشيش والراح',
    author: 'Muḥammad ibn Aḥmad al-Badrī al-Dimashqī',
    year: 1483,
    language: 'Arabic',
    notes: '15th-century Arabic treatise on hashish and wine. Page images sourced from IA bundle 20230305_20230305_1003 (Arabic library dump) via IIIF image server with NFD-normalized Arabic filenames.',
  };

  // Verify the IIIF endpoint serves page 0 before any DB writes
  console.log('Verifying IIIF endpoint...');
  const testUrl = getPageUrl(0);
  const r = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    console.error(`Page 0 IIIF check failed: HTTP ${r.status} ${testUrl}`);
    process.exit(1);
  }
  console.log(`Page 0 IIIF check: ${r.status} ${r.headers.get('content-type')}`);

  if (DRY_RUN) {
    console.log('DRY-RUN sample URLs:');
    console.log('  page 1:  ' + getPageUrl(0));
    console.log('  page 100:' + getPageUrl(99));
    console.log('  page 282:' + getPageUrl(281));
    console.log(`Would insert 1 book + ${PAGE_COUNT} pages`);
    return;
  }

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  // Duplicate guard
  const fingerprint = `ia-bundle:${BUNDLE_ID}/al-badri-rahat-al-arwah`;
  const existing = await db.collection('books').findOne(
    { $or: [{ source_fingerprint: fingerprint }, { normalized_title: 'rahat al arwah fi al hashish wa al rah' }] },
    { projection: { _id: 1 } }
  );
  if (existing) {
    console.log(`Skipping — book already exists: ${existing._id}`);
    await client.close();
    return;
  }

  const slug = await generateUniqueSlug(db, slugify(`${entry.title}-${entry.author}`.substring(0, 80)));
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();

  const bookDoc = makeBookDoc({
    _id: bookId,
    id: bookIdStr,
    slug,
    title: entry.title,
    display_title: entry.display_title,
    author: entry.author,
    language: entry.language,
    published: String(entry.year),
    categories: [],
    ia_identifier: null,
    thumbnail: getThumbUrl(0),
    pages_count: PAGE_COUNT,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    dublin_core: {
      dc_identifier: [`IA-BUNDLE:${BUNDLE_ID}/al-badri-rahat-al-arwah`],
      dc_source: `https://archive.org/details/${BUNDLE_ID}`,
    },
    image_source: {
      provider: 'internet_archive',
      provider_name: 'Internet Archive',
      source_url: `https://archive.org/details/${BUNDLE_ID}`,
      identifier: BUNDLE_ID,
      license: 'publicdomain',
      contributing_library: 'Internet Archive (user upload — Arabic library bundle)',
      access_date: new Date(),
    },
    page_count_source: 'scandata_xml',
    notes: entry.notes,
    status: 'draft',
    hidden: true,
    visible: false,
    source_fingerprint: fingerprint,
    normalized_title: 'rahat al arwah fi al hashish wa al rah',
    normalized_author: 'muhammad ibn ahmad al badri al dimashqi',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await db.collection('books').insertOne(bookDoc);
  console.log(`Inserted book ${bookIdStr} slug=${slug}`);

  const CHUNK = 500;
  for (let start = 0; start < PAGE_COUNT; start += CHUNK) {
    const pageDocs = [];
    for (let p = start; p < Math.min(start + CHUNK, PAGE_COUNT); p++) {
      const pageId = new ObjectId();
      pageDocs.push(makePageDoc({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: p + 1,
        photo: getPageUrl(p),
        thumbnail: getThumbUrl(p),
        photo_original: getPageUrl(p),
        created_at: new Date(),
        updated_at: new Date(),
      }));
    }
    await db.collection('pages').insertMany(pageDocs, { ordered: false });
    console.log(`Inserted pages ${start + 1}-${start + pageDocs.length}`);
  }

  await client.close();
  console.log(`Done. Book id=${bookIdStr}, ${PAGE_COUNT} pages.`);
}

main().catch(e => { console.error(e); process.exit(1); });
