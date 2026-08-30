#!/usr/bin/env node
/**
 * Direct importer for digitized rare books/manuscripts from the University of
 * Tartu Library DSpace (https://dspace.ut.ee). Tartu serves its digitized rare
 * material as large single-PDF bitstreams (IIIF is enabled only on a subset of
 * image items, NOT on these books), so the server /api/import/pdf route would
 * time out on Vercel (300s) for 100–400MB files. This does it locally:
 *   download PDF → pdftoppm (JPEG, scaled) → upload pages to R2 → insert hidden
 *   book + pages into Mongo (pipeline cron auto-enrolls for OCR/translation).
 *
 * Most Tartu digitized material is CC0. Dedup is by DSpace item URL.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/tartu-dspace-pdf-direct.mjs --dry-run
 *   node scripts/import/tartu-dspace-pdf-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const COMMIT = process.argv.includes('--commit');
// Optional: --items <path.json> supplies the import list (array of item objects with the
// same shape as the built-in ITEMS below). Lets the same importer drive curated sweeps.
const itemsArgIdx = process.argv.indexOf('--items');
const ITEMS_FILE = itemsArgIdx > -1 ? process.argv[itemsArgIdx + 1] : null;

const BUILTIN_ITEMS = [
  {
    pdf_url: 'https://dspace.ut.ee/server/api/core/bitstreams/8d041997-43a7-4d59-817d-63ba80b3cdf5/content',
    item_url: 'https://dspace.ut.ee/items/4a243232-8f87-48c6-b95d-e5a56d61db1c',
    title: 'Clavis magiae: die geheime Naturweisheit vom Stein der Weisen',
    display_title: 'Key of Magic: The Secret Natural Wisdom of the Philosopher’s Stone',
    author: 'Unknown', language: 'German', published: '1794', year: 1794,
    identifier: 'Mscr 362', resource_type: 'manuscript',
    slug_base: 'clavis-magiae-secret-wisdom-philosophers-stone',
  },
  {
    pdf_url: 'https://dspace.ut.ee/server/api/core/bitstreams/94ffc90b-5878-4855-b465-a1f0852c2a7e/content',
    item_url: 'https://dspace.ut.ee/items/2db9da61-eec8-4eeb-948c-5ee686af6b83',
    title: 'Der grossen Wundartzney das erst Buch (Große Wundarznei)',
    display_title: 'The Great Surgery',
    author: 'Paracelsus (Theophrastus von Hohenheim)', language: 'German', published: '1536', year: 1536,
    identifier: 'R V o 25', resource_type: 'book',
    slug_base: 'die-grosse-wundarznei-paracelsus-1536',
  },
];

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

function slugify(t, n = 70) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, n).replace(/-$/, '');
}
async function uniqueSlug(db, base) { let s = base, i = 2; while (await db.collection('books').findOne({ slug: s }, { projection: { _id: 1 } })) s = `${base}-${i++}`; return s; }

async function downloadTo(url, path) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' } });
  if (!res.ok) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
}

async function importItem(db, it) {
  const fp = `tartu-dspace:${it.item_url}`;
  if (COMMIT) {
    const ex = await db.collection('books').findOne({ $or: [{ source_fingerprint: fp }, { 'image_source.source_url': it.item_url }] }, { projection: { slug: 1 } });
    if (ex) { console.log(`  already imported: ${ex.slug} — skip`); return; }
  }
  const work = mkdtempSync(join(tmpdir(), 'tartu-'));
  const pdfPath = join(work, 'src.pdf');
  try {
    console.log(`  downloading ${it.pdf_url} …`);
    await downloadTo(it.pdf_url, pdfPath);
    const np = parseInt(execFileSync('pdfinfo', [pdfPath]).toString().match(/Pages:\s+(\d+)/)?.[1] || '0', 10);
    console.log(`  ${np} pages; rasterizing (pdftoppm jpeg, longest side 2000px)…`);
    execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-scale-to', '2000', pdfPath, join(work, 'p')], { stdio: 'ignore' });
    const files = readdirSync(work).filter(f => f.endsWith('.jpg')).sort();
    if (!files.length) throw new Error('pdftoppm produced no pages');
    console.log(`  rasterized ${files.length} pages; uploading to R2…`);
    const prefix = `manuscripts/tartu/${it.slug_base}`;
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      const key = `${prefix}/p${String(i + 1).padStart(4, '0')}.jpg`;
      if (COMMIT) await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(join(work, files[i])), ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
      pages.push(`${R2_PUBLIC_URL}/${key}`);
      if ((i + 1) % 50 === 0) console.log(`    …${i + 1}/${files.length}`);
    }
    if (!COMMIT) { console.log(`  DRY-RUN: "${it.title}" — ${pages.length} pages (no upload/insert)`); return; }

    const bookId = new ObjectId(); const idStr = bookId.toHexString();
    const slug = await uniqueSlug(db, it.slug_base); const now = new Date();
    await db.collection('books').insertOne(makeBookDoc({
      _id: bookId, id: idStr, slug,
      title: it.title, display_title: it.display_title, author: it.author,
      language: it.language, original_language: it.language, published: it.published, year: it.year,
      categories: [], collections: [], thumbnail: pages[0] || '',
      pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
      content_type: 'book', // do NOT set resource_type: ANY resource_type makes isArtworkRecord()/CollectionBookCard treat the record as artwork (→ /artwork/ route). These are textual books.
      dublin_core: { dc_identifier: [`Tartu:${it.identifier}`, it.item_url], dc_source: it.item_url },
      image_source: {
        provider: 'tartu_dspace', provider_name: 'University of Tartu Library (DSpace)',
        source_url: it.item_url, iiif_manifest: null,
        license: 'CC0 1.0 Universal', contributing_library: 'University of Tartu Library (Tartu Ülikooli raamatukogu)',
        attribution: 'University of Tartu Library (CC0 1.0).', access_date: now,
      },
      notes: `Digitized rare ${it.resource_type} from the University of Tartu Library DSpace (shelfmark ${it.identifier}). Imported from the source PDF bitstream (rasterized locally; Tartu does not expose IIIF for these books), rehosted on R2.`,
      status: 'draft', hidden: true, visible: false, source_fingerprint: fp,
      normalized_title: slugify(it.display_title).replace(/-/g, ' '), normalized_author: slugify(it.author).replace(/-/g, ' '),
      created_at: now, updated_at: now,
    }));
    const CHUNK = 500;
    for (let s = 0; s < pages.length; s += CHUNK) {
      const docs = pages.slice(s, s + CHUNK).map((photo, k) => { const pid = new ObjectId(); return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: idStr, page_number: s + k + 1, photo, thumbnail: photo, photo_original: photo, created_at: now, updated_at: now }); });
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    console.log(`  ✓ inserted ${slug} (${idStr}) — ${pages.length} pages, hidden`);
    console.log(`    https://sourcelibrary.org/book/${slug}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

async function main() {
  const ITEMS = ITEMS_FILE ? JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) : BUILTIN_ITEMS;
  let client, db;
  if (COMMIT) { client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 }); await client.connect(); db = client.db('bookstore'); }
  for (const it of ITEMS) { console.log(`\n=== ${it.display_title} (${it.published}) ===`); await importItem(db, it); }
  if (client) await client.close();
  console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
