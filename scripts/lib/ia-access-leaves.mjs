/**
 * Map IA's IIIF page number (`/page/nN`) to the leaf ordinal used by the
 * `*_jp2.zip` filenames.
 *
 * These are NOT the same sequence, and assuming they were is the root cause of
 * #3368. An IA item's scandata marks some leaves `addToAccessFormats=false`
 * (scanner calibration targets — "Color Card", "White Card" — and leaves marked
 * "Delete"). Those leaves:
 *
 *   - ARE present in the raw `*_jp2.zip` (one file per physical leaf), but
 *   - are EXCLUDED from the access derivatives, so IIIF `/page/nN` skips them.
 *
 * A book whose leaf 0 is a Color Card therefore has IIIF n0 == zip leaf 1, and
 * indexing the zip listing with the IIIF number returns the previous page for
 * every page in the book. Verified on b30324828 (Pseudodoxia): 362 leaves,
 * leaf 0 `Color Card` / `addToAccessFormats=false`, every archived image one
 * leaf behind its OCR.
 *
 * Exclusions at the tail (very common — cards are shot at both ends) are
 * harmless; only exclusions BEFORE a given page shift it.
 *
 * Returns an array `accessLeaves` where `accessLeaves[iiifN]` is the zip leaf
 * ordinal, or null when the item exposes no parseable scandata (older items,
 * and items that ship `scandata.zip`). Callers must treat null as "unknown
 * mapping" and fall back to verification rather than assuming identity.
 */

const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org)';

function isExcluded(pageType, addToAccessFormats) {
  if (addToAccessFormats === false || addToAccessFormats === 'false') return true;
  return /delete/i.test(pageType || '');
}

/** scandata.json (Wellcome-style): { pageData: { page: { "0": {...} } } } */
function parseScandataJson(text) {
  const j = JSON.parse(text);
  const pd = j?.pageData?.page || j?.pageData;
  if (!pd || typeof pd !== 'object') return null;
  const keys = Object.keys(pd).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (!keys.length) return null;
  const access = [];
  for (const k of keys) {
    const p = pd[k];
    const leaf = Number.isFinite(Number(p?.leafNum)) ? Number(p.leafNum) : Number(k);
    if (!isExcluded(p?.pageType, p?.addToAccessFormats)) access.push(leaf);
  }
  return access;
}

/** <id>_scandata.xml: a flat sequence of <page leafNum="N">…</page> elements. */
function parseScandataXml(text) {
  const blocks = text.match(/<page\b[\s\S]*?<\/page>/g);
  if (!blocks?.length) return null;
  const access = [];
  blocks.forEach((b, i) => {
    const leaf = Number((b.match(/leafNum="(\d+)"/) || [])[1] ?? i);
    const pageType = (b.match(/<pageType>([^<]*)<\/pageType>/) || [])[1];
    const add = (b.match(/<addToAccessFormats>([^<]*)<\/addToAccessFormats>/) || [])[1];
    if (!isExcluded(pageType, add)) access.push(leaf);
  });
  return access.length ? access : null;
}

/**
 * Fetch and parse an item's scandata.
 *
 * `attempts` > 1 retries the whole lookup after `backoffMs` (doubling). A
 * transient archive.org failure is otherwise indistinguishable from an item
 * with no scandata, and sent Whish MS 147 down the positional fallback with a
 * two-leaf shift (#3368, 2026-10-21). Default 1 keeps existing callers as-is.
 * @returns {Promise<number[]|null>} accessLeaves[iiifN] -> zip leaf ordinal
 */
export async function fetchAccessLeaves(iaId, { timeoutMs = 60_000, fetchImpl = fetch, attempts = 1, backoffMs = 5_000 } = {}) {
  const candidates = [
    { url: `https://archive.org/download/${iaId}/${iaId}_scandata.xml`, parse: parseScandataXml },
    { url: `https://archive.org/download/${iaId}/scandata.json`, parse: parseScandataJson },
  ];
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    for (const { url, parse } of candidates) {
      try {
        const res = await fetchImpl(url, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;
        const parsed = parse(await res.text());
        if (parsed?.length) return parsed;
      } catch { /* try the next shape */ }
    }
  }
  return null;
}

/**
 * Without scandata the archiver can only map IIIF n -> zip file n by position,
 * which is right only when the zip holds exactly one file per IIIF leaf. Any
 * excluded leaf (Color Card, Delete) makes the counts differ, and an excluded
 * leaf before a page shifts it. The perceptual-hash check cannot be relied on
 * to catch that: on visually uniform material (palm leaves) it passed a
 * two-leaf shift as "aligned 3/3" (#3368, Whish MS 147: 162 files, 159 leaves).
 *
 * The IIIF leaf count is taken from the book's own photo URLs (max nN + 1), not
 * IA's `imagecount` metadata, which matched neither side on that item (161).
 * A book imported from a subset of leaves also reads as a mismatch: that
 * refuses a book positional mapping might have got right, which is the safe
 * direction (archive-ocr archives it per page from IIIF instead).
 *
 * @param {number} zipFileCount jp2 files extracted from the zip
 * @param {string[]} photoUrls the book's page photo URLs (any order)
 * @returns {string|null} a refusal reason, or null when positional is safe
 */
export function positionalFallbackRefusal(zipFileCount, photoUrls) {
  let maxLeaf = -1;
  for (const u of photoUrls) {
    const m = String(u || '').match(/\/page\/n(\d+)/);
    if (m) maxLeaf = Math.max(maxLeaf, parseInt(m[1], 10));
  }
  if (maxLeaf < 0) return 'positional fallback: no IIIF leaf numbers on the book\'s pages';
  const leaves = maxLeaf + 1;
  return zipFileCount === leaves ? null : `positional fallback: zip has ${zipFileCount} files for ${leaves} IIIF leaves`;
}

/**
 * Index extracted JP2 paths by the leaf ordinal in their filename
 * (`<id>_0042.jp2` -> 42), rather than by position in a sorted list. Positional
 * indexing also breaks on sparse zips, where a missing file silently shifts
 * everything after it.
 */
export function indexJp2FilesByLeaf(pageFiles) {
  const byLeaf = new Map();
  for (const f of pageFiles) {
    const m = f.match(/(\d+)\.jp2$/i);
    if (m) byLeaf.set(parseInt(m[1], 10), f);
  }
  return byLeaf;
}
