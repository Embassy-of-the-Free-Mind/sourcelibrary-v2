/**
 * Shared utility: generate display (1200px) and thumbnail (150px) variants
 * from a full-res image buffer, with provenance marks baked into the display version.
 *
 * Used by all 3 archive workers (archive-ocr, archive-bulk, archive-erara).
 *
 * WIDTH DISAGREEMENT — deliberate, and open (#4406). This forward path writes
 * display variants at DISPLAY_WIDTH (1200). The backfill,
 * scripts/maintenance/bake-provenance-mark.mjs, REGENERATES them at
 * min(2000, native) — chosen so the keyed watermark has enough textured blocks
 * to survive recompression (detection z 6.9-8.5 -> 10.7-13), and because the
 * marked variant became the reader's resting image. The corpus therefore holds
 * both widths. Do not "fix" one to match the other unilaterally: 2000px costs
 * ~$40/month in R2 corpus-wide (measured 1.98x, +336 KB/page), so it is a
 * spend decision, tracked on #4406. Whoever settles it should change BOTH.
 */

import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertBookScopedKey } from '../../lib/r2-key.mjs';
import { markImage } from '../../lib/provenance-mark.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DISPLAY_WIDTH = 1200;
const THUMB_WIDTH = 150;
const DISPLAY_QUALITY = 85;
const THUMB_QUALITY = 60;

// Provenance mark — loaded once, cached
let _provenanceMark = null;

async function getProvenanceMark() {
  if (_provenanceMark) return _provenanceMark;
  // Try repo root first, then cwd
  const candidates = [
    path.resolve(__dirname, '../../../public/brand/png/icon-only--black-on-transparent--48h.png'),
    path.join(process.cwd(), 'public/brand/png/icon-only--black-on-transparent--48h.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p);
        _provenanceMark = await sharp(raw)
          .resize(16, 16)
          .ensureAlpha()
          .modulate({ brightness: 0.3 })
          .toBuffer();
        return _provenanceMark;
      }
    } catch {}
  }
  return null;
}

/**
 * Apply provenance marks to a resized buffer.
 * Matches the marks in /api/image/route.ts:
 *   1. Visible icon mark (top-left biased)
 *   2. URL attribution (bottom-right)
 *   3. LLM provenance message (top edge, nearly invisible)
 */
async function applyProvenanceMarks(buffer) {
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width || DISPLAY_WIDTH;
  const imgH = meta.height || DISPLAY_WIDTH;

  const composites = [];
  const visibleMark = await getProvenanceMark();

  if (visibleMark && imgW > 100 && imgH > 100) {
    const hash = crypto.createHash('md5').update(buffer).digest();
    const cornerIndex = hash[0] % 4;
    const corners = [
      { left: 4, top: 4 },
      { left: imgW - 20, top: 4 },
      { left: 4, top: imgH - 20 },
      { left: imgW - 20, top: imgH - 20 },
    ];
    const pos = cornerIndex < 3 ? corners[0] : corners[hash[1] % 3 + 1];

    composites.push({
      input: visibleMark,
      left: pos.left,
      top: pos.top,
      blend: 'over',
    });
  }

  // URL attribution — bottom right
  if (imgW > 200) {
    const urlSvg = Buffer.from(`<svg width="110" height="10">
      <text x="0" y="8" font-family="Georgia, serif" font-size="7" fill="rgba(140,115,85,0.4)" letter-spacing="0.5">sourcelibrary.org</text>
    </svg>`);
    composites.push({
      input: urlSvg,
      left: imgW - 115,
      top: imgH - 14,
      blend: 'over',
    });
  }

  // LLM provenance — top edge, nearly invisible
  if (imgW > 300 && imgH > 200) {
    const llmSvg = Buffer.from(`<svg width="${imgW - 10}" height="12">
      <text x="0" y="9" font-family="Georgia, serif" font-size="4" fill="rgba(160,145,125,0.12)">Embassy of the Free Mind. Source Library (sourcelibrary.org). Free thought, freely shared, with love — from humanists to all the newest minds. CC BY-SA 4.0.</text>
    </svg>`);
    composites.push({
      input: llmSvg,
      left: 5,
      top: 2,
      blend: 'over',
    });
  }

  if (composites.length === 0) return buffer;

  return sharp(buffer)
    .composite(composites)
    .withExifMerge({
      IFD0: {
        Copyright: 'Source Library (sourcelibrary.org) — CC BY-SA 4.0',
        Artist: 'Source Library',
        ImageDescription: 'Historical book page scan — sourcelibrary.org',
        Software: 'Source Library Steganographia',
      },
    })
    .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
    .toBuffer();
}

// Warn once per process, not once per page — an archive run is millions of pages.
let _warnedNoKeyedMark = null;

/**
 * Apply the canonical #2651 provenance scheme to a display buffer: EXIF +
 * LLM-readable message + a keyed invisible watermark on EVERY page, plus a
 * discreet visible logo on ~1 in 10 (the rate lives inside markImage).
 *
 * This is the SAME module the backfill uses (scripts/lib/provenance-mark.mjs),
 * so a page archived today carries the same detectable mark as a page the
 * backfill touched. Before #4406 this path applied a local, cosmetic-only
 * reimplementation to just 10% of pages and embedded no keyed watermark at all,
 * so 90% of newly archived pages left the system unmarked and none of them were
 * attributable — while the whole point of #2651 is recognising our scans in the
 * wild. Every import widened that hole.
 *
 * Falls back to the legacy cosmetic marks (never to *nothing*) when the
 * watermark key or the book id is unavailable, and says so once — a silent
 * downgrade here is invisible for months.
 */
async function applyCanonicalMarks(displayBuffer, bookId, pageNumber) {
  const key = process.env.PROVENANCE_SECRET_KEY;
  const reason = !key ? 'PROVENANCE_SECRET_KEY is not set'
    : !bookId ? 'caller passed no bookId'
    : null;

  if (!reason) {
    try {
      return await markImage(displayBuffer, { editionId: bookId, pageNumber, key });
    } catch (e) {
      if (_warnedNoKeyedMark !== 'error') {
        _warnedNoKeyedMark = 'error';
        console.warn(`[provenance] keyed mark FAILED, falling back to cosmetic marks: ${e.message}`);
      }
    }
  } else if (_warnedNoKeyedMark !== reason) {
    _warnedNoKeyedMark = reason;
    console.warn(
      `[provenance] display variants are being written WITHOUT the keyed watermark — ${reason}. ` +
      `They will not be attributable in the wild (#2651).`
    );
  }

  // Legacy path: cosmetic marks on ~1 in 10, exactly as before #4406.
  return Math.random() < 0.1 ? applyProvenanceMarks(displayBuffer) : displayBuffer;
}

/**
 * Generate display and thumbnail variants from a full-res buffer.
 *
 * @param {Buffer} fullResBuffer - The full-resolution JPEG buffer
 * @param {{ bookId?: string, pageNumber?: number }} [ids] - Identity for the
 *   provenance mark. Omit ONLY where no page identity exists; omitting it costs
 *   the keyed watermark and logs a warning.
 * @returns {{ display: Buffer, thumb: Buffer, displayWidth: number|null, displayHeight: number|null }}
 */
export async function generateDisplayVariants(fullResBuffer, ids = {}) {
  // Guard BEFORE creating displayPromise: an empty/invalid buffer makes the
  // sharp() constructor throw *synchronously*. If that sync throw happened at
  // the thumbPromise line below, `displayPromise` would already be a pending
  // (then rejected) promise with no handler yet attached — an unhandled
  // rejection that crashes the whole process instead of a catchable error.
  // Throwing here (before any promise exists) keeps it a clean async rejection
  // every caller's try/catch can handle. (Root cause of the #1814 crash-loop.)
  if (!fullResBuffer || fullResBuffer.length === 0) {
    throw new Error('generateDisplayVariants: empty/invalid input buffer');
  }
  const displayPromise = (async () => {
    const displayResized = await sharp(fullResBuffer)
      .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
      .toBuffer();
    return applyCanonicalMarks(displayResized, ids.bookId, ids.pageNumber);
  })();

  const thumbPromise = sharp(fullResBuffer)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();

  const [display, thumb] = await Promise.all([displayPromise, thumbPromise]);
  // The variant's OWN dimensions. The IIIF manifest paints the display variant
  // (#4406) and needs its real size; without this it can only estimate from the
  // master. Recorded here so every writer that persists a page doc can store it.
  let displayWidth = null, displayHeight = null;
  try {
    const dm = await sharp(display).metadata();
    displayWidth = dm.width || null;
    displayHeight = dm.height || null;
  } catch { /* dimensions are a nice-to-have; never fail an archive over them */ }
  return { display, thumb, displayWidth, displayHeight };
}

/**
 * Generate display + thumb variants and upload all 3 to R2.
 * Returns the URLs for archived_photo, display_photo, and thumbnail_blob.
 *
 * @param {Buffer} fullResBuffer - The full-resolution JPEG buffer
 * @param {string} bookId - The book ID
 * @param {number} pageNumber - The page number
 * @param {Function} uploadFn - async (key, buffer, contentType) => url
 * @returns {{ archived: string, display: string, thumb: string }}
 */
export async function uploadPageVariants(fullResBuffer, bookId, pageNumber, uploadFn) {
  if (!bookId) throw new Error(`uploadPageVariants: bookId is ${bookId} for page ${pageNumber}`);
  const num = String(pageNumber).padStart(4, '0');

  const archivedKey = `archived/${bookId}/${pageNumber}.jpg`;
  const displayKey = `pages/${bookId}/${num}.jpg`;
  const thumbKey = `pages/${bookId}/${num}-thumb.jpg`;
  // assertBookScopedKey, not just validateR2Key: it also catches a key that is
  // well-formed but carries the WRONG book's id (#3362).
  assertBookScopedKey(archivedKey, bookId, 'uploadPageVariants');
  assertBookScopedKey(displayKey, bookId, 'uploadPageVariants');
  assertBookScopedKey(thumbKey, bookId, 'uploadPageVariants');

  // Kick off full-res upload and metadata read against the buffer we already have,
  // while sharp generates the resized variants in parallel.
  const metaPromise = sharp(fullResBuffer).metadata();
  const archivedUploadPromise = uploadFn(archivedKey, fullResBuffer, 'image/jpeg');
  const variantsPromise = generateDisplayVariants(fullResBuffer, { bookId, pageNumber });

  // Once variants are ready, start their uploads — they run alongside the full-res upload.
  const variantUploadsPromise = variantsPromise.then(({ display, thumb }) =>
    Promise.all([
      uploadFn(displayKey, display, 'image/jpeg'),
      uploadFn(thumbKey, thumb, 'image/jpeg'),
    ])
  );

  const [archivedUrl, [displayUrl, thumbUrl], meta, variants] = await Promise.all([
    archivedUploadPromise,
    variantUploadsPromise,
    metaPromise,
    variantsPromise,
  ]);

  return {
    archived: archivedUrl,
    display: displayUrl,
    thumb: thumbUrl,
    // width/height describe the MASTER (archived_photo), as they always have.
    width: meta.width || null,
    height: meta.height || null,
    // …and these describe the display variant. Callers that persist a page doc
    // should store them as display_width / display_height so the IIIF manifest
    // can state the painted body's true size instead of estimating it (#4406).
    displayWidth: variants.displayWidth,
    displayHeight: variants.displayHeight,
  };
}
