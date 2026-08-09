/**
 * Authoritative-source lookups for artwork docs (#3815).
 *
 * Used by scripts/audit/artwork-image-integrity.mjs (detection) and
 * scripts/maintenance/repair-artwork-images.mjs (repair). Each fetch*Source
 * function returns the museum/Commons API's OWN account of what image
 * belongs to a given doc — never derived from our own slug or R2 keys.
 *
 * Provider coverage (2026-08-09): Cleveland, Met, AIC, and true Wikimedia
 * Commons file pages are supported. Rijksmuseum's public collection API
 * returns 410 Gone (deprecated, no working replacement found in a quick
 * check) and NGA's open data is a static CSV dump, not a live API — both
 * are reported as `unverifiable` rather than guessed at. ~1,892 Rijksmuseum
 * + ~590 NGA artwork docs are therefore NOT covered by this integrity check;
 * a follow-up would need a Rijksmuseum API key (dead endpoint otherwise) or
 * NGA's bulk opendata CSVs.
 */

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org) bot';

// One string, both fields: the Cleveland/Met/AIC importer wrote its source
// link into `source_url`; a separate, older importer generation (or a
// Commons-native record) uses `commons_url` for the same purpose. Neither
// field is reserved to one provider, so always check both.
export function sourceLink(doc) {
  return doc.source_url || doc.commons_url || null;
}

export function detectProvider(doc) {
  if (doc.source_ids?.cleveland) return 'cleveland';
  if (doc.source_ids?.met) return 'met';
  if (doc.source_ids?.aic) return 'aic';
  const link = sourceLink(doc);
  if (!link) return null;
  let host;
  try { host = new URL(link).hostname; } catch { return null; }
  if (/clevelandart\.org$/i.test(host)) return 'cleveland';
  if (/metmuseum\.org$/i.test(host)) return 'met';
  if (/artic\.edu$/i.test(host)) return 'aic';
  if (/commons\.wikimedia\.org$/i.test(host)) return 'commons';
  if (/rijksmuseum\.nl$/i.test(host)) return 'rijksmuseum'; // unverifiable — see header
  if (/nga\.gov$/i.test(host)) return 'nga';                // unverifiable — see header
  if (/wellcomecollection\.org$/i.test(host)) return 'wellcome'; // not yet integrated
  return null;
}

async function getJson(url, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, json: await res.json() };
}

/**
 * Cleveland Museum of Art. `source_ids.cleveland` is the CMA API's own
 * numeric object id (NOT the human accession number) — fetching it directly
 * by id is a single authoritative lookup, no search/matching involved.
 *
 * Also returns `accessionMismatch`: whether the accession number embedded in
 * this doc's `source_url` (e.g. clevelandart.org/art/1926.549) differs from
 * the accession number CMA reports for `source_ids.cleveland`. Every
 * confirmed-bad doc found in #3815 shows this mismatch — the doc's own
 * `source_url` names a DIFFERENT artwork than the id used to build the
 * title/metadata, and the image that ended up on R2 matches the wrong one.
 * This check needs no image download and is authoritative on its own.
 */
export async function fetchClevelandSource(doc) {
  const id = doc.source_ids?.cleveland;
  if (!id) return { ok: false, error: 'no source_ids.cleveland' };
  const r = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  const obj = r.json.data;
  if (!obj) return { ok: false, error: 'no data in response' };
  const link = sourceLink(doc) || '';
  const urlAccession = link.match(/\/art\/([^/?#]+)/)?.[1] || null;
  const sourceAccession = obj.accession_number || null;
  const imageUrl = obj.images?.web?.url || obj.images?.print?.url || null;
  const fullImageUrl = obj.images?.print?.url || obj.images?.web?.url || null;
  if (!imageUrl) return { ok: false, error: 'no image on CMA object' };
  return {
    ok: true,
    title: obj.title,
    sourceAccession,
    urlAccession,
    accessionMismatch: !!(urlAccession && sourceAccession && urlAccession !== sourceAccession),
    imageUrl,
    fullImageUrl,
  };
}

/** Metropolitan Museum of Art — objectID is a direct, unambiguous lookup. */
export async function fetchMetSource(doc) {
  const id = doc.source_ids?.met;
  if (!id) return { ok: false, error: 'no source_ids.met' };
  const r = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  const obj = r.json;
  const imageUrl = obj.primaryImageSmall || obj.primaryImage || null;
  if (!imageUrl) return { ok: false, error: 'no image on Met object' };
  return { ok: true, title: obj.title, imageUrl, fullImageUrl: obj.primaryImage || imageUrl };
}

/** Art Institute of Chicago — artwork id is a direct lookup; images served via IIIF. */
export async function fetchAicSource(doc) {
  const id = doc.source_ids?.aic;
  if (!id) return { ok: false, error: 'no source_ids.aic' };
  const r = await getJson(`https://api.artic.edu/api/v1/artworks/${encodeURIComponent(id)}?fields=id,title,image_id`);
  if (!r.ok) return r;
  const obj = r.json.data;
  if (!obj?.image_id) return { ok: false, error: 'no image_id on AIC object' };
  return {
    ok: true,
    title: obj.title,
    imageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/843,/0/default.jpg`,
    fullImageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/full/0/default.jpg`,
  };
}

/** True Wikimedia Commons file page — looked up by File: title, not by our slug. */
export async function fetchCommonsSource(doc) {
  const link = sourceLink(doc);
  let fileTitle = null;
  if (doc.commons_title && /^File:/i.test(doc.commons_title)) fileTitle = doc.commons_title;
  if (!fileTitle && link) {
    const decoded = decodeURIComponent(link);
    const m = decoded.match(/File:([^&?#]+)/i);
    if (m) fileTitle = `File:${m[1].replace(/_/g, ' ')}`;
  }
  if (!fileTitle) return { ok: false, error: 'no File: title resolvable' };
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url|size&iiurlwidth=800&format=json`;
  const r = await getJson(apiUrl);
  if (!r.ok) return r;
  const page = Object.values(r.json.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return { ok: false, error: 'file not found on Commons' };
  return { ok: true, imageUrl: info.thumburl || info.url, fullImageUrl: info.url, width: info.width, height: info.height };
}

export async function fetchSourceFor(provider, doc) {
  switch (provider) {
    case 'cleveland': return fetchClevelandSource(doc);
    case 'met': return fetchMetSource(doc);
    case 'aic': return fetchAicSource(doc);
    case 'commons': return fetchCommonsSource(doc);
    default: return { ok: false, error: `provider '${provider}' not integrated (see file header)` };
  }
}

export async function fetchImageBuffer(url, timeoutMs = 30000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
