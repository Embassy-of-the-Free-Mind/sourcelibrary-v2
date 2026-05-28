/**
 * Perceptual image hashing (dhash) — node-side mirror of src/lib/dhash.ts.
 *
 * Keep this in sync with the TS module. Used by:
 *   - scripts/maintenance/backfill-gallery-dhash.mjs (one-time backfill)
 *   - scripts/workers/generate-thumbnails.mjs (compute at write time)
 *
 * dhash = difference hash: resize to 9×8 grayscale, compare adjacent pixels.
 * Produces a 64-bit hash, returned as 16-char hex. Images with hamming
 * distance < 5 are visually identical.
 */

import sharp from 'sharp';

const ZERO = BigInt(0);
const ONE = BigInt(1);

export async function computeDHash(imageBuffer) {
  const pixels = await sharp(imageBuffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();

  let hash = ZERO;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      if (left > right) {
        hash |= ONE << BigInt(y * 8 + x);
      }
    }
  }
  return hash.toString(16).padStart(16, '0');
}
