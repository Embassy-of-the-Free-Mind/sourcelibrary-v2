/**
 * Page image/text alignment check (perceptual hash).
 *
 * Answers one question about a book: does the archived page image at index N
 * actually show the same leaf as the page's own source URL, or is the archived
 * sequence offset by a page?
 *
 * Two independent defects have produced that offset:
 *   - #3186/#3357 — e-rara imports whose PDF source has a cover sheet prepended,
 *     making photo_original a one-page-offset parallel sequence. The full-res
 *     re-archive sweep overwrote archived_photo from photo_original and slid
 *     every image one page against its OCR.
 *   - #3368 — scripts/workers/archive-bulk.mjs indexes the IA *_jp2.zip with the
 *     IIIF leaf number from /page/nN, assuming zip ordinal == leaf number. For
 *     items where those differ, every page was archived its neighbour's scan.
 *
 * Verdicts (from the sampled majority):
 *   aligned   — source[N] ≈ archived[N]                → sequences agree
 *   shift+1   — source[N] ≈ archived[N+1]              → archived runs one leaf behind
 *   ambiguous — neither holds consistently             → needs manual review
 *   unknown   — too few usable pages / all fetches failed
 *
 * Measured Hamming separation on real data: same image ≤12, different ≥16.
 *
 * NOTE: a shift+1 verdict does NOT by itself mean readers see a misaligned page.
 * That depends on which image the OCR was transcribed from — see
 * readerVisibleShift() below.
 */

import { computeDHash } from './dhash.mjs';

export const HASH_MATCH = 12; // ≤ this Hamming distance = same image
export const HASH_DIFF = 16;  // ≥ this = clearly different image

/** dHash a raw image buffer, returned as the 16-char hex of scripts/lib/dhash.mjs. */
export async function hashBuffer(buffer) {
  return computeDHash(buffer);
}

/** Hamming distance between two 16-char hex dHashes. */
export function hammingHex(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** An archived_photo we can actually fetch (not a failure sentinel). */
export function isUsableArchive(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url) && !/archive[_-]?fail|unavailable/i.test(url);
}

/**
 * Compare each sampled page's source image against the archived image at the
 * same index and at the next index.
 *
 * @param {Array} pages           page docs, ascending by page_number
 * @param {object} opts
 * @param {(url:string)=>Promise<string>} opts.hashUrl        fetch + dHash a URL -> hex
 * @param {(page:object)=>string}         opts.sourceUrlFor   URL to hash for the source side
 * @param {(page:object)=>boolean}        opts.isUsableSource can this page's source be mapped to a leaf?
 * @param {number}                        [opts.samples=3]    interior pages to sample
 * @returns {Promise<{verdict:string, offset?:number, detail:string}>}
 */
export async function checkAlignment(pages, { hashUrl, sourceUrlFor, isUsableSource, samples = 3 }) {
  // Sample interior pages carrying both a usable source and a usable archive.
  // Skip page 1 — cover/title special-casing lives there and is legitimately
  // inserted or dropped by some providers.
  const usable = pages.filter(p =>
    isUsableSource(p) && isUsableArchive(p.archived_photo) && p.page_number >= 2);
  if (usable.length < 2) return { verdict: 'unknown', detail: 'too-few-usable-pages' };

  const byNum = new Map(pages.map(p => [p.page_number, p]));
  const picks = [];
  for (let i = 1; i <= samples; i++) {
    const p = usable[Math.floor(usable.length * (i / (samples + 1)))];
    if (p && !picks.includes(p)) picks.push(p);
  }

  let alignedVotes = 0, shiftVotes = 0, checked = 0;
  for (const p of picks) {
    try {
      const oh = await hashUrl(sourceUrlFor(p));
      const same = byNum.get(p.page_number)?.archived_photo;
      const next = byNum.get(p.page_number + 1)?.archived_photo;
      const dSame = isUsableArchive(same) ? hammingHex(oh, await hashUrl(same)) : 99;
      const dNext = isUsableArchive(next) ? hammingHex(oh, await hashUrl(next)) : 99;
      checked++;
      if (dSame <= HASH_MATCH && dSame < dNext) alignedVotes++;
      else if (dNext <= HASH_MATCH && dNext < dSame) shiftVotes++;
    } catch { /* count as no-vote */ }
  }

  if (checked === 0) return { verdict: 'unknown', detail: 'all-hash-fetches-failed' };
  if (alignedVotes === checked) return { verdict: 'aligned', detail: `${alignedVotes}/${checked}` };
  if (shiftVotes === checked) return { verdict: 'shift+1', offset: 1, detail: `${shiftVotes}/${checked}` };
  return { verdict: 'ambiguous', detail: `aligned=${alignedVotes} shift=${shiftVotes} of ${checked}` };
}

/**
 * Given a shift+1 book, decide whether READERS actually see a misaligned page.
 *
 * A shifted archive is necessary but not sufficient. What matters is which image
 * the OCR was transcribed from:
 *
 *   OCR ran BEFORE archival → OCR read the source URL (correct leaf) while the
 *                             reader is shown the archived image (shifted leaf)
 *                             → text and image disagree. VISIBLE DEFECT.
 *   OCR ran AFTER archival  → OCR read the archived image too, so text and image
 *                             agree with each other. Not reader-visible (the
 *                             stored source pointer is still wrong, which matters
 *                             for citation/IIIF URLs but not for reading).
 *
 * Verified on real data: Pseudodoxia (#3368) and The Federalist OCR'd before
 * archival and are visibly broken; Historia de Yucatán hashes as shift+1 but its
 * image and OCR both read printed 333 — no reader-visible defect.
 *
 * @returns {{visible:number, consistent:number, unknown:number}} page counts
 */
export function readerVisibleShift(pages) {
  let visible = 0, consistent = 0, unknown = 0;
  for (const p of pages) {
    const ocrAt = p.ocr?.updated_at || p.ocr?.created_at;
    const archAt = p.archive_metadata?.archived_at;
    if (!ocrAt || !archAt) { unknown++; continue; }
    if (new Date(ocrAt) < new Date(archAt)) visible++;
    else consistent++;
  }
  return { visible, consistent, unknown };
}
