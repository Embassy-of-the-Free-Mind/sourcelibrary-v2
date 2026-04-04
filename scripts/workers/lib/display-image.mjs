/**
 * Shared utility: generate display (1200px) and thumbnail (150px) variants
 * from a full-res image buffer, with provenance marks baked into the display version.
 *
 * Used by all 3 archive workers (archive-ocr, archive-bulk, archive-erara).
 */

import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

/**
 * Generate display and thumbnail variants from a full-res buffer.
 *
 * @param {Buffer} fullResBuffer - The full-resolution JPEG buffer
 * @returns {{ display: Buffer, thumb: Buffer }} - The generated variants
 */
export async function generateDisplayVariants(fullResBuffer) {
  // Display: 1200px wide, provenance marks on ~10% of pages (random)
  const displayResized = await sharp(fullResBuffer)
    .resize(DISPLAY_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: DISPLAY_QUALITY, progressive: true })
    .toBuffer();

  const display = Math.random() < 0.1
    ? await applyProvenanceMarks(displayResized)
    : displayResized;

  // Thumbnail: 150px wide, no provenance marks (too small)
  const thumb = await sharp(fullResBuffer)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();

  return { display, thumb };
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

  // Upload full-res (to the existing archived/ path for backward compat)
  const archivedKey = `archived/${bookId}/${pageNumber}.jpg`;
  const archivedUrl = await uploadFn(archivedKey, fullResBuffer, 'image/jpeg');

  // Generate variants
  const { display, thumb } = await generateDisplayVariants(fullResBuffer);

  // Upload display (1200px with provenance)
  const displayKey = `pages/${bookId}/${num}.jpg`;
  const displayUrl = await uploadFn(displayKey, display, 'image/jpeg');

  // Upload thumbnail (150px)
  const thumbKey = `pages/${bookId}/${num}-thumb.jpg`;
  const thumbUrl = await uploadFn(thumbKey, thumb, 'image/jpeg');

  return { archived: archivedUrl, display: displayUrl, thumb: thumbUrl };
}
