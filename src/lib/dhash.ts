/**
 * Perceptual image hashing (dhash) for duplicate detection.
 *
 * dhash = difference hash: resize to 9×8 grayscale, compare adjacent pixels.
 * Produces a 64-bit hash. Images with hamming distance < 5 are visually identical.
 *
 * Used to deduplicate gallery images (e.g., repeated woodcuts used as section dividers).
 */

import sharp from 'sharp';

const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Compute a 64-bit difference hash from an image buffer.
 * Returns a 16-character hex string (e.g., "5f2d4d4d1b9f1b6d").
 */
export async function computeDHash(imageBuffer: Buffer): Promise<string> {
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

/**
 * Population count (number of "1" bits) of a dhash hex string.
 * Used to detect low-entropy hashes — blank pages produce all-zero
 * dhashes (no intensity gradient = no bits set) and an all-zero hash
 * is hamming-distance 0 from every other all-zero hash, which would
 * collapse every blank page in a book into one dedup cluster.
 */
export function dhashPopcount(hex: string): number {
  if (!hex) return 0;
  let h = BigInt('0x' + hex);
  let count = 0;
  while (h > ZERO) {
    count += Number(h & ONE);
    h >>= ONE;
  }
  return count;
}

/**
 * A dhash is "low entropy" when its bit pattern is dominated by 0s or 1s —
 * meaning the source image has almost no intensity variation. Solid-color
 * pages (blank, all-white, all-cream, microfilm scanner inserts) hit this.
 *
 * Symmetric cutoff: popcount < minBits OR popcount > 64-minBits. The upper
 * branch catches inverted blanks (pure black pages from scanning errors)
 * that would otherwise cluster the same way.
 *
 * Refusing to dedup against low-entropy hashes preserves blank-page counts
 * and stops scanner-insert pages from collapsing across a book. False
 * negatives (rejecting a real low-contrast image) are accepted — they fall
 * through to description-prefix dedup instead.
 */
export function isLowEntropyDhash(hex: string | null | undefined, minBits = 4): boolean {
  if (!hex) return true;
  const c = dhashPopcount(hex);
  return c < minBits || c > 64 - minBits;
}

/**
 * Hamming distance between two hex dhash strings.
 * Returns number of differing bits (0 = identical, <5 = same image).
 *
 * Threshold calibration (verified against production 2026-05-27):
 *   d=0   identical buffer
 *   d=2-3 same image, resized or blurred (true duplicate)
 *   d=5   same image with mild compression artifacts (still a dup)
 *   d=10+ similar visual style but distinct content (do NOT merge — e.g.
 *         two maps from the same atlas, or two woodcuts with a shared
 *         decorative border)
 *   d=15  same image after a 5% edge crop (borderline; threshold of 5
 *         intentionally misses this so we don't false-merge distinct
 *         illustrations that share visual layout)
 *   d=20+ different content
 *
 * Don't raise the threshold past 5 without re-running the calibration —
 * the data shows d=10-15 is densely populated by distinct-but-similar
 * illustrations and a higher threshold collapses them.
 */
export function dhashDistance(a: string, b: string): number {
  const ha = BigInt('0x' + a);
  const hb = BigInt('0x' + b);
  let xor = ha ^ hb;
  let count = 0;
  while (xor > ZERO) {
    count += Number(xor & ONE);
    xor >>= ONE;
  }
  return count;
}

/**
 * Deduplicate gallery image results by dhash.
 * Groups images with same book_id and dhash distance < threshold,
 * keeps the highest gallery_quality from each group.
 */
export function deduplicateByDHash<T extends { book_id: string; dhash?: string | null; gallery_quality: number }>(
  images: T[],
  threshold = 5
): T[] {
  if (images.length === 0) return images;

  // Treat low-entropy dhashes (blank pages, scanner inserts) as "no hash" so
  // they never participate in dhash clustering — see [[isLowEntropyDhash]].
  // The downstream description-prefix dedup will still collapse them if their
  // AI descriptions also match, which is what we want when a book legitimately
  // has 10 blank pages described identically as "Blank page" — but a coarse
  // dhash collapse would over-merge across books.
  const withHash: T[] = [];
  const withoutHash: T[] = [];
  for (const img of images) {
    if (img.dhash && !isLowEntropyDhash(img.dhash)) withHash.push(img);
    else withoutHash.push(img);
  }

  // Group by book_id first (only dedup within same book)
  const byBook = new Map<string, T[]>();
  for (const img of withHash) {
    const group = byBook.get(img.book_id) || [];
    group.push(img);
    byBook.set(img.book_id, group);
  }

  const kept: T[] = [];
  for (const [, bookImages] of byBook) {
    const assigned = new Set<number>();
    for (let i = 0; i < bookImages.length; i++) {
      if (assigned.has(i)) continue;
      // This is the best in its cluster (images are pre-sorted by quality)
      kept.push(bookImages[i]);
      assigned.add(i);
      // Mark all similar images as dupes
      for (let j = i + 1; j < bookImages.length; j++) {
        if (assigned.has(j)) continue;
        if (dhashDistance(bookImages[i].dhash!, bookImages[j].dhash!) < threshold) {
          assigned.add(j);
        }
      }
    }
  }

  return [...kept, ...withoutHash];
}

/**
 * Fallback dedup for images that don't have a dhash yet. Groups within the
 * same book by a normalized description prefix — empirically, the image
 * extractor produces near-identical AI descriptions for repeats of the same
 * illustration (e.g., 10 frontispieces with prefix "A group of ethereal,
 * dancing figures, likely representing fa..."). Keeps the highest
 * gallery_quality from each group.
 *
 * Conservative on purpose: only collapses when the prefix matches exactly
 * within a single book_id. Different books, different prefixes, or any
 * image already covered by [[deduplicateByDHash]] are untouched.
 */
export function deduplicateByDescription<T extends { book_id: string; description?: string | null; dhash?: string | null; gallery_quality: number }>(
  images: T[],
  prefixLen = 50
): T[] {
  if (images.length === 0) return images;
  const seen = new Map<string, T>();
  const kept: T[] = [];
  for (const img of images) {
    // Skip dedup for likely-blank rows so we don't collapse blank-page
    // gallery entries that happen to share a generic AI description. See
    // [[isLowEntropyDhash]] — that's the dhash-side guard; this is the
    // description-side guard. Together they keep blanks distinct.
    if (img.dhash && isLowEntropyDhash(img.dhash)) { kept.push(img); continue; }
    const desc = (img.description || '').trim().toLowerCase().slice(0, prefixLen);
    if (!desc) { kept.push(img); continue; }
    const key = `${img.book_id}::${desc}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, img);
      kept.push(img);
    } else if (img.gallery_quality > prev.gallery_quality) {
      // Replace the lower-quality entry in-place
      const idx = kept.indexOf(prev);
      if (idx >= 0) kept[idx] = img;
      seen.set(key, img);
    }
  }
  return kept;
}

/**
 * Combined dedup: dhash-based clustering for images that have hashes,
 * description-based fallback for the rest. Pre-sort by `gallery_quality`
 * descending before calling so the best copy wins each cluster.
 */
export function deduplicateGalleryImages<
  T extends { book_id: string; dhash?: string | null; description?: string | null; gallery_quality: number }
>(images: T[], opts: { dhashThreshold?: number; descPrefixLen?: number } = {}): T[] {
  return deduplicateByDescription(
    deduplicateByDHash(images, opts.dhashThreshold ?? 5),
    opts.descPrefixLen ?? 50
  );
}
