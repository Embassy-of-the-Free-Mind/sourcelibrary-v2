#!/usr/bin/env node
/**
 * Targeted resolution upgrade for low-res Rijksmuseum artworks (~19 visible
 * under 1200px). Keyless, via the Rijks linked-art chain (same as the
 * importer): search?objectNumber → HumanMadeObject → shows → VisualItem →
 * digitally_shown_by → DigitalObject → access_point IIIF → full-res download.
 * Rehosts the artwork triplet in place and updates commons_width/height.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/upgrade-lowres-rijks-artworks.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function fetchJson(u) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  return r.json();
}

async function resolveFullRes(objectNumber) {
  const search = await fetchJson(`https://data.rijksmuseum.nl/search/collection?objectNumber=${encodeURIComponent(objectNumber)}`);
  const objUrl = search?.orderedItems?.[0]?.id;
  if (!objUrl) return null;
  await sleep(100);
  const obj = await fetchJson(objUrl);
  const shows = Array.isArray(obj?.shows) ? obj.shows : [obj?.shows].filter(Boolean);
  const viUrl = shows[0]?.id;
  if (!viUrl) return null;
  await sleep(100);
  const vi = await fetchJson(viUrl);
  const digi = Array.isArray(vi?.digitally_shown_by) ? vi.digitally_shown_by : [vi?.digitally_shown_by].filter(Boolean);
  const digUrl = digi[0]?.id;
  if (!digUrl) return null;
  await sleep(100);
  const dig = await fetchJson(digUrl);
  const ap = Array.isArray(dig?.access_point) ? dig.access_point : [dig?.access_point].filter(Boolean);
  return ap[0]?.id || null; // .../full/max/0/default.jpg
}

async function main() {
  await client.connect();
  const books = client.db('bookstore').collection('books');
  const docs = await books.find({
    content_type: 'artwork', visible: true,
    'image_source.provider': 'rijksmuseum',
    commons_width: { $lt: 1200 }, commons_height: { $lt: 1200 },
  }, { projection: { title: 1, image_display: 1, commons_width: 1, commons_height: 1, 'image_source.identifier': 1 } }).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${docs.length} Rijks artworks under 1200px`);
  let upgraded = 0, noBigger = 0, errors = 0;

  for (const d of docs) {
    const objectNumber = String(d.image_source?.identifier || '').replace(/^rijks-/, '');
    const oldMax = Math.max(d.commons_width || 0, d.commons_height || 0);
    const base = d.image_display?.match(/images\.sourcelibrary\.org\/artwork\/(.+?)(?:-full|-thumb)?\.jpg$/)?.[1];
    const label = `${d.title?.slice(0, 45)} (${oldMax}px, ${objectNumber})`;
    if (!objectNumber || !base) { errors++; console.log(`✗ ${label} — bad identifier/display`); continue; }
    try {
      const iiifUrl = await resolveFullRes(objectNumber);
      if (!iiifUrl) { errors++; console.log(`✗ ${label} — no IIIF access point`); await sleep(200); continue; }
      const imgRes = await fetch(iiifUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!imgRes.ok) { errors++; console.log(`✗ ${label} — image ${imgRes.status}`); await sleep(200); continue; }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const newMax = Math.max(meta.width || 0, meta.height || 0);
      if (newMax < oldMax * 1.3) { noBigger++; console.log(`= ${label} — serves ${newMax}px`); await sleep(200); continue; }
      if (DRY_RUN) { upgraded++; console.log(`↑ ${label} → ${meta.width}x${meta.height} [dry]`); await sleep(200); continue; }
      const display = await sharp(buf).resize({ width: 3840, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const full = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      for (const [key, body] of [[`artwork/${base}.jpg`, display], [`artwork/${base}-thumb.jpg`, thumb], [`artwork/${base}-full.jpg`, full]]) {
        await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
      }
      await books.updateOne({ _id: d._id }, {
        $set: { commons_width: meta.width, commons_height: meta.height, image_upgraded: true, image_upgraded_at: new Date(), image_upgrade_source: 'rijks_linked_art', updated_at: new Date() },
        $unset: { low_res: '' },
      });
      upgraded++;
      console.log(`↑ ${label} → ${meta.width}x${meta.height}`);
    } catch (e) { errors++; console.log(`✗ ${label} — ${e.message?.slice(0, 60)}`); }
    await sleep(200);
  }
  console.log(`\nDONE. upgraded:${upgraded} noBigger:${noBigger} errors:${errors} — purge Cloudflare after a live run.`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
