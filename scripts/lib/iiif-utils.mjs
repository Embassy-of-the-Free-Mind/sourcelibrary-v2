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
  // MDZ began 429-ing every archive run on 2026-08-29/30 (see #4395). The
  // nominal 5/s was never what we actually sent — the old bucket released
  // every waiter at once, so 60 in-flight callers produced 55 requests in a
  // single second. Lowered to 2/s while we re-earn their tolerance; raise
  // again only with evidence from a clean run, not by assumption.
  'api.digitale-sammlungen.de': 2,
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

// Per-host scheduling state: { nextSlot, penalty, penalizedAt }.
//   nextSlot    — epoch ms of the next unclaimed send slot for this host.
//   penalty     — divisor applied to the configured limit after a 429, so a host
//                 that tells us to slow down actually gets a slower caller.
//   penalizedAt — epoch ms of the last 429, used to decay `penalty` back toward 1.
const _domainBuckets = new Map();

const MAX_PENALTY = 16; // floor: a 2/s host lands at one request every 8s

/**
 * How long a host must go without a 429 before the penalty halves.
 *
 * #4396 gave the limiter multiplicative DECREASE and no increase: `penalty`
 * doubled on every 429 and nothing ever lowered it. Four 429s pinned a host at
 * 1/16th of its configured rate for the rest of the process, and the archiver
 * runs 50-minute batches — so one early burst crippled the whole run. Measured
 * on production 2026-09-03: gallica granted 3.27 req/s healthy and 0.29 req/s
 * after four 429s, with no recovery, while the hourly archiver logged a flat
 * 0.08 pages/s and `books 0/240`.
 *
 * Halving per quiet minute is deliberately slower than the doubling on the way
 * down: we back off fast and return slowly, which is the safe asymmetry when
 * the other party is a library that can block us outright (#4311, #4395).
 */
const PENALTY_HALFLIFE_MS = 60_000;

/**
 * Decay `penalty` toward 1 based on how long the host has been quiet.
 *
 * Called from the read path rather than on a timer so there is nothing to
 * schedule or clean up, and a host that is never touched again costs nothing.
 */
function decayPenalty(b, now) {
  if (b.penalty <= 1 || !b.penalizedAt) return;
  const halvings = Math.floor((now - b.penalizedAt) / PENALTY_HALFLIFE_MS);
  if (halvings <= 0) return;
  b.penalty = Math.max(1, b.penalty / 2 ** halvings);
  // Advance the clock by the halvings consumed, so partial progress is kept
  // instead of being re-counted on the next call.
  b.penalizedAt += halvings * PENALTY_HALFLIFE_MS;
  if (b.penalty <= 1) { b.penalty = 1; b.penalizedAt = 0; }
}

export function getDomainLimit(url) {
  try {
    const host = new URL(url).hostname;
    return DOMAIN_LIMITS[host] ?? DEFAULT_LIMIT;
  } catch {
    return DEFAULT_LIMIT;
  }
}

function bucketFor(host) {
  let b = _domainBuckets.get(host);
  if (!b) { b = { nextSlot: 0, penalty: 1, penalizedAt: 0 }; _domainBuckets.set(host, b); }
  return b;
}

/**
 * Claim one send slot for `host` and wait until it comes due.
 *
 * The previous implementation counted requests inside a one-second window and,
 * when the window was full, made every waiter sleep and then RESET the window.
 * Under concurrency that inverts the intent: N waiters all observe a full
 * window, all sleep the same interval, and all wake and fire together. Measured
 * with 60 in-flight callers against a nominal 5/s limit: 5 requests in the
 * first second, then 55 in the next — an 11x burst, which is what MDZ was
 * actually throttling (#4395).
 *
 * This version hands each caller its own slot spaced 1/limit apart. The claim
 * is synchronous — there is no `await` between reading and writing `nextSlot` —
 * so concurrent callers queue instead of colliding. Slots are real backpressure:
 * the 60th caller genuinely waits its turn rather than jumping the line.
 */
export async function claimSlot(host, limit) {
  const b = bucketFor(host);
  const now = Date.now();
  decayPenalty(b, now);
  const interval = 1000 / Math.max(limit / b.penalty, 0.05);
  const slot = Math.max(now, b.nextSlot);
  b.nextSlot = slot + interval;         // claimed synchronously — no await above
  const wait = slot - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

/**
 * Record that `host` asked us to slow down (HTTP 429) and back off for real.
 *
 * A 429 is an instruction about RATE, not a refusal of access — unlike a 401 or
 * 403, the correct response is to go slower, not to stop. Halving the effective
 * limit and pushing the next slot out by `Retry-After` (when the host supplies
 * one) means a throttled host converges on a rate it will serve instead of the
 * caller retrying into the same wall.
 */
export function noteRateLimited(url, retryAfterSeconds) {
  let host; try { host = new URL(url).hostname; } catch { return; }
  const b = bucketFor(host);
  const now = Date.now();
  // Decay first, so a host that has been quiet for minutes is penalised from
  // its recovered rate rather than from a stale worst case.
  decayPenalty(b, now);
  b.penalty = Math.min(b.penalty * 2, MAX_PENALTY);
  b.penalizedAt = now;
  const cooldown = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : 5000;
  b.nextSlot = Math.max(b.nextSlot, now + cooldown);
  return b.penalty;
}

/** Effective (post-penalty) rate for a host, for logging. */
export function effectiveLimit(url) {
  let host; try { host = new URL(url).hostname; } catch { return null; }
  const b = bucketFor(host);
  decayPenalty(b, Date.now());
  return getDomainLimit(url) / b.penalty;
}

/**
 * Test seam: age a host's penalty clock by `ms` without sleeping.
 *
 * Recovery is measured in minutes, so a test that actually waited would be a
 * test nobody runs. Exported only for the behavioural guard in
 * tests/unit/domain-rate-limiter.test.ts.
 */
export function _agePenaltyClockForTest(url, ms) {
  let host; try { host = new URL(url).hostname; } catch { return; }
  const b = bucketFor(host);
  if (b.penalizedAt) b.penalizedAt -= ms;
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

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Rate gate, evaluated per attempt so retries queue behind fresh requests
    // rather than jumping ahead of them.
    await claimSlot(host, limit);

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
        // A 429 is the host telling us our RATE is wrong. Retrying at the same
        // rate is the one response guaranteed not to work — slow this host down
        // for every subsequent caller, not just this retry.
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'));
          noteRateLimited(url, ra);
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
    // A IIIF Image path is /{region}/{size}/{rotation}/{quality}.{format}. When
    // `size` is ALREADY `full` there is nothing to upgrade — and saying so here
    // is load-bearing, because several per-host rules below match on
    // `/full/<digits>/` without anchoring to the size segment. On a URL like
    //   .../f1/full/full/0/default.jpg
    // those rules match the ROTATION (`/0/`) and rewrite it to `full`, yielding
    //   .../f1/full/full/full/default.jpg
    // which is an invalid rotation and 404s. Measured 2026-08-30: every Gallica
    // page whose stored URL was already `/full/full/0/...` was unfetchable for
    // this reason — 0 of 28 sampled books could be archived, while the STORED
    // url returned 200 the moment it was requested unmodified. MDZ escaped only
    // because its rule happens to require a comma (`/full/2000,/`).
    if (/\/full\/full\/\d+\/[a-z]+\.[a-z0-9]+$/i.test(url)) return url;
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
    // Both of these anchor on the rotation+quality suffix so the size segment is
    // the only thing they can rewrite. The early return above already prevents
    // the observed 404s; this keeps the rules correct on their own terms rather
    // than relying on a guard elsewhere in the function.
    if (url.includes('gallica') && url.match(/\/full\/\d+,?\d*\/\d+\/[a-z]+\./i)) {
      return url.replace(/\/full\/\d+,?\d*\/(\d+\/[a-z]+\.)/i, '/full/full/$1');
    }
    if (url.includes('digi.vatlib') && url.match(/\/full\/\d+,?\d*\/\d+\/[a-z]+\./i)) {
      return url.replace(/\/full\/\d+,?\d*\/(\d+\/[a-z]+\.)/i, '/full/full/$1');
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
 * Does a returned tile actually fill the cell it was requested for?
 *
 * A `false` here means the server downscaled the region behind our back, and
 * compositing it would leave canvas showing through. ±1px because IIIF servers
 * round a scaled region's height differently; anything larger is a real cap.
 *
 * Split out from the stitch loop so the invariant is testable without a network
 * (#4523 — the failure it guards is silent everywhere downstream).
 */
export function tileFits(reqW, reqH, gotW, gotH) {
  if (!gotW || !gotH) return false;
  return Math.abs(gotW - reqW) <= 1 && Math.abs(gotH - reqH) <= 1;
}

/**
 * Fetch a IIIF image at native pixel resolution, stitching tiles when the
 * server caps single-request output below the master dimensions.
 *
 * Strategy:
 *  1. Fetch info.json to learn the true master size.
 *  2. Pick a per-request chunk size: min(1024, info.maxWidth ?? 1024, info.maxHeight ?? 1024).
 *     (1024 is the empirically-largest output that BL/EAP returns at native pixel density.)
 *  3. PROBE one chunk and shrink the stride to whatever the server actually
 *     served — the advertised cap is a hint, and on SILENT_CAP_HOSTS a lie.
 *  4. Tile across (cols × rows), fetch each chunk, verify its dimensions,
 *     composite with sharp.
 *
 * If the server already serves /full/full/ at native, this still works
 * (it'd be 1 tile of size = master). Callers that know native is reachable
 * can skip this and use the simpler path.
 *
 * Throws on failure of any tile fetch, and on any tile whose returned size
 * does not match the region requested.
 *
 * WHY THE SIZE CHECK (#4523): the canvas is painted white and `composite`
 * places a short tile at the cell's top-left, so a silently-downscaled tile
 * leaves a white gutter instead of an error. `rearchive-iiif-fullres.mjs`
 * passed `maxChunk` from EAP's *advertised* 2000px while EAP serves 1200,
 * giving a 0.6 linear / 0.36 area coverage — masters that are 64% white.
 * ~30% of OCR-bearing Tibetan pages were archived that way in July 2026 and
 * the OCR model read them as complete pages and invented the missing text.
 * A gap in a page image has no downstream detector; it must fail here.
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
  //
  // The advertised cap is a HINT, never a contract — this whole function exists
  // because SILENT_CAP_HOSTS lie about it. The probe below is what actually
  // decides the stride. See #4523 / assertTileFits.
  let chunk = opts.maxChunk ?? 1024;
  if (info.maxWidth) chunk = Math.min(chunk, info.maxWidth);
  if (info.maxHeight) chunk = Math.min(chunk, info.maxHeight);
  if (chunk < 256) chunk = 256;

  // PROBE: ask for one full-size chunk and see what actually comes back. A host
  // that silently downscales returns a SMALLER image for the same region; if we
  // then step the grid by the requested size, every tile lands at 60% scale in
  // the top-left of its cell and the rest of the cell stays canvas-white. That
  // is exactly how ~89k Tibetan pages were archived two-thirds blank (#4523).
  if (W > chunk || H > chunk) {
    const probeW = Math.min(chunk, W);
    const probeH = Math.min(chunk, H);
    const probe = await fetchIiifTile(serviceBase, 0, 0, probeW, probeH, opts);
    const meta = await sharp(probe).metadata();
    if (meta.width && meta.width < probeW) {
      // Server capped us. Its real per-request ceiling is what it just returned.
      const served = meta.width;
      if (served < 256) {
        throw new Error(`tile-stitch: server caps output at ${served}px — too small to stitch ${W}x${H}`);
      }
      chunk = served;
    }
  }

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
      // Fail loudly rather than paste a short tile and leave a white gutter.
      // A gap in a page image is invisible downstream: OCR reads it as a real
      // page and invents text to fill the silence.
      const meta = await sharp(buf).metadata();
      if (!tileFits(w, h, meta.width, meta.height)) {
        throw new Error(
          `tile-stitch: requested ${w}x${h} at (${x},${y}) but server returned `
          + `${meta.width}x${meta.height} — refusing to composite a gapped master`,
        );
      }
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

  return { buffer: stitched, width: W, height: H, tiles: totalTiles, chunk };
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

/**
 * Fetch the best master a source will actually give us, and say what was available.
 *
 * `/full/full/` is a REQUEST, not a guarantee. The seven hosts in SILENT_CAP_HOSTS
 * answer it with something smaller and no error — Kyoto at 1/8.69 of native, TU
 * Delft 1/5.92, Manchester 1/3.25 — so an archiver that just fetches and stores is
 * quietly banking a derivative as its master. Before #4406 the only callers that
 * defeated that were archive-eap.mjs and the rearchive sweep; every other archiver
 * was missing the same three lines, which is why this is a helper rather than a
 * sixth copy of them.
 *
 * It deliberately does NOT own the download. Each archiver has its own retry,
 * timeout and User-Agent policy tuned to its provider, and replacing those would be
 * a larger and riskier change than the one being made — so the caller passes
 * `download` and keeps its behaviour for the common path. The helper adds exactly
 * two things: the tile-stitch route when a host is known to cap, and the native
 * dimensions so the archiver can WRITE DOWN what was on offer.
 *
 * info.json is fetched ONLY for hosts already known to cap. That keeps request
 * volume unchanged for the ~78% of pages from honest sources — three institutions
 * blocked us inside 48 hours in August 2026, so an extra probe per page is not free.
 * New cappers are found by scripts/audit/archive-coverage.mjs and added to
 * SILENT_CAP_HOSTS, which is what makes them take effect here.
 *
 * @param {string} url - the page's source URL (any size form; upgraded internally)
 * @param {{ download: (url: string) => Promise<Buffer>, info?: object }} opts
 * @returns {Promise<{buffer: Buffer, nativeWidth: number|null, nativeHeight: number|null, stitchedTiles: number, url: string}>}
 */
export async function fetchPageMaster(url, opts = {}) {
  const { download } = opts;
  if (typeof download !== 'function') {
    throw new Error('fetchPageMaster: opts.download is required (the caller owns its own retry/UA policy)');
  }
  const fullUrl = upgradeToFullRes(url);
  const capSuspect = SILENT_CAP_HOSTS.some((h) => String(fullUrl).includes(h));
  const info = opts.info ?? (capSuspect ? await fetchIiifInfo(fullUrl).catch(() => null) : null);

  if (info && shouldTileStitch(info, fullUrl)) {
    const stitch = await fetchIiifNativeRes(fullUrl, { info });
    return {
      buffer: stitch.buffer,
      nativeWidth: stitch.width ?? info.width ?? null,
      nativeHeight: stitch.height ?? info.height ?? null,
      stitchedTiles: stitch.tiles || 0,
      url: fullUrl,
    };
  }

  return {
    buffer: await download(fullUrl),
    nativeWidth: info?.width ?? null,
    nativeHeight: info?.height ?? null,
    stitchedTiles: 0,
    url: fullUrl,
  };
}

/**
 * The `$set` fields an archiver should write beside `archived_photo`, given what
 * fetchPageMaster returned and the dimensions of what was actually stored.
 *
 * Centralised so six archivers cannot drift on field names — `image_width` vs
 * `width` vs `iiif_info.width` is exactly the field sprawl this repo keeps paying
 * for (#3969). Omits anything unknown rather than writing a zero: a wrong number
 * here is worse than a missing one, because the MASTER tier trusts it.
 */
export function dimensionFields(stored, master) {
  const out = {};
  if (stored?.width) out.image_width = stored.width;
  if (stored?.height) out.image_height = stored.height;
  if (master?.nativeWidth) out['iiif_info.width'] = master.nativeWidth;
  if (master?.nativeHeight) out['iiif_info.height'] = master.nativeHeight;
  if (master?.stitchedTiles) out.stitched_tiles = master.stitchedTiles;
  return out;
}
