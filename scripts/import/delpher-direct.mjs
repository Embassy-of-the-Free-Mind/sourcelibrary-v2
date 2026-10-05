#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-manifest-direct.mjs (manifest → makeBookDoc → insertBookIfNew → hold →
 * pages; reused for the shape) and scripts/import/import-pdf-books.mjs (uploads page variants to R2
 * itself). Neither reads a KB/Delpher object: Delpher has no IIIF manifest, its page JP2s do not
 * render in browsers, and its hosts are on neither image allowlist (invariants/image-host-allowlists.md),
 * so the pages cannot be stored as external URLs for the archiver the way IA pages are. No repo script
 * mentions delpher or resolver.kb.nl (git grep, 2026-10-05).
 *
 * delpher-direct — import Delpher (KB, Koninklijke Bibliotheek) books by URN, pages copied to R2.
 *
 *   Object list:  https://resolver.kb.nl/resolve?urn=<URN>:mpeg21   (DIDL: one Item per page)
 *   Page image:   https://imageviewer.kb.nl/ImagingService/imagingService?id=<URN>:<NNNNN>:image
 *                 (JPEG at the JP2's native size — the largest the KB serves publicly)
 *
 * Each page is written to the archiver's own R2 layout, so the book arrives already archived:
 *   archived/<bookId>/<n>.jpg (master as served), pages/<bookId>/<NNNN>.jpg (display ≤1200px),
 *   pages/<bookId>/<NNNN>-thumb.jpg. Every key passes assertBookScopedKey (#3362).
 *
 * Manifest JSON: { "campaign", "collections": [], "BOOKS": [ { "urn": "MMKB02:100007776", "title",
 *   "author", "year", "lang", "place"?, "publisher"?, "note"? } ] }  — identity from the title page.
 * Lands HIDDEN; --hold <reason> parks it (release with hold-pipeline-books.mjs --to archive_complete).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/import/delpher-direct.mjs --manifest <x>.json [--commit] [--hold <reason>]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const COMMIT = process.argv.includes('--commit');
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const MANIFEST = argAfter('--manifest');
const HOLD_REASON = argAfter('--hold');
if (!MANIFEST) { console.error('Required: --manifest <json>'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const IMPORTER = manifest.campaign || path.basename(MANIFEST, '.json');
const COLLECTIONS = manifest.collections || [];
const UA = 'SourceLibrary acquisition (contact: derek@sourcelibrary.org)';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (t >= tries) throw new Error(`HTTP ${r.status} ${url}`);
    } catch (e) { if (t >= tries) throw e; }
    await sleep(2000 * t);
  }
}
async function put(key, bookId, body) {
  assertBookScopedKey(key, bookId, 'delpher-direct');
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
  return `${R2_PUBLIC}/${key}`;
}
const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '');

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');
try {
  for (const b of manifest.BOOKS) {
    const didl = (await get(`https://resolver.kb.nl/resolve?urn=${b.urn}:mpeg21`)).toString('utf8');
    const seqs = [...new Set([...didl.matchAll(new RegExp(`${b.urn.replace(':', '\\:')}:(\\d{5}):image"`, 'g'))].map((m) => m[1]))].sort();
    const pdfMd5 = didl.match(/:pdf"[\s\S]*?dc:type="md5">([0-9A-F]+)</)?.[1] || null;
    console.log(`${b.urn}: ${seqs.length} pages in DIDL · "${b.title.slice(0, 60)}"`);
    if (!seqs.length) { console.log('  FAIL no pages'); continue; }
    const delpherUrl = `https://www.delpher.nl/nl/boeken/view?coll=boeken&identifier=${b.urn}`;
    const imgUrl = (s) => `https://imageviewer.kb.nl/ImagingService/imagingService?id=${b.urn}:${s}:image`;
    const bookId = new ObjectId(), now = new Date();
    let slug = slugify(`${b.title} ${b.author}`), i = 2;
    while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${slugify(`${b.title} ${b.author}`)}-${i++}`;
    const fields = {
      _id: bookId, id: bookId.toHexString(), slug, title: b.title, author: b.author,
      language: b.lang, languages: [b.lang], field_provenance: { language: 'caller', languages: 'caller', title: 'title_page', author: 'title_page', published: 'title_page' },
      published: String(b.year), year: b.year,
      ...(b.place ? { place_published: b.place } : {}), ...(b.publisher ? { publisher: b.publisher } : {}),
      pages_count: seqs.length, pages_ocr: 0, pages_translated: 0, content_type: 'book',
      ...(b.note ? { curator_notes: b.note } : {}), acquisition_campaign: IMPORTER,
      ...(COLLECTIONS.length ? { collections: COLLECTIONS } : {}),
      contributing_library: 'Koninklijke Bibliotheek',
      dublin_core: { dc_identifier: [`KB:${b.urn}`], dc_source: delpherUrl },
      image_source: { provider: 'delpher', provider_name: 'Delpher (Koninklijke Bibliotheek)', source_url: delpherUrl,
        identifier: b.urn, license: 'publicdomain', rights: b.rights || null, contributing_library: 'Koninklijke Bibliotheek',
        didl_url: `https://resolver.kb.nl/resolve?urn=${b.urn}:mpeg21`, ...(pdfMd5 ? { pdf_md5: pdfMd5 } : {}), access_date: now },
      status: 'draft', hidden: true, visible: false, created_at: now, updated_at: now,
    };
    if (!COMMIT) { makeBookDoc(fields); console.log(`  DRY ok → slug ${slug}`); continue; }
    const res = await insertBookIfNew(db, fields, { importer: IMPORTER, sourceIdentifier: b.urn, sourceUrl: delpherUrl });
    if (!res.inserted) { console.log(`  GATE ${res.reason}: ${res.message}`); continue; }
    const id = res.bookId;
    if (HOLD_REASON) console.log('  hold:', (await holdBook(db, id, { reason: HOLD_REASON, source: IMPORTER,
      release: `Held at import by delpher-direct.mjs; pages are already on R2 — release with --to archive_complete.` })).outcome);
    const docs = [];
    for (let k = 0; k < seqs.length; k++) {
      const n = k + 1, nn = String(n).padStart(4, '0');
      const master = await get(imgUrl(seqs[k]));
      const meta = await sharp(master).metadata();
      const display = meta.width > 1200 ? await sharp(master).resize(1200).jpeg({ quality: 80 }).toBuffer() : master;
      const thumb = await sharp(master).resize(150).jpeg({ quality: 60 }).toBuffer();
      const [a, d, t] = await Promise.all([put(`archived/${id}/${n}.jpg`, id, master), put(`pages/${id}/${nn}.jpg`, id, display), put(`pages/${id}/${nn}-thumb.jpg`, id, thumb)]);
      const pid = new ObjectId();
      docs.push(makePageDoc({ _id: pid, id: pid.toHexString(), book_id: id, page_number: n,
        photo: d, photo_original: imgUrl(seqs[k]), thumbnail: t, archived_photo: a, display_photo: d, thumbnail_blob: t,
        image_width: meta.width, image_height: meta.height,
        archive_metadata: { archived_at: new Date(), bytes: master.length, source: 'delpher_imaging_service' },
        created_at: now, updated_at: now }));
      if (n % 25 === 0) console.log(`  ${n}/${seqs.length}`);
      await sleep(250);
    }
    await db.collection('pages').insertMany(docs, { ordered: false });
    await db.collection('books').updateOne({ id }, { $set: { thumbnail: docs[0].thumbnail, pages_archived: docs.length, updated_at: new Date() } });
    console.log(`  OK → ${id} (${docs.length} pages on R2) /book/${slug}`);
  }
} finally { await client.close(); }
