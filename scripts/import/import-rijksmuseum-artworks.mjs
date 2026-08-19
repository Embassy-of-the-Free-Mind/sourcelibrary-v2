#!/usr/bin/env node
/**
 * Import CC0 Java/Indonesia objects from the Rijksmuseum as artwork entries.
 *
 * Rijksmuseum Linked Open Data (keyless, Linked Art). Per-object the image lives
 * 4 hops deep:
 *   search ?type=…           -> orderedItems[].id            (HumanMadeObject)
 *   resolve object           -> identified_by/produced_by/made_of/dimension, shows[].id (VisualItem)
 *   resolve VisualItem       -> subject_to (license), digitally_shown_by[].id (DigitalObject)
 *   resolve DigitalObject    -> access_point[].id  (IIIF .../full/max/0/default.jpg)
 *
 * Creates content_type:'artwork' books (single object, pages_count:0, no OCR
 * pipeline). Java-relevant filtering is keyword-based (the search API has no
 * geography param). visible:false by default for QA; pass --publish to go live.
 *
 * Searches by title keyword (the API has no geography/free-text param, but
 * `title=Java` returns 768 on-theme objects: Javanese keris, batik, wayang,
 * Borobudur photography, court scenes).
 *
 * Usage:
 *   set -a; source /Users/dereklomas/sourcelibrary/.env.production.local; set +a
 *   node scripts/import/import-rijksmuseum-artworks.mjs --dry-run --limit 15
 *   node scripts/import/import-rijksmuseum-artworks.mjs --limit 60
 *   node scripts/import/import-rijksmuseum-artworks.mjs --queries Java,Borobudur,Prambanan --publish
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { parseArgs } from 'util';
import sharp from 'sharp';
import { makeBookDoc } from '../lib/book-docs.mjs';

const { values: args } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
  limit: { type: 'string' },
  queries: { type: 'string', default: 'Java' },
  'java-filter': { type: 'boolean', default: false },
  publish: { type: 'boolean', default: false },
} });
const DRY = args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const QUERIES = args.queries.split(',').map(s => s.trim()).filter(Boolean);
const JAVA_FILTER = args['java-filter'];   // off by default — title= search already scopes relevance
const PUBLISH = args.publish;

const JAVA_RE = /\b(java|javaan|javane|jogja|yogya|ngayog|surakarta|solo|mataram|kraton|keraton|pakualaman|mangkunegaran|cirebon|borobudur|prambanan|sunan|sultan)\b/i;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const UA = 'SourceLibrary-importer/1.0 (https://sourcelibrary.org; library ingest)';

const r2 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const mongo = new MongoClient(process.env.MONGODB_URI);

const slugify = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, redirect: 'follow' });
      if (r.ok) return await r.json();
    } catch {}
    if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`GET failed: ${url}`);
}
async function getBuffer(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch {}
    if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`image GET failed: ${url}`);
}
async function uploadR2(key, buf, ct = 'image/jpeg') {
  if (DRY) return `${R2_PUBLIC_URL}/${key}`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct, CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const names = o => (o.identified_by || []).filter(x => x.type === 'Name').map(n => ({ content: n.content, lang: (n.language?.[0]?._label || '').toLowerCase() }));
const pickTitle = o => { const n = names(o); return (n.find(x => x.lang === 'english') || n[0])?.content || 'Untitled object'; };
const identifier = o => (o.identified_by || []).find(x => x.type === 'Identifier')?.content || null;
function producedInfo(o) {
  const p = o.produced_by || {};
  const date = p.timespan?.identified_by?.[0]?.content || (p.timespan?.begin_of_the_begin || '').slice(0, 4) || '';
  const place = (p.took_place_at || []).map(x => x._label).filter(Boolean).join(', ');
  return { date, place };
}
const materials = o => (o.made_of || []).map(m => m._label).filter(Boolean).join(', ');
const dimensions = o => (o.dimension || []).map(d => `${d.value} ${d.unit?._label || ''}`.trim()).filter(Boolean).join('; ');

async function resolveImage(objJson) {
  const visId = objJson.shows?.[0]?.id; if (!visId) return null;
  const vis = await getJson(visId);
  const license = vis.subject_to?.[0]?.classified_as?.[0]?.id || null; // creativecommons URL
  const doId = vis.digitally_shown_by?.[0]?.id; if (!doId) return { license, imageUrl: null };
  const dobj = await getJson(doId);
  const imageUrl = dobj.access_point?.[0]?.id || null; // IIIF .../full/max/0/default.jpg
  return { license, imageUrl };
}

async function main() {
  await mongo.connect();
  const db = mongo.db('bookstore');
  const booksCol = db.collection('books');
  let imported = 0, skipped = 0, filtered = 0, failed = 0;
  console.log(`Rijksmuseum import${DRY ? ' (DRY)' : ''} | queries=${QUERIES.join(',')} | java-filter=${JAVA_FILTER} | publish=${PUBLISH} | limit=${LIMIT}`);

  for (const q of QUERIES) {
    if (imported >= LIMIT) break;
    let url = `https://data.rijksmuseum.nl/search/collection?title=${encodeURIComponent(q)}&imageAvailable=true`;
    let page;
    try { page = await getJson(url); } catch (e) { console.log(`  title=${q}: search failed (${e.message})`); continue; }
    const total = page.partOf?.totalItems ?? (page.orderedItems || []).length;
    console.log(`\n[title=${q}] ${total} objects with images`);

    while (page && imported < LIMIT) {
      for (const it of (page.orderedItems || [])) {
        if (imported >= LIMIT) break;
        let obj;
        try { obj = await getJson(it.id); } catch { failed++; continue; }
        const title = pickTitle(obj);
        const allText = names(obj).map(n => n.content).join(' ') + ' ' + producedInfo(obj).place;
        if (JAVA_FILTER && !JAVA_RE.test(allText)) { filtered++; continue; }

        const objNum = identifier(obj) || it.id.split('/').pop();
        const fingerprint = `rijksmuseum:${objNum}`;
        if (await booksCol.findOne({ source_fingerprint: fingerprint })) { skipped++; continue; }

        let img; try { img = await resolveImage(obj); } catch { failed++; continue; }
        if (!img?.imageUrl) { failed++; continue; }
        const { date, place } = producedInfo(obj);

        if (DRY) { console.log(`  [DRY] ${objNum}  ${title}  (${place || '?'}, ${date || '?'})  ${img.license || ''}`); imported++; continue; }

        let bookId, slug, fullUrl, dispUrl, thumbUrl;
        try {
          const buf = await getBuffer(img.imageUrl);
          const meta = await sharp(buf, { limitInputPixels: false }).metadata();
          bookId = new ObjectId();
          const base = `artworks/${bookId.toHexString()}`;
          const [dBuf, tBuf] = await Promise.all([
            sharp(buf, { limitInputPixels: false }).resize(1200).jpeg({ quality: 82 }).toBuffer(),
            sharp(buf, { limitInputPixels: false }).resize(150).jpeg({ quality: 60 }).toBuffer(),
          ]);
          [fullUrl, dispUrl, thumbUrl] = await Promise.all([
            uploadR2(`${base}-full.jpg`, buf), uploadR2(`${base}.jpg`, dBuf), uploadR2(`${base}-thumb.jpg`, tBuf),
          ]);
          let base2 = slugify(title) || `rijks-${objNum}`; slug = `art-${base2}`; let n = 1;
          while (await booksCol.findOne({ slug })) { slug = `art-${base2}-${++n}`; }
          const licenseId = (img.license || '').includes('zero') ? 'CC0-1.0' : (img.license || '').includes('publicdomain') ? 'CC0-1.0' : (img.license || 'unknown');
          await booksCol.insertOne(makeBookDoc({
            _id: bookId, id: bookId.toHexString(), slug,
            title, display_title: title, author: 'Anonymous', language: 'Visual',
            published: date, resource_type: 'object', content_type: 'artwork',
            medium: materials(obj) || null, dimensions_display: dimensions(obj) || null,
            current_location: 'Rijksmuseum, Amsterdam',
            image_full: fullUrl, image_display: dispUrl, image_thumb: thumbUrl,
            thumbnail: dispUrl, thumbnail_blob: fullUrl,
            pages_count: 0, pages_ocr: 0, pages_translated: 0,
            status: PUBLISH ? 'published' : 'imported', hidden: !PUBLISH, visible: PUBLISH,
            categories: ['Visual Art — Object'],
            collections: ['javanese-kraton', 'visual-art'],
            metadata: { object_number: objNum, place: place || null, materials: materials(obj) || null },
            image_source: {
              provider: 'rijksmuseum', provider_name: 'Rijksmuseum',
              source_url: it.id, identifier: objNum, license: licenseId,
              attribution: 'Rijksmuseum, Amsterdam (CC0)', access_date: new Date(),
            },
            source_fingerprint: fingerprint,
            created_at: new Date(), updated_at: new Date(),
          }));
          imported++;
          console.log(`  ✓ ${slug} — ${title} (${place || '?'}, ${date || '?'}) ${meta.width}x${meta.height}`);
        } catch (e) { failed++; console.log(`  ✗ ${objNum}: ${e.message}`); }
      }
      // pagination
      const nextId = page.next?.id;
      if (nextId && imported < LIMIT) { try { page = await getJson(nextId); } catch { page = null; } } else page = null;
    }
  }
  await mongo.close();
  console.log(`\n=== Summary === imported=${imported} skipped=${skipped} filtered_non_java=${filtered} failed=${failed}`);
}
main().catch(async e => { console.error('FATAL', e.stack || e.message); try { await mongo.close(); } catch {} process.exit(1); });
