#!/usr/bin/env node
/**
 * Repair artwork docs whose R2 image doesn't match their catalog record (#3815).
 *
 * Input: the mismatch list from scripts/audit/artwork-image-integrity.mjs
 * (scripts/output/artwork-image-integrity-*.json, `results[].status === 'mismatch'`).
 *
 * SAFETY
 *   - DRY-RUN by default. Nothing is written without --apply.
 *   - Every candidate is RE-VERIFIED live (fresh source lookup, not the cached
 *     audit JSON) immediately before writing — the audit may be hours old.
 *   - Never derives an R2 key from the slug. Every key this script writes is
 *     read from the DOC'S OWN existing URL fields (thumbnail, thumbnail_blob,
 *     archived_full_url, grid_thumbnail, image_display, image_thumb,
 *     image_full) and must resolve to host images.sourcelibrary.org with an
 *     `artwork/` prefix — anything else is skipped, not guessed at.
 *   - Only touches the fields this doc's own record already uses for images,
 *     plus image_width/image_height (and full_width/full_height if present).
 *   - Never touches visible/hidden/dedup_date/dedup_reason — those reflect a
 *     separate curatorial judgment (resolution/duplication) and are out of
 *     scope for an image-content fix. Docs that were hidden stay hidden;
 *     that's a follow-up curation decision, not this repair's job.
 *   - Writes a manifest (what would/did happen) before touching R2 or Mongo.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-artwork-images.mjs                        # dry-run, latest audit JSON
 *   node scripts/maintenance/repair-artwork-images.mjs --input scripts/output/artwork-image-integrity-2026-08-09.json
 *   node scripts/maintenance/repair-artwork-images.mjs --apply
 *   node scripts/maintenance/repair-artwork-images.mjs --apply --limit 5
 *
 * After --apply, purge the printed URL list from Cloudflare — this script
 * does not call the Cloudflare API itself (needs CLOUDFLARE_API_TOKEN/ZONE_ID,
 * kept as a separate deliberate step per repo convention).
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { detectProvider, fetchSourceFor, fetchImageBuffer } from '../lib/artwork-sources.mjs';
import { computeDHash } from '../lib/dhash.mjs';
import { hammingHex, HASH_MATCH } from '../lib/page-alignment.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = parseInt((args[args.indexOf('--limit') + 1]) || '0', 10) || Infinity;
const INPUT = args[args.indexOf('--input') + 1] || null;

const R2_HOST = 'images.sourcelibrary.org';
const IMAGE_FIELDS = ['thumbnail', 'thumbnail_blob', 'archived_full_url', 'grid_thumbnail', 'image_display', 'image_thumb', 'image_full'];

function latestAuditFile() {
  const dir = 'scripts/output';
  const files = fs.readdirSync(dir).filter(f => /^artwork-image-integrity-.*\.json$/.test(f));
  if (!files.length) throw new Error('No scripts/output/artwork-image-integrity-*.json found — run the audit first.');
  files.sort();
  return path.join(dir, files[files.length - 1]);
}

/** Extract an R2 key from a doc's own URL field. Returns null if it doesn't
 *  look like our own artwork bucket — repair NEVER guesses a key. */
function ownKey(url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== R2_HOST) return null;
  const key = u.pathname.replace(/^\//, '');
  if (!key.startsWith('artwork/')) return null;
  return key;
}

function r2ThumbUrl(doc) {
  return doc.thumbnail_blob || doc.image_thumb || doc.thumbnail || null;
}

/** Which rendered tier a key belongs to, by its own suffix — not by slug. */
function tierOf(key) {
  if (key.endsWith('-thumb.jpg')) return 'thumb';
  if (key.endsWith('-grid.jpg')) return 'grid';
  if (key.endsWith('-full.jpg')) return 'full';
  return 'display';
}

async function main() {
  const inputPath = INPUT || latestAuditFile();
  console.log(`Reading mismatches from ${inputPath}`);
  const audit = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const mismatches = audit.results.filter(r => r.status === 'mismatch');
  console.log(`${mismatches.length} candidate mismatch(es) in audit report`);

  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');
  const books = db.collection('books');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const manifest = { generated_at: new Date().toISOString(), apply: APPLY, input: inputPath, repaired: [], skipped: [] };
  const purgeUrls = [];

  let n = 0;
  for (const m of mismatches) {
    if (n >= LIMIT) break;
    n++;
    const doc = await books.findOne({ id: m.id }, { projection: {
      _id: 1, id: 1, slug: 1, title: 1, resource_type: 1, source_url: 1, commons_url: 1,
      commons_title: 1, source_ids: 1, dedup_date: 1, visible: 1, hidden: 1,
      image_width: 1, image_height: 1, full_width: 1, full_height: 1,
      ...Object.fromEntries(IMAGE_FIELDS.map(f => [f, 1])),
    } });
    if (!doc) { manifest.skipped.push({ id: m.id, reason: 'doc no longer exists' }); continue; }
    if (!doc.resource_type) { manifest.skipped.push({ id: m.id, reason: 'no longer resource_type (no longer an artwork)' }); continue; }

    // Re-verify LIVE — the audit JSON may be stale.
    const provider = detectProvider(doc);
    if (!provider) { manifest.skipped.push({ id: m.id, slug: doc.slug, reason: 're-check: no provider detected now' }); continue; }
    const src = await fetchSourceFor(provider, doc);
    if (!src.ok) { manifest.skipped.push({ id: m.id, slug: doc.slug, reason: `re-check: source fetch failed: ${src.error}` }); continue; }
    if (provider === 'cleveland' && !src.accessionMismatch) {
      // Accession agrees now (either it always did — this doc was flagged via
      // the dHash spot-check, not the accession bug — or a prior repair run
      // already fixed source_url). Either way, don't skip blind: re-verify
      // with the same dHash check the audit used before trusting "fixed".
      const thumbUrl = r2ThumbUrl(doc);
      const [srcBuf, r2Buf] = thumbUrl ? await Promise.all([fetchImageBuffer(src.imageUrl), fetchImageBuffer(thumbUrl)]) : [null, null];
      if (srcBuf && r2Buf) {
        const [srcHash, r2Hash] = await Promise.all([computeDHash(srcBuf), computeDHash(r2Buf)]);
        const dist = hammingHex(srcHash, r2Hash);
        if (dist <= HASH_MATCH) {
          manifest.skipped.push({ id: m.id, slug: doc.slug, reason: `re-check: accession agrees AND dHash distance ${dist} (already correct)` });
          continue;
        }
        console.log(`\n${doc.id} "${(doc.title || '').slice(0, 60)}" [${provider}] — accession agrees but dHash distance ${dist}, image itself still wrong`);
      } else {
        manifest.skipped.push({ id: m.id, slug: doc.slug, reason: 're-check: accession agrees but could not dHash-verify (fetch failed) — not auto-repairing without confirmation' });
        continue;
      }
    }

    const correctUrl = src.fullImageUrl || src.imageUrl;
    console.log(`\n${doc.id} "${(doc.title || '').slice(0, 60)}" [${provider}]`);
    console.log(`  correct source image: ${correctUrl}`);

    // Which of the doc's own keys are ours to write?
    const keysByTier = { display: new Set(), thumb: new Set(), grid: new Set(), full: new Set() };
    for (const field of IMAGE_FIELDS) {
      const key = ownKey(doc[field]);
      if (key) keysByTier[tierOf(key)].add(key);
    }
    const totalKeys = Object.values(keysByTier).reduce((s, set) => s + set.size, 0);
    if (totalKeys === 0) {
      manifest.skipped.push({ id: m.id, slug: doc.slug, reason: 'no image field resolves to our own images.sourcelibrary.org/artwork/ key' });
      continue;
    }

    if (!APPLY) {
      console.log(`  [DRY-RUN] would overwrite: ${[...keysByTier.display, ...keysByTier.thumb, ...keysByTier.grid, ...keysByTier.full].join(', ')}`);
      manifest.repaired.push({ id: doc.id, slug: doc.slug, title: doc.title, provider, correctUrl, keys: Object.fromEntries(Object.entries(keysByTier).map(([t, s]) => [t, [...s]])), applied: false });
      continue;
    }

    const buf = await fetchImageBuffer(correctUrl, 60000);
    if (!buf) { manifest.skipped.push({ id: m.id, slug: doc.slug, reason: `could not download correct image from ${correctUrl}` }); continue; }
    let meta;
    try { meta = await sharp(buf).metadata(); } catch (e) { manifest.skipped.push({ id: m.id, slug: doc.slug, reason: `sharp could not read downloaded image: ${e.message}` }); continue; }

    const renders = {};
    if (keysByTier.display.size) renders.display = await sharp(buf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (keysByTier.thumb.size) renders.thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    if (keysByTier.full.size) renders.full = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    if (keysByTier.grid.size) {
      const side = Math.min(meta.width, meta.height);
      const left = Math.round((meta.width - side) / 2);
      const top = Math.round((meta.height - side) / 2);
      renders.grid = await sharp(buf).extract({ left, top, width: side, height: side }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    }

    const written = [];
    for (const [tier, keys] of Object.entries(keysByTier)) {
      if (!keys.size) continue;
      for (const key of keys) {
        await s3.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: renders[tier],
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        written.push(key);
        purgeUrls.push(`https://${R2_HOST}/${key}`);
      }
    }
    console.log(`  wrote ${written.length} R2 object(s): ${written.join(', ')}`);

    const setFields = {
      image_width: meta.width, image_height: meta.height,
      image_repaired_at: new Date(), image_repair_source: correctUrl, image_repair_issue: '#3815',
      updated_at: new Date(),
    };
    if (doc.full_width !== undefined) setFields.full_width = meta.width;
    if (doc.full_height !== undefined) setFields.full_height = meta.height;
    // Cleveland's root cause is a wrong accession in source_url itself (see
    // file header) — fix the field that caused the bug, not just its output,
    // so a future re-run of this same detector doesn't flag it again.
    if (provider === 'cleveland' && src.sourceAccession && src.accessionMismatch) {
      setFields.source_url = `https://www.clevelandart.org/art/${src.sourceAccession}`;
    }
    await books.updateOne({ _id: doc._id }, { $set: setFields });
    console.log(`  updated doc: image_width=${meta.width} image_height=${meta.height}${setFields.source_url ? `, source_url -> ${setFields.source_url}` : ''}`);

    manifest.repaired.push({ id: doc.id, slug: doc.slug, title: doc.title, provider, correctUrl, keysWritten: written, applied: true });
  }

  const manifestPath = `scripts/output/artwork-image-repair-manifest-${new Date().toISOString().slice(0, 10)}.json`;
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`${APPLY ? 'Repaired' : 'Would repair'}: ${manifest.repaired.length}`);
  console.log(`Skipped: ${manifest.skipped.length}`);
  if (manifest.skipped.length) {
    for (const s of manifest.skipped) console.log(`  SKIP ${s.id} ${s.slug || ''}: ${s.reason}`);
  }
  console.log(`Manifest → ${manifestPath}`);
  if (APPLY && purgeUrls.length) {
    console.log(`\n${purgeUrls.length} URL(s) need a Cloudflare purge (batches of <=30):`);
    for (const u of purgeUrls) console.log(`  ${u}`);
  }

  await mc.close();
}

main().catch(e => { console.error(e); process.exit(1); });
