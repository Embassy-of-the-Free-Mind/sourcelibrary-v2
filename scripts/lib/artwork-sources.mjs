/**
 * Authoritative-source lookups for artwork docs (#3815).
 *
 * Used by scripts/audit/artwork-image-integrity.mjs (detection) and
 * scripts/maintenance/repair-artwork-images.mjs (repair). Each fetch*Source
 * function returns the museum/Commons API's OWN account of what image
 * belongs to a given doc — never derived from our own slug or R2 keys.
 *
 * Provider coverage (2026-08-10): Cleveland, Met, AIC, true Wikimedia
 * Commons file pages, Rijksmuseum, and NGA.
 *
 * Rijksmuseum (#3838 item 2): the old www.rijksmuseum.nl/api is 410 Gone,
 * but the Linked Art stack on data.rijksmuseum.nl resolves WITHOUT a key:
 * objectNumber search → HumanMadeObject → shows[0] VisualItem →
 * digitally_shown_by[0] DigitalObject → IIIF access point (iiif.micr.io,
 * arbitrary sizes). Four requests per doc — sample, don't sweep blindly.
 *
 * NGA (#3838 item 3): no live API. fetchNgaSource needs the opendata
 * published_images.csv preloaded into a Map (see loadNgaImagesCsv) —
 * callers without it get `unverifiable`, never a guess.
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
  if (doc.source_ids?.rijksmuseum) return 'rijksmuseum';
  if (doc.source_ids?.nga) return 'nga';
  if (doc.source_ids?.commons) return 'commons';
  const link = sourceLink(doc);
  if (!link) return null;
  let host;
  try { host = new URL(link).hostname; } catch { return null; }
  if (/clevelandart\.org$/i.test(host)) return 'cleveland';
  if (/metmuseum\.org$/i.test(host)) return 'met';
  if (/artic\.edu$/i.test(host)) return 'aic';
  if (/commons\.wikimedia\.org$/i.test(host)) return 'commons';
  if (/rijksmuseum\.nl$/i.test(host)) return 'rijksmuseum';
  if (/nga\.gov$/i.test(host)) return 'nga'; // verifiable only with the opendata CSV — see header
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
  // source_ids.commons is the canonical post-redirect title written by the
  // #3838 backfill — prefer it when present.
  if (doc.source_ids?.commons && /^File:/i.test(doc.source_ids.commons)) fileTitle = doc.source_ids.commons;
  if (!fileTitle && doc.commons_title && /^File:/i.test(doc.commons_title)) fileTitle = doc.commons_title;
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

/**
 * Rijksmuseum via the keyless Linked Art chain (#3838 item 2). `source_ids.
 * rijksmuseum` is the museum's own object number (e.g. RP-P-OB-1482).
 * Cross-checks that the resolved record's Identifier equals the requested
 * object number before trusting its image.
 */
export async function fetchRijksmuseumSource(doc) {
  const objnum = doc.source_ids?.rijksmuseum;
  if (!objnum) return { ok: false, error: 'no source_ids.rijksmuseum' };
  const ld = { 'Accept': 'application/ld+json' };
  const search = await getJson(`https://data.rijksmuseum.nl/search/collection?objectNumber=${encodeURIComponent(objnum)}`);
  if (!search.ok) return search;
  const objId = search.json.orderedItems?.[0]?.id;
  if (!objId) return { ok: false, error: `object number ${objnum} not found in Linked Art search` };

  const getLd = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...ld }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return res.json();
  };
  const obj = await getLd(objId);
  if (!obj) return { ok: false, error: `could not dereference ${objId}` };
  const identifiers = (obj.identified_by || []).filter(i => i.type === 'Identifier').map(i => i.content);
  if (identifiers.length && !identifiers.includes(objnum)) {
    return { ok: false, error: `resolved record identifies as ${identifiers.join('/')}, not ${objnum}` };
  }
  const title = (obj.identified_by || []).find(i => i.type === 'Name')?.content || null;
  const visualId = (obj.shows || [])[0]?.id;
  if (!visualId) return { ok: false, error: 'no VisualItem on object' };
  const visual = await getLd(visualId);
  const digitalId = (visual?.digitally_shown_by || [])[0]?.id;
  if (!digitalId) return { ok: false, error: 'no DigitalObject on VisualItem' };
  const digital = await getLd(digitalId);
  const fullImageUrl = (digital?.access_point || [])[0]?.id;
  if (!fullImageUrl) return { ok: false, error: 'no access_point on DigitalObject' };
  // micr.io serves IIIF Image API paths — swap /full/max/ for a cheap 800px rendition.
  const imageUrl = fullImageUrl.replace('/full/max/', '/full/800,/');
  return { ok: true, title, imageUrl, fullImageUrl };
}

/**
 * NGA has no live API — the caller must preload the opendata
 * published_images.csv (objectid → iiif thumb/full URLs) and pass the Map.
 */
export function loadNgaImagesCsvSync(path, fsMod) {
  // RFC-4180 scan — assistivetext fields contain quoted commas AND newlines,
  // so a line/comma split silently misaligns every row after the first one.
  const text = fsMod.readFileSync(path, 'utf8');
  const rows = [];
  let fields = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else if (ch === '\n') { fields.push(cur.replace(/\r$/, '')); rows.push(fields); fields = []; cur = ''; }
    else cur += ch;
  }
  if (cur || fields.length) { fields.push(cur); rows.push(fields); }
  const header = rows[0];
  const iOid = header.indexOf('depictstmsobjectid');
  const iIiif = header.indexOf('iiifurl');
  const iThumb = header.indexOf('iiifthumburl');
  const iSeq = header.indexOf('sequence');
  const map = new Map();
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    const oid = f[iOid];
    if (!oid) continue;
    if (map.has(oid) && f[iSeq] !== '0') continue; // prefer the primary image
    map.set(oid, { iiifurl: f[iIiif], thumb: f[iThumb] });
  }
  return map;
}

export async function fetchNgaSource(doc, ctx = {}) {
  const id = doc.source_ids?.nga;
  if (!id) return { ok: false, error: 'no source_ids.nga' };
  const img = ctx.ngaImages?.get(String(id));
  if (!ctx.ngaImages) return { ok: false, error: 'nga images csv not loaded (pass ctx.ngaImages)' };
  if (!img?.iiifurl) return { ok: false, error: `no published image for NGA object ${id}` };
  return {
    ok: true,
    imageUrl: img.thumb || `${img.iiifurl}/full/!800,800/0/default.jpg`,
    fullImageUrl: `${img.iiifurl}/full/max/0/default.jpg`,
  };
}

export async function fetchSourceFor(provider, doc, ctx = {}) {
  switch (provider) {
    case 'cleveland': return fetchClevelandSource(doc);
    case 'met': return fetchMetSource(doc);
    case 'aic': return fetchAicSource(doc);
    case 'commons': return fetchCommonsSource(doc);
    case 'rijksmuseum': return fetchRijksmuseumSource(doc);
    case 'nga': return fetchNgaSource(doc, ctx);
    default: return { ok: false, error: `provider '${provider}' not integrated (see file header)` };
  }
}

export async function fetchImageBuffer(url, timeoutMs = 30000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
