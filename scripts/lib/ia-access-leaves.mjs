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
 * @returns {Promise<number[]|null>} accessLeaves[iiifN] -> zip leaf ordinal
 */
export async function fetchAccessLeaves(iaId, { timeoutMs = 60_000, fetchImpl = fetch } = {}) {
  const candidates = [
    { url: `https://archive.org/download/${iaId}/${iaId}_scandata.xml`, parse: parseScandataXml },
    { url: `https://archive.org/download/${iaId}/scandata.json`, parse: parseScandataJson },
  ];
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
  return null;
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
