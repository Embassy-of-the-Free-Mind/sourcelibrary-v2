#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/gallica-plethon-direct.mjs (Gallica manifest → insertBookIfNew; it must run
 * from a residential IP because Gallica 429s datacenter IPs) and scripts/import/delpher-direct.mjs (copies
 * each page to R2 itself). Neither survives Gallica's datacenter rationing: measured 2026-10-05 from
 * Hetzner, 2 of 6 image requests at 12 s spacing returned 200. This one inserts the book HELD, then
 * copies pages one at a time with backoff on 429 (60 s → 10 min) until every page is on R2, so the
 * archiver never has to fetch from Gallica. Resumable: pages already carrying archived_photo are skipped.
 *
 * gallica-paced-direct — import one Gallica ark slowly from a datacenter box.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/import/gallica-paced-direct.mjs \
 *     --manifest scripts/import/manifests/<x>.json [--commit] [--hold <reason>] [--resume <bookId>]
 * Manifest: { campaign, collections, BOOK: { ark, title, author, year, lang, place?, publisher?, note? } }
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const COMMIT = process.argv.includes('--commit');
const m = JSON.parse(fs.readFileSync(arg('--manifest'), 'utf8'));
const b = m.BOOK;
const HOLD_REASON = arg('--hold');
const RESUME = arg('--resume');
const UA = 'SourceLibrary acquisition (contact: derek@sourcelibrary.org)';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

let backoff = 60000;
async function paced(url) {
  for (;;) {
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) }); } catch (e) { r = { status: 0, ok: false }; }
    if (r.ok) { backoff = 60000; await sleep(15000); return Buffer.from(await r.arrayBuffer()); }
    if (r.status && r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status} ${url}`);
    log(`  ${r.status || 'net'} — backing off ${backoff / 1000}s`);
    await sleep(backoff); backoff = Math.min(backoff * 2, 600000);
  }
}
async function put(key, id, body) {
  assertBookScopedKey(key, id, 'gallica-paced-direct');
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME || 'sourcelibrary', Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
  return `${R2_PUBLIC}/${key}`;
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
try {
  const manifestUrl = `https://gallica.bnf.fr/iiif/ark:/12148/${b.ark}/manifest.json`;
  const sourceUrl = `https://gallica.bnf.fr/ark:/12148/${b.ark}`;
  let id = RESUME;
  if (!id) {
    const man = JSON.parse((await paced(manifestUrl)).toString('utf8'));
    const canvases = man.sequences[0].canvases;
    const shelf = (man.metadata || []).find((x) => x.label === 'Shelfmark')?.value || null;
    log(`${b.ark}: ${canvases.length} canvases · ${shelf}`);
    const bookId = new ObjectId(), now = new Date();
    const slug = `${b.title} ${b.author}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 70).replace(/-$/, '') + '-1664';
    const fields = {
      _id: bookId, id: bookId.toHexString(), slug, title: b.title, author: b.author, language: b.lang, languages: [b.lang],
      field_provenance: { language: 'caller', languages: 'caller', title: 'title_page', author: 'title_page', published: 'title_page' },
      published: String(b.year), year: b.year, ...(b.place ? { place_published: b.place } : {}), ...(b.publisher ? { publisher: b.publisher } : {}),
      pages_count: canvases.length, pages_ocr: 0, pages_translated: 0, content_type: 'book', ...(b.note ? { curator_notes: b.note } : {}),
      acquisition_campaign: m.campaign, ...(m.collections?.length ? { collections: m.collections } : {}),
      contributing_library: 'Bibliothèque nationale de France',
      dublin_core: { dc_identifier: [`ark:/12148/${b.ark}`, ...(shelf ? [shelf] : [])], dc_source: sourceUrl },
      image_source: { provider: 'gallica', provider_name: 'Gallica (BnF)', source_url: sourceUrl, iiif_manifest: manifestUrl, identifier: b.ark,
        license: 'Public domain / BnF conditions of use', license_url: 'https://gallica.bnf.fr/edit/und/conditions-dutilisation-des-contenus-de-gallica',
        contributing_library: 'Bibliothèque nationale de France', ...(shelf ? { shelfmark: shelf } : {}), access_date: now },
      source_fingerprint: `gallica:${b.ark}`,
      status: 'draft', hidden: true, visible: false, created_at: now, updated_at: now,
    };
    if (!COMMIT) { makeBookDoc(fields); log('DRY ok', slug); process.exit(0); }
    const res = await insertBookIfNew(db, fields, { importer: m.campaign, sourceIdentifier: b.ark, sourceUrl });
    if (!res.inserted) { log(`GATE ${res.reason}: ${res.message}`); process.exit(0); }
    id = res.bookId;
    if (HOLD_REASON) log('hold:', (await holdBook(db, id, { reason: HOLD_REASON, source: m.campaign, release: 'Held while gallica-paced-direct copies pages to R2; release with --to archive_complete when every page has archived_photo.' })).outcome);
    const docs = canvases.map((c, i) => { const pid = new ObjectId(); const src = c.images[0].resource['@id'];
      return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: id, page_number: i + 1, photo: src, photo_original: src,
        thumbnail: src.replace('/full/full/', '/full/150,/'), created_at: now, updated_at: now }); });
    await db.collection('pages').insertMany(docs, { ordered: false });
    log(`OK → ${id} (${docs.length} pages) /book/${slug}`);
  }
  const pages = await db.collection('pages').find({ book_id: id, archived_photo: { $exists: false } }).sort({ page_number: 1 }).toArray();
  log(`${pages.length} pages to copy to R2`);
  for (const p of pages) {
    const master = await paced(p.photo_original);
    const meta = await sharp(master).metadata();
    const nn = String(p.page_number).padStart(4, '0');
    const display = meta.width > 1200 ? await sharp(master).resize(1200).jpeg({ quality: 80 }).toBuffer() : master;
    const thumb = await sharp(master).resize(150).jpeg({ quality: 60 }).toBuffer();
    const [a, d, t] = await Promise.all([put(`archived/${id}/${p.page_number}.jpg`, id, master), put(`pages/${id}/${nn}.jpg`, id, display), put(`pages/${id}/${nn}-thumb.jpg`, id, thumb)]);
    await db.collection('pages').updateOne({ id: p.id }, { $set: { archived_photo: a, display_photo: d, thumbnail_blob: t, image_width: meta.width, image_height: meta.height,
      archive_metadata: { archived_at: new Date(), bytes: master.length, source: 'gallica_paced_direct' }, updated_at: new Date() } });
    if (p.page_number % 10 === 0) log(`  ${p.page_number}/${pages.at(-1).page_number}`);
  }
  const left = await db.collection('pages').countDocuments({ book_id: id, archived_photo: { $exists: false } });
  await db.collection('books').updateOne({ id }, { $set: { pages_archived: await db.collection('pages').countDocuments({ book_id: id, archived_photo: { $exists: true } }), updated_at: new Date() } });
  log(`DONE ${id}: ${left} pages still without archived_photo`);
} finally { await client.close(); }
