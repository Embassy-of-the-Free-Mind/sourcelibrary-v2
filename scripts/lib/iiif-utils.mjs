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
  // BL/EAP runs behind CloudFront with no observed throttling; raised from
  // default (5) to support the corpus-wide tile-stitch re-archive job
  // (~240k pages × 9 tiles = ~2.16M requests). Stays well below the rate
  // CloudFront serves for cached resources.
  'images.eap.bl.uk': 15,
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
 * @param {number} [opts.retries=3]  Retry count for transient network errors.
 * @returns {Promise<Buffer>}
 */
export async function rateLimitedFetch(url, opts = {}) {
  const {
    timeout = 30000,
    userAgent = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)',
    retries = 3,
  } = opts;

  let host;
  try { host = new URL(url).hostname; } catch { host = 'unknown'; }
  const limit = getDomainLimit(url);

  if (!_domainBuckets.has(host)) _domainBuckets.set(host, { last: 0, count: 0 });
  const bucket = _domainBuckets.get(host);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Rate-limit gate, evaluated per attempt so retries also yield to the bucket.
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
      if (!res.ok) {
        // 4xx is unlikely to recover; bail without retrying. 5xx and 429 are
        // worth retrying with backoff.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(`HTTP ${res.status}`);
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      // Abort, ECONNRESET, ETIMEDOUT, "fetch failed" — all transient, retry.
    }
    if (attempt < retries) {
      const backoff = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr || new Error('rateLimitedFetch exhausted retries');
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
    // Harvard MPS rate-limits /full/full/ much more aggressively than /full/2000,/
    // — at 1 req/s the full-res endpoint still 429s out (5 cold-start fails =
    // circuit breaker, 0 successes). The existing 2000px variant in the photo
    // field is plenty for archive. Skip the upgrade entirely.
    if (url.includes('mps.lib.harvard.edu')) {
      return url;
    }
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
    // NDL Japan returns HTTP 500 on /full/max/ (IIIF v3 syntax their server
    // doesn't honor); /full/full/ returns the native-resolution image. Many
    // imported NDL URLs use /full/max/ from a v3-style manifest crawl.
    if (url.includes('dl.ndl.go.jp') && url.includes('/full/max/')) {
      return url.replace('/full/max/', '/full/full/');
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
 * @returns {Promise<{width:number,height:number,sizes?:Array,tiles?:Array,maxArea?:number,maxWidth?:number,profileSupports?:string[],serviceBase?:string,raw?:object}|null>}
 */
export async function fetchIiifInfo(url, opts = {}) {
  if (!isIiifUrl(url)) return null;
  // /full/SIZE/ROT/QUALITY.FORMAT  →  /info.json
  const base = url.replace(/\/full\/[^\/]+\/[^\/]+\/[^\/]+$/, '');
  if (base === url) return null;
  try {
    const buf = await rateLimitedFetch(`${base}/info.json`, opts);
    const json = JSON.parse(buf.toString('utf8'));
    const profileObj = Array.isArray(json.profile) ? json.profile.find(p => typeof p === 'object') : null;
    return {
      width: json.width,
      height: json.height,
      sizes: json.sizes,
      tiles: json.tiles,
      maxArea: profileObj?.maxArea,
      maxWidth: profileObj?.maxWidth,
      maxHeight: profileObj?.maxHeight,
      profileSupports: profileObj?.supports || [],
      serviceBase: base,
      raw: json,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a single IIIF tile (region at native scale).
 *
 * Some IIIF servers (notably the British Library's EAP service) silently
 * cap any /full/ request at a per-request output size (e.g. 1200 px),
 * even when info.json advertises a much larger master. Tile requests at
 * native scale are not subject to that cap, so we reconstruct the master
 * by stitching ≤MAX_TILE-pixel chunks.
 */
async function fetchIiifTile(serviceBase, x, y, w, h, opts) {
  const url = `${serviceBase}/${x},${y},${w},${h}/${w},/0/default.jpg`;
  return rateLimitedFetch(url, opts);
}

/**
 * Fetch a IIIF image at native pixel resolution, stitching tiles when the
 * server caps single-request output below the master dimensions.
 *
 * Strategy:
 *  1. Fetch info.json to learn the true master size.
 *  2. Pick a per-request chunk size: min(1024, info.maxWidth ?? 1024, info.maxHeight ?? 1024).
 *     (1024 is the empirically-largest output that BL/EAP returns at native pixel density.)
 *  3. Tile across (cols × rows), fetch each chunk, composite with sharp.
 *
 * If the server already serves /full/full/ at native, this still works
 * (it'd be 1 tile of size = master). Callers that know native is reachable
 * can skip this and use the simpler path.
 *
 * Throws on failure of any tile fetch.
 *
 * @param {string} photoUrl   A IIIF Image API URL anywhere in the service
 *                            (used to derive the service base).
 * @param {object} [opts]
 * @param {object} [opts.info] Pre-fetched info.json (avoids a roundtrip).
 * @param {number} [opts.maxChunk=1024] Max per-request chunk dimension.
 * @param {Function} [opts.onProgress] (done, total) callback.
 * @returns {Promise<{buffer: Buffer, width: number, height: number, tiles: number}>}
 */
export async function fetchIiifNativeRes(photoUrl, opts = {}) {
  const sharp = (await import('sharp')).default;
  const info = opts.info || await fetchIiifInfo(photoUrl, opts);
  if (!info || !info.width || !info.height) {
    throw new Error('no info.json — cannot determine native dimensions');
  }
  const serviceBase = info.serviceBase || photoUrl.replace(/\/full\/[^\/]+\/[^\/]+\/[^\/]+$/, '');
  const W = info.width;
  const H = info.height;

  // Cap chunk by server-advertised maxWidth/maxHeight (some IIIF v3 servers do
  // honor sizeByConfinedWh and announce a higher cap).
  let chunk = opts.maxChunk ?? 1024;
  if (info.maxWidth) chunk = Math.min(chunk, info.maxWidth);
  if (info.maxHeight) chunk = Math.min(chunk, info.maxHeight);
  if (chunk < 256) chunk = 256;

  const cols = Math.ceil(W / chunk);
  const rows = Math.ceil(H / chunk);
  const totalTiles = cols * rows;

  // Fetch all tiles. Per-domain rate limiting in rateLimitedFetch keeps us polite.
  const composites = [];
  let done = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * chunk;
      const y = row * chunk;
      const w = Math.min(chunk, W - x);
      const h = Math.min(chunk, H - y);
      const buf = await fetchIiifTile(serviceBase, x, y, w, h, opts);
      composites.push({ input: buf, left: x, top: y });
      done++;
      if (opts.onProgress) opts.onProgress(done, totalTiles);
    }
  }

  // Composite onto a blank canvas at native dimensions.
  const stitched = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return { buffer: stitched, width: W, height: H, tiles: totalTiles };
}

/**
 * Hosts known to silently cap /full/ output below their advertised master
 * dimensions. Their info.json typically claims to support `sizeAboveFull`
 * and `sizeByWh` (a IIIF Image API 2.x compliance lie), but a request like
 * /full/3000,/ returns 1200 px regardless. The only path to native pixel
 * density on these hosts is tile requests at scaleFactor 1.
 *
 * Each entry is a substring matched against the service URL hostname.
 * Sourced from scripts/_tmp-iiif-cap-audit.mjs (audit 2026-05-26).
 */
export const SILENT_CAP_HOSTS = [
  'images.eap.bl.uk',                            // British Library / EAP — caps at 1200 px
  'image.digitalcollections.manchester.ac.uk',    // Manchester — 3.25× loss in audit
  'www.e-rara.ch',                               // e-rara — 1.67× loss
  'collecties.tudelft.nl',                       // TU Delft — 5.92× loss
  'rmda.kulib.kyoto-u.ac.jp',                    // Kyoto RMDA — 8.69× loss
  'iiif.irht.cnrs.fr',                           // IRHT — 1.81× loss
  'iiif.hab.de',                                 // HAB — 1.16× loss
];

/**
 * Decide whether `/full/full/` is sufficient for native res, or whether we
 * need to tile-stitch.
 *
 * Conservative order:
 *  1. Known-bad host → tile.
 *  2. Profile or info.json explicitly caps output below native → tile.
 *  3. Otherwise → trust /full/ (most well-behaved IIIF hosts honor it).
 */
export function shouldTileStitch(info, photoUrl) {
  if (!info?.width || !info?.height) return false;
  if (photoUrl && SILENT_CAP_HOSTS.some(h => photoUrl.includes(h))) return true;
  if (info.serviceBase && SILENT_CAP_HOSTS.some(h => info.serviceBase.includes(h))) return true;
  if (info.maxWidth && info.maxWidth < info.width) return true;
  if (info.maxHeight && info.maxHeight < info.height) return true;
  if (info.maxArea && info.maxArea < info.width * info.height) return true;
  return false;
}
