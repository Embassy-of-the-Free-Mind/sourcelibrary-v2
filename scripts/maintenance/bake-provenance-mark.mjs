#!/usr/bin/env node
/**
 * Bake the Source Library provenance mark INTO the pre-sized R2 page variants
 * (`display_photo`, optionally `image_thumb`) — file-time marking.
 *
 * Why file-time, not serve-time: the `/api/image` proxy already stamps a logo
 * on the images it resizes, but the resolver in src/lib/page-image-url.ts serves
 * pre-sized R2 variants *directly* (free CF/R2 egress, no Vercel) for the bulk of
 * pages — so those bypass the proxy and ship unmarked. Marking the variant file
 * itself means the mark travels with the file: it survives direct hotlinks,
 * copy-image-address, and screenshots, with zero recurring serve cost.
 *
 * It marks the EXISTING variant via scripts/lib/provenance-mark.mjs — invisible
 * EXIF (Copyright/Source/edition id) + an invisible keyed watermark on every page
 * + a subtle visible logo on ~1-in-10 pages — and overwrites the SAME R2 key, so
 * no DB pointer changes and no churn. Idempotent: it stamps each object's R2
 * metadata with `provenance: <MARK_VERSION>` and skips anything already marked.
 * Requires PROVENANCE_SECRET_KEY (the watermark key, shared with the text imprimatur).
 *
 * The originals used for OCR / download / deep-zoom (`archived_photo`,
 * `photo_original`, `original`/`hires` tiers) are NOT touched — only the
 * display/thumb derivatives, which are regenerable from those originals, so this
 * is reversible.
 *
 * After a full --apply run, purge Cloudflare so the new bytes are served:
 *   set -a; source .env.production.local; set +a
 *   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
 *     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
 *     --data '{"purge_everything":true}'
 *
 * Requires R2 credentials + sharp (present on the Hetzner workers box).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/bake-provenance-mark.mjs --book <bookId>            # dry run, one book
 *   node scripts/maintenance/bake-provenance-mark.mjs --book <bookId> --apply    # write, one book (pilot)
 *   node scripts/maintenance/bake-provenance-mark.mjs --provider bph --apply
 *   node scripts/maintenance/bake-provenance-mark.mjs --all --apply              # whole visible corpus
 *   node scripts/maintenance/bake-provenance-mark.mjs --all --include-thumbs --apply
 */

import { MongoClient } from 'mongodb';
import {
  S3Client, GetObjectCommand, PutObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import { markImage } from '../lib/provenance-mark.mjs';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const INCLUDE_THUMBS = process.argv.includes('--include-thumbs');
const arg = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const BOOK_ID = arg('--book');
const PROVIDER = arg('--provider');
const LIMIT = parseInt(arg('--limit') || '0', 10);
const CONCURRENCY = parseInt(arg('--concurrency') || '10', 10);

// Bump this string if the mark design changes and a re-bake is wanted; objects
// tagged with the current version are skipped, so a new version re-marks all.
// sl-v1 = old always-on visible logo; sl-v2 = EXIF + invisible watermark +
// random ~1/10 visible logo (the scheme in scripts/lib/provenance-mark.mjs).
const MARK_VERSION = 'sl-v2';

const PROVENANCE_KEY = process.env.PROVENANCE_SECRET_KEY;

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      // Pool a bounded set of keep-alive connections rather than opening a new
      // socket per request — a connection storm (hundreds of fresh SYNs) trips
      // R2's per-IP connection throttling and wedges the run. Timeouts + retries
      // then ride out any residual transient blip.
      maxAttempts: 6,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 32 }),
        connectionTimeout: 8000,
        requestTimeout: 60000,
      }),
    })
  : null;

// Only files we own and can overwrite: canonical R2 page variants.
const R2_PREFIX_RE = new RegExp(`^${R2_PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)$`);
function keyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(R2_PREFIX_RE);
  if (!m) return null;
  const key = m[1].split('?')[0];
  // Page image variants only — never touch crops, covers, gallery, etc.
  return key.startsWith('pages/') ? key : null;
}

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

async function markVariant({ key, bookId, pageNumber }) {
  // Pull the existing pre-sized variant. The GET response carries the object's
  // metadata, so we check idempotency here — no extra HeadObject round trip.
  const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (obj.Metadata && obj.Metadata.provenance === MARK_VERSION) return 'already';
  const buf = await streamToBuffer(obj.Body);

  // EXIF + invisible watermark (keyed by bookId) + random ~1/10 visible logo.
  const out = await markImage(buf, { editionId: bookId, pageNumber, key: PROVENANCE_KEY });

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: out, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=604800, s-maxage=604800',
    Metadata: { provenance: MARK_VERSION },
  }));
  return 'marked';
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  if (APPLY && !r2) { console.error('R2 creds required for --apply.'); process.exit(1); }
  if (APPLY && !PROVENANCE_KEY) { console.error('PROVENANCE_SECRET_KEY required for --apply (watermark key).'); process.exit(1); }
  if (!BOOK_ID && !PROVIDER && !ALL) { console.error('Pass --book <id>, --provider <name>, or --all.'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 0 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  // Resolve scope to a set of book ids (visible only — we never mark hidden books).
  let bookIds = null, scope = '';
  if (BOOK_ID) { bookIds = [BOOK_ID]; scope = `book ${BOOK_ID}`; }
  else if (PROVIDER) {
    bookIds = await books.find({ 'image_source.provider': PROVIDER, visible: true }, { projection: { _id: 0, id: 1 } }).map(b => b.id).toArray();
    scope = `provider ${PROVIDER} (${bookIds.length} books)`;
  } else {
    bookIds = await books.find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1 } }).map(b => b.id).toArray();
    scope = `ALL visible (${bookIds.length} books)`;
  }

  const fields = ['display_photo', ...(INCLUDE_THUMBS ? ['image_thumb'] : [])];
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  scope: ${scope}  fields: ${fields.join(', ')}  mark: ${MARK_VERSION}`);

  let scanned = 0, marked = 0, skipped = 0, alreadyDone = 0, failed = 0, notR2 = 0, collided = 0;
  const t0 = Date.now();

  // Process per-book to keep the cursor bounded and progress legible.
  const BOOK_CHUNK = 500;
  for (let i = 0; i < bookIds.length; i += BOOK_CHUNK) {
    const chunk = bookIds.slice(i, i + BOOK_CHUNK);
    const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, display_photo: 1, image_thumb: 1,
      archived_photo: 1, photo_original: 1, cropped_photo: 1, photo: 1 };
    const cursor = pages.find({ book_id: { $in: chunk } }, { projection: proj });

    let queue = [];
    const flush = async () => {
      const batch = queue.splice(0, queue.length);
      await Promise.all(batch.map(async (item) => {
        try {
          if (!APPLY) { marked++; if (marked <= 10) console.log(`  would mark ${item.key}`); return; }
          const status = await markVariant(item);
          if (status === 'already') { alreadyDone++; return; }
          marked++;
          if (marked % 500 === 0) {
            const rate = (marked / ((Date.now() - t0) / 1000)).toFixed(0);
            console.log(`  …${marked} marked, ${alreadyDone} already, ${failed} failed  (${rate}/s)`);
          }
        } catch (e) { failed++; if (failed <= 15) console.warn(`  FAIL ${item.key}: ${e.message}`); }
      }));
    };

    for await (const p of cursor) {
      // Never overwrite a file that is also the page's OCR/original/zoom source.
      // A genuine display/thumb derivative is byte-distinct from these; a
      // collision means there's no separate variant and the field points at the
      // source itself — marking it would contaminate OCR/download. Skip those.
      const sourceUrls = new Set([p.archived_photo, p.photo_original, p.cropped_photo, p.photo].filter(Boolean));
      for (const f of fields) {
        const key = keyFromUrl(p[f]);
        scanned++;
        if (!p[f]) { skipped++; continue; }
        if (!key) { notR2++; continue; }
        if (sourceUrls.has(p[f])) { collided++; continue; }
        queue.push({ key, bookId: p.book_id, pageNumber: p.page_number });
        if (queue.length >= CONCURRENCY) await flush();
      }
      if (LIMIT && marked >= LIMIT && !APPLY) break;
    }
    await flush();
    if (LIMIT && marked >= LIMIT && !APPLY) break;
  }

  console.log(`\nDone. scanned=${scanned} marked=${marked} already=${alreadyDone} skipped(no field)=${skipped} non-R2=${notR2} source-collision=${collided} failed=${failed}`);
  if (APPLY && marked > 0) console.log('Now purge Cloudflare (see header) so the marked bytes are served.');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
