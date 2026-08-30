#!/usr/bin/env node
/**
 * Direct import of the Harvard-Yenching Wuzhen-pian-bearing neidan anthology
 * 道言內外秘訣全書 (FHCL:25667336, 850pp), bypassing /api/import/iiif.
 *
 * WHY direct: Harvard rate-limits (429) manifest fetches from datacenter IPs
 * (Vercel), so the server-side import route can't fetch the manifest. From a
 * residential IP the manifest + image servers return 200. So we parse the
 * already-fetched manifest (/tmp/wuzhen-manifest.json) locally and insert
 * book+pages straight into Mongo — same pattern as al-badri-direct.mjs.
 *
 * Pages reference Harvard's IIIF image URLs (mps.lib.harvard.edu) as `photo`,
 * served to the reader client-side (residential browsers → no 429). NOTE: the
 * OCR/archiving pipeline fetches these images server-side and MAY 429 from a
 * datacenter — a softer, retryable, later concern (image CDN is more tolerant;
 * archiving-watchdog retries). The facsimile renders regardless.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/harvard-wuzhen-direct.mjs --dry-run
 *   node scripts/import/harvard-wuzhen-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';

const COMMIT = process.argv.includes('--commit');
const MANIFEST_PATH = '/tmp/wuzhen-manifest.json';
const CANONICAL_MANIFEST = 'https://nrs.harvard.edu/urn-3:FHCL:25667336:MANIFEST';
const SOURCE_URL = 'https://curiosity.lib.harvard.edu/chinese-rare-books/catalog/49-990079071710203941';

function slugify(text, maxLen = 70) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').substring(0, maxLen).replace(/-$/, '');
}
async function uniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const canvases = manifest.sequences?.[0]?.canvases || [];
  if (!canvases.length) { console.error('No canvases in manifest'); process.exit(1); }

  const pages = canvases.map(c => {
    const res = c.images?.[0]?.resource;
    const svc = res?.service?.['@id'];
    const photo = res?.['@id'] || (svc ? `${svc}/full/full/0/default.jpg` : null);
    const thumbnail = svc ? `${svc}/full/200,/0/default.jpg` : photo;
    return { photo, thumbnail };
  }).filter(p => p.photo);

  console.log(`Manifest: ${canvases.length} canvases → ${pages.length} pages with images`);
  console.log(`Sample photo: ${pages[0].photo}`);

  const title = '道言內外秘訣全書 (六卷) — Daoyan neiwai mijue quanshu (incl. 悟真篇 Wuzhen pian)';
  const display_title = '道言內外秘訣全書';
  const author = '張伯端 Zhang Boduan (987–1082) et al.; ed. 吳勉學 Wu Mianxue';

  if (!COMMIT) {
    console.log(`\nDRY-RUN — would insert 1 book + ${pages.length} pages (hidden).`);
    console.log(`  title: ${title}`);
    console.log(`  manifest(fingerprint): iiif:${CANONICAL_MANIFEST}`);
    return;
  }

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  // Dedup: same IIIF manifest already imported?
  const fp = `iiif:${CANONICAL_MANIFEST}`;
  const existing = await db.collection('books').findOne(
    { $or: [{ source_fingerprint: fp }, { 'image_source.iiif_manifest': CANONICAL_MANIFEST }] },
    { projection: { _id: 1, slug: 1 } });
  if (existing) { console.log(`Already imported: ${existing.slug} (${existing._id}). Aborting.`); await client.close(); return; }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await uniqueSlug(db, slugify('daoyan-neiwai-mijue-quanshu-wuzhen-pian'));
  const now = new Date();

  const acquired = await insertBookIfNew(db, {
    _id: bookId, id: bookIdStr, slug,
    title, display_title, author,
    language: 'Chinese', original_language: 'Chinese',
    published: '明萬曆 Ming Wanli (1573–1620)',
    categories: [], collections: ['east-asia', 'alchemy', 'chinese-classics', 'mysticism'],
    thumbnail: pages[0].thumbnail || '',
    pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
    content_type: 'book',
    dublin_core: {
      dc_identifier: [`IIIF:${manifest['@id'] || CANONICAL_MANIFEST}`, 'HOLLIS:990079071710203941'],
      dc_source: CANONICAL_MANIFEST,
    },
    image_source: {
      provider: 'harvard', provider_name: 'Harvard-Yenching Library',
      source_url: SOURCE_URL, iiif_manifest: CANONICAL_MANIFEST,
      license: 'Harvard viewer terms (https://nrs.lib.harvard.edu/urn-3:hul.ois:hlviewerterms)',
      contributing_library: 'Harvard-Yenching Library (CURIOSity Chinese Rare Books)',
      attribution: 'Provided by Harvard University.', access_date: now,
    },
    notes: 'Ming Wanli neidan anthology containing Zhang Boduan\'s 悟真篇 Wuzhen pian (Awakening to Reality). Imported direct from the Harvard IIIF manifest (residential fetch) to bypass datacenter 429 on the server-side import route.',
    status: 'draft', hidden: true, visible: false,
    source_fingerprint: fp,
    normalized_title: slugify(display_title).replace(/-/g, ' '),
    normalized_author: 'boduan zhang',
    created_at: now, updated_at: now,
  }, { importer: 'script:harvard-wuzhen-direct', sourceIdentifier: 'wuzhen-pian', sourceUrl: CANONICAL_MANIFEST });
  // The gate declined this candidate; the reason is a row in `dedup_skips`.
  if (!acquired.inserted) { console.log(`SKIP — ${acquired.message}`); await client.close(); return; }
  console.log(`Inserted book ${bookIdStr} slug=${slug}`);

  const CHUNK = 500;
  for (let s = 0; s < pages.length; s += CHUNK) {
    const docs = pages.slice(s, s + CHUNK).map((p, k) => {
      const pid = new ObjectId();
      return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: bookIdStr,
        page_number: s + k + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo,
        created_at: now, updated_at: now });
    });
    await db.collection('pages').insertMany(docs, { ordered: false });
    console.log(`  inserted pages ${s + 1}-${s + docs.length}`);
  }
  await client.close();
  console.log(`Done. Book ${bookIdStr}, ${pages.length} pages, hidden. slug=${slug}`);
}
main().catch(e => { console.error(e); process.exit(1); });
