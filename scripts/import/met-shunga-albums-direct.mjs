#!/usr/bin/env node
/**
 * Convert the three Met shunga albums from per-page artwork docs into proper
 * book records with readable pages (issue #2428).
 *
 * Background: a Met import created one `content_type:'artwork'` doc per page
 * (`met-eisen-snow-on-fuji-page-1` … `-page-18`, etc.) instead of one book.
 * 84 fragments total, no reading experience, no OCR/translation. This script
 * builds the books the fragments should have been:
 *
 *   - one book doc per album (content_type 'book', language Japanese)
 *   - pages from each fragment's `commons_full_url` (Met CRDImages original),
 *     ordered by the page number in the fragment slug
 *   - images archived to R2 at import time (`archived/<bookId>/<n>.jpg`) —
 *     images.metmuseum.org is NOT in the pipeline's ARCHIVABLE_SOURCES, so
 *     leaving Met URLs as `photo` would jam the books in the archiving phase
 *   - pipeline_auto left absent → the cron auto-enrolls the books for
 *     OCR/translation (that's what we want)
 *
 * The 84 artwork fragments are NOT touched — deleting/retiring them is a
 * separate, explicitly-confirmed step (see issue #2428).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/met-shunga-albums-direct.mjs --dry-run
 *   node scripts/import/met-shunga-albums-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const COMMIT = process.argv.includes('--commit');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';

const ALBUMS = [
  {
    slugPrefix: 'met-eisen-snow-on-fuji',
    bookSlug: 'snow-on-fuji-eisen-shunga',
    title: 'Snow on Fuji (艶本 婦慈のゆき, Fuji no yuki)',
    metObject: 'https://www.metmuseum.org/art/collection/search/78597',
  },
  {
    slugPrefix: 'met-kunimori-weighing-goods-of-love',
    bookSlug: 'weighing-the-goods-of-love-kunimori-shunga',
    title: 'Weighing the Goods of Love (艶色品定女, Enshoku shina sadame)',
    metObject: 'https://www.metmuseum.org/art/collection/search/78660',
  },
  {
    slugPrefix: 'met-kuniyoshi-tosei-komoncho',
    bookSlug: 'tosei-komoncho-kuniyoshi-shunga',
    title: 'Tōsei Komonchō (Kuniyoshi Shunga)',
    metObject: 'https://www.metmuseum.org/art/collection/search/78662',
  },
];

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function archivePage(bookId, n, sourceUrl) {
  const res = await fetch(sourceUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`fetch ${res.status} ${sourceUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const jpeg = await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const thumb = await sharp(buf).resize({ width: 300, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  for (const [key, body] of [
    [`archived/${bookId}/${n}.jpg`, jpeg],
    [`archived/${bookId}/${n}-thumb.jpg`, thumb],
  ]) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body,
      ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return {
    photo: `https://images.sourcelibrary.org/archived/${bookId}/${n}.jpg`,
    thumbnail: `https://images.sourcelibrary.org/archived/${bookId}/${n}-thumb.jpg`,
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  for (const album of ALBUMS) {
    const fragments = await books.find(
      { slug: new RegExp(`^${album.slugPrefix}-page-\\d+$`) },
      { projection: { slug: 1, title: 1, author: 1, published: 1, medium: 1, dimensions_display: 1, commons_full_url: 1, commons_license: 1, image_source: 1, enrichment: 1 } },
    ).toArray();
    fragments.sort((a, b) =>
      parseInt(a.slug.match(/-page-(\d+)$/)[1]) - parseInt(b.slug.match(/-page-(\d+)$/)[1]));

    const pageNums = fragments.map(f => parseInt(f.slug.match(/-page-(\d+)$/)[1]));
    const contiguous = pageNums.every((n, i) => n === i + 1);
    const missingUrl = fragments.filter(f => !f.commons_full_url).map(f => f.slug);
    console.log(`\n${album.title}`);
    console.log(`  fragments: ${fragments.length}, contiguous 1..N: ${contiguous}, missing image URL: ${missingUrl.length ? missingUrl.join(', ') : 'none'}`);
    if (!fragments.length || missingUrl.length) { console.log('  SKIP — fix data first'); continue; }
    if (!contiguous) console.log(`  page numbers: ${pageNums.join(',')} (will renumber sequentially, original kept in source_page)`);

    const f0 = fragments[0];
    const fp = `met:${album.metObject}`;
    const existing = await books.findOne(
      { $or: [{ source_fingerprint: fp }, { slug: album.bookSlug }] },
      { projection: { _id: 1, slug: 1 } });
    if (existing) { console.log(`  Already imported: ${existing.slug} (${existing._id}) — skipping.`); continue; }

    if (!COMMIT) { console.log(`  DRY-RUN — would insert 1 book (${album.bookSlug}) + ${fragments.length} pages, archive ${fragments.length} images to R2.`); continue; }

    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const now = new Date();

    // Archive all page images to R2 first; only insert Mongo docs if all succeed.
    const archived = [];
    for (let i = 0; i < fragments.length; i++) {
      const urls = await archivePage(bookIdStr, i + 1, fragments[i].commons_full_url);
      archived.push(urls);
      console.log(`  archived page ${i + 1}/${fragments.length}`);
      await new Promise(r => setTimeout(r, 500));
    }

    const bookDoc = {
      _id: bookId, id: bookIdStr, slug: album.bookSlug,
      title: album.title, display_title: album.title,
      author: f0.author,
      language: 'Japanese', original_language: 'Japanese',
      published: f0.published || '',
      medium: f0.medium || 'Woodblock printed book; ink and color on paper',
      dimensions_display: f0.dimensions_display || '',
      categories: ['Visual Art', 'Japanese Art'],
      collections: ['erotic-art'],
      thumbnail: archived[0].thumbnail,
      pages_count: fragments.length, pages_ocr: 0, pages_translated: 0,
      pages_archived: fragments.length,
      content_type: 'book',
      image_source: {
        provider: 'met', provider_name: 'The Metropolitan Museum of Art',
        source_url: album.metObject,
        license: f0.commons_license || 'CC0 1.0',
        attribution: f0.image_source?.attribution || 'Metropolitan Museum of Art, New York',
        contributing_library: f0.image_source?.contributing_library || 'Metropolitan Museum of Art, New York, NY',
        access_date: now,
      },
      notes: `Converted from ${fragments.length} per-page artwork records (slugs ${album.slugPrefix}-page-*) into a readable book — issue #2428. Images are the Met CRDImages originals, archived to R2 at import.`,
      status: 'draft', hidden: true, visible: false,
      source_fingerprint: fp,
      created_at: now, updated_at: now,
    };
    await books.insertOne(bookDoc);
    console.log(`  inserted book ${bookIdStr} slug=${album.bookSlug}`);

    const pageDocs = fragments.map((f, i) => {
      const pid = new ObjectId();
      return {
        _id: pid, id: pid.toHexString(), book_id: bookIdStr,
        page_number: i + 1,
        photo: archived[i].photo, thumbnail: archived[i].thumbnail,
        photo_original: f.commons_full_url,
        source_page: { artwork_slug: f.slug, met_page: pageNums[i] },
        created_at: now, updated_at: now,
      };
    });
    await db.collection('pages').insertMany(pageDocs, { ordered: false });
    console.log(`  inserted ${pageDocs.length} pages`);
  }

  await client.close();
  console.log(`\nDone${COMMIT ? '' : ' (dry run)'}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
