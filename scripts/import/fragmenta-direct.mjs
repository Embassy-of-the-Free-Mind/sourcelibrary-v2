#!/usr/bin/env node
/**
 * Generalized direct importer for the National Library of Finland's
 * Fragmenta membranea collection (https://fragmenta.kansalliskirjasto.fi).
 *
 * Fragmenta is a DSpace instance with NO IIIF. Its ".tif.jpg" derivatives are
 * useless ~2KB thumbnails, so for each item handle we:
 *   1. scrape the item page for the full-res ~30MB TIF master bitstreams + DC metadata,
 *   2. convert each TIF → web JPEG (+thumb) with sharp,
 *   3. rehost on R2 (images.sourcelibrary.org/manuscripts/fragmenta/<signum>/…),
 *   4. insert a hidden book + pages straight into Mongo (pipeline cron auto-enrolls).
 *
 * All Fragmenta material is CC Public Domain Mark 1.0. Dedup is by handle.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/fragmenta-direct.mjs --dry-run 1378 1387
 *   node scripts/import/fragmenta-direct.mjs --commit  1378 1387
 *
 * Handle = the numeric DSpace id in /handle/10024/<N>.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const COMMIT = process.argv.includes('--commit');
const HANDLES = process.argv.slice(2).filter(a => /^\d+$/.test(a));
if (!HANDLES.length) { console.error('Pass one or more numeric handles, e.g. 1378 1387'); process.exit(1); }

const FRAG = 'https://fragmenta.kansalliskirjasto.fi';

// Known text → author attributions (Fragmenta rarely records dc:creator).
const AUTHORS = [
  [/Reductorium morale/i, 'Petrus Berchorius (Pierre Bersuire)'],
  [/Summa conservationis et curationis/i, 'Guglielmo da Saliceto (William of Saliceto)'],
  [/De civitate Dei/i, 'Aurelius Augustinus'],
  [/Antidotarium/i, 'Unknown (Salernitan school?)'],
];

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

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
function unescapeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function scrape(handle) {
  const url = `${FRAG}/handle/10024/${handle}`;
  const html = await (await fetch(url, { headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' } })).text();
  const meta = (name) => [...html.matchAll(new RegExp(`<meta name="${name}"[^>]*content="([^"]*)"`, 'g'))].map(m => unescapeHtml(m[1]));
  const title = (meta('DC.title')[0] || `Fragmenta 10024/${handle}`).trim();
  const desc = meta('DC.description');
  const ident = meta('DC.identifier');
  const dates = meta('DC.date');
  const signum = ident.find(i => /^F\.m\./.test(i)) || `10024-${handle}`;
  const urn = ident.find(i => /^URN:/.test(i)) || null;
  const saec = desc.find(d => /Saec\./i.test(d)) || '';
  const text = desc[0] || title.replace(/^F\.m[^(]*\(([^)]*)\).*/, '$1');
  const origin = [...desc].reverse().find(d => d && d.length < 30 && /^[A-ZÅÄÖ]/.test(d) && !/^Saec/i.test(d)) || '';
  const tifLeaves = [...new Set([...html.matchAll(new RegExp(`/bitstream/handle/10024/${handle}/([^"?]+)\\.tif\\?sequence=(\\d+)`, 'g'))].map(m => `${m[1]}|${m[2]}`))]
    .map(s => { const [file, seq] = s.split('|'); return { file, seq }; })
    .sort((a, b) => a.file.localeCompare(b.file));
  const author = (AUTHORS.find(([re]) => re.test(text) || re.test(title)) || [, 'Unknown'])[1];
  const yearStart = dates[0] && /^\d{3,4}$/.test(dates[0]) ? parseInt(dates[0]) : null;
  const yearEnd = dates[1] && /^\d{3,4}$/.test(dates[1]) ? parseInt(dates[1]) : null;
  return { handle, url, title, text, signum, urn, saec, origin, author,
    dateLabel: saec || (dates.length ? dates.join('/') : '?'),
    year: yearStart && yearEnd ? Math.round((yearStart + yearEnd) / 2) : (yearStart || null),
    dateRange: dates.join('/'), tifLeaves };
}

async function rehost(handle, signum, leaf) {
  const tifUrl = `${FRAG}/bitstream/handle/10024/${handle}/${leaf.file}.tif?sequence=${leaf.seq}&isAllowed=y`;
  const res = await fetch(tifUrl, { headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' } });
  if (!res.ok) throw new Error(`fetch ${leaf.file} → ${res.status}`);
  const tif = Buffer.from(await res.arrayBuffer());
  const full = await sharp(tif).rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const thumb = await sharp(tif).rotate().resize({ width: 400, height: 400, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
  const prefix = `manuscripts/fragmenta/${slugify(signum)}`;
  const baseKey = `${prefix}/${leaf.file}`;
  if (COMMIT) {
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${baseKey}.jpg`, Body: full, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
    await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${baseKey}.thumb.jpg`, Body: thumb, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
  }
  return { photo: `${R2_PUBLIC_URL}/${baseKey}.jpg`, thumbnail: `${R2_PUBLIC_URL}/${baseKey}.thumb.jpg`, photo_original: tifUrl };
}

async function importItem(db, m) {
  const fp = `fragmenta:10024/${m.handle}`;
  if (COMMIT && db) {
    const existing = await db.collection('books').findOne({ $or: [{ source_fingerprint: fp }, { 'image_source.source_url': m.url }] }, { projection: { _id: 1, slug: 1 } });
    if (existing) { console.log(`  already imported: ${existing.slug} — skip`); return null; }
  }
  console.log(`  rehosting ${m.tifLeaves.length} leaves (TIF→JPEG→R2)…`);
  const pages = [];
  for (const leaf of m.tifLeaves) {
    const p = await rehost(m.handle, m.signum, leaf);
    pages.push(p);
    if (pages.length % 8 === 0) console.log(`    …${pages.length}/${m.tifLeaves.length}`);
  }
  if (!pages.length) { console.log('  no images — skip'); return null; }
  if (!COMMIT) { console.log(`  DRY-RUN: would insert "${m.title}" — ${pages.length} pages (author: ${m.author})`); return null; }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await uniqueSlug(db, slugify(`${m.text}-fragmenta-${m.signum}`));
  const now = new Date();
  const bookDoc = makeBookDoc({
    _id: bookId, id: bookIdStr, slug,
    title: m.title, display_title: m.text, author: m.author,
    language: 'Latin', original_language: 'Latin',
    published: m.dateLabel, year: m.year,
    categories: [], collections: [],
    thumbnail: pages[0].thumbnail || '',
    pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
    content_type: 'book', // do NOT set resource_type: ANY resource_type makes isArtworkRecord()/CollectionBookCard treat the record as artwork (→ /artwork/ route). These are textual manuscripts = books.
    dublin_core: {
      dc_identifier: [m.urn ? `URN:${m.urn}` : null, `Fragmenta:${m.signum}`, `handle:10024/${m.handle}`].filter(Boolean),
      dc_source: m.url, dc_spatial: m.origin || undefined, dc_date: m.dateRange || undefined,
    },
    image_source: {
      provider: 'fragmenta_membranea',
      provider_name: 'Fragmenta membranea — National Library of Finland',
      source_url: m.url, iiif_manifest: null,
      license: 'Creative Commons Public Domain Mark 1.0',
      contributing_library: 'National Library of Finland (Kansalliskirjasto) — Fragmenta membranea collection',
      attribution: 'National Library of Finland, Fragmenta membranea collection (CC PDM 1.0).',
      access_date: now,
    },
    notes: `Medieval (${m.saec || m.dateRange}) Latin manuscript fragment from the Fragmenta membranea collection (signum ${m.signum}; origin ${m.origin || 'unknown'}). Parchment leaf reused as a binding cover for Swedish-realm tax records, hence its survival. Imported direct from the Fragmenta DSpace TIF masters (no IIIF), rehosted on R2.`,
    status: 'draft', hidden: true, visible: false,
    source_fingerprint: fp,
    normalized_title: slugify(m.text).replace(/-/g, ' '),
    normalized_author: slugify(m.author).replace(/-/g, ' '),
    created_at: now, updated_at: now,
  });
  await db.collection('books').insertOne(bookDoc);
  const docs = pages.map((p, k) => { const pid = new ObjectId(); return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: bookIdStr, page_number: k + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo_original, created_at: now, updated_at: now }); });
  await db.collection('pages').insertMany(docs, { ordered: false });
  console.log(`  ✓ inserted ${slug} (${bookIdStr}) — ${pages.length} pages, hidden`);
  console.log(`    https://sourcelibrary.org/book/${slug}`);
  return slug;
}

async function main() {
  let client, db;
  if (COMMIT) { client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 }); await client.connect(); db = client.db('bookstore'); }
  for (const h of HANDLES) {
    console.log(`\n=== handle 10024/${h} ===`);
    const m = await scrape(h);
    console.log(`  ${m.title}\n  text=${m.text} | author=${m.author} | ${m.dateLabel} | ${m.origin} | leaves=${m.tifLeaves.length}`);
    await importItem(db, m);
  }
  if (client) await client.close();
  console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
