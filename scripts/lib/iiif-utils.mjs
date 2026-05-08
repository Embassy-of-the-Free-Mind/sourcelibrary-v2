/**
 * Shared IIIF / image-archive helpers.
 *
 * Used by:
 *   - scripts/workers/archive-ocr.mjs
 *   - scripts/maintenance/archive-unarchived-books.ts
 *   - scripts/workers/backfill-hires-illustrations.mjs
 *   - scripts/maintenance/rearchive-iiif-fullres.mjs
 *
 * `upgradeToFullRes` was inlined in three places before this module
 * existed. Keep them in lock-step — a regression in one host's URL
 * pattern would silently degrade re-archive quality across the corpus.
 *
 * Per-host rate limits are intentionally conservative: museum and
 * library IIIF servers throttle aggressively (BNF, Bodleian, BSB),
 * and we want to be a good citizen.
 */

// ── Per-domain rate limits (requests per second) ──

export const DOMAIN_LIMITS = {
  'archive.org': 10,
  'gallica.bnf.fr': 3,
  'api.digitale-sammlungen.de': 5,
  'iiif.wellcomecollection.org': 5,
  'www.e-rara.ch': 2,
  'digi.vatlib.it': 3,
  'iiif.bodleian.ox.ac.uk': 3,
  'images.lib.cam.ac.uk': 3,
  'image.digitalcollections.manchester.ac.uk': 3,
  'images.uba.uva.nl': 3,
  'cdm21059.contentdm.oclc.org': 3,
  'dl.ndl.go.jp': 3,
};

const DEFAULT_LIMIT = 5;

const _domainBuckets = new Map();

export function getDomainLimit(url) {
  try {
    const host = new URL(url).hostname;
    return DOMAIN_LIMITS[host] ?? DEFAULT_LIMIT;
  } catch {
    return DEFAULT_LIMIT;
  }
}

/**
 * Fetch a URL respecting per-domain rate limits.
 * Returns a Buffer on success, throws on HTTP error or timeout.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000]
 * @param {string} [opts.userAgent]
 * @returns {Promise<Buffer>}
 */
export async function rateLimitedFetch(url, opts = {}) {
  const { timeout = 30000, userAgent = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)' } = opts;

  let host;
  try { host = new URL(url).hostname; } catch { host = 'unknown'; }
  const limit = getDomainLimit(url);

  if (!_domainBuckets.has(host)) _domainBuckets.set(host, { last: 0, count: 0 });
  const bucket = _domainBuckets.get(host);

  const now = Date.now();
  if (now - bucket.last > 1000) { bucket.count = 0; bucket.last = now; }
  if (bucket.count >= limit) {
    const wait = 1000 - (now - bucket.last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    bucket.count = 0;
    bucket.last = Date.now();
  }
  bucket.count++;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ── IIIF URL transforms ──

/**
 * Upgrade a IIIF image URL to request full native resolution.
 *
 * Most institutional IIIF servers honour `/full/full/` (request the
 * image at its native pixel dimensions, subject to the server's
 * `maxArea`). Some hosts have been observed to require explicit
 * variants — see the per-host branches.
 *
 * If the URL doesn't match a recognised IIIF pattern, returns the
 * original unchanged.
 */
export function upgradeToFullRes(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    if (url.includes('archive.org') && url.includes('/full/pct:')) {
      return url.replace(/\/full\/pct:\d+\//, '/full/full/');
    }
    if (url.includes('digitale-sammlungen') && url.match(/\/full\/\d+,\//)) {
      return url.replace(/\/full\/\d+,\//, '/full/full/');
    }
    if (url.includes('gallica') && url.match(/\/full\/\d+,?\d*\//)) {
      return url.replace(/\/full\/\d+,?\d*\//, '/full/full/');
    }
    if (url.includes('digi.vatlib') && url.match(/\/full\/\d+,?\d*\//)) {
      return url.replace(/\/full\/\d+,?\d*\//, '/full/full/');
    }
    if (url.match(/\/full\/(?:pct:\d+|\d+,?\d*)\/\d+\/default\./)) {
      return url.replace(/\/full\/(?:pct:\d+|\d+,?\d*)\//, '/full/full/');
    }
  } catch {}
  return url;
}

/**
 * Detect whether a URL appears to use a IIIF Image API path.
 * Used to decide whether the URL is even eligible for full-res upgrade.
 */
export function isIiifUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\/iiif\/|\/full\/(?:pct:\d+|\d+,?\d*|full|max)\//.test(url);
}

/**
 * Returns the explicit pixel cap encoded in the IIIF size segment, or
 * null if the URL requests full native resolution.
 *
 *   /full/1000,/0/default.jpg  →  1000
 *   /full/full/0/default.jpg   →  null  (no cap)
 *   /full/pct:50/0/default.jpg →  null  (percentage; treat as unsized)
 */
export function getIiifSizeCap(url) {
  if (!url) return null;
  const m = url.match(/\/full\/(\d+),(?:\d*)?\/\d+\/default\./);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Fetch a IIIF info.json for a given image URL.
 * Strips the trailing `/full/.../...jpg` segment to derive the base.
 *
 * @returns {Promise<{width:number,height:number,sizes?:Array,maxArea?:number}|null>}
 */
export async function fetchIiifInfo(url, opts = {}) {
  if (!isIiifUrl(url)) return null;
  // /full/SIZE/ROT/QUALITY.FORMAT  →  /info.json
  const base = url.replace(/\/full\/[^\/]+\/[^\/]+\/[^\/]+$/, '');
  if (base === url) return null;
  try {
    const buf = await rateLimitedFetch(`${base}/info.json`, opts);
    const json = JSON.parse(buf.toString('utf8'));
    return {
      width: json.width,
      height: json.height,
      sizes: json.sizes,
      maxArea: json.profile?.[1]?.maxArea,
    };
  } catch {
    return null;
  }
}
