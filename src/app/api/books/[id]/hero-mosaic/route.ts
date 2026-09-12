import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// sharp + mongodb + node:crypto require the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { storagePut } from '@/lib/storage';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';
import { measureStoredGrid } from '@/lib/hero-mosaic-measure';
import { images } from '@/lib/api-client/images';
import { type PageImageFields } from '@/lib/page-image-url';
import { HERO_MOSAIC_VERSION } from '@/lib/hero-mosaic-version';
import {
  MOSAIC_FULL_TILES,
  mosaicUpgradeCooledDown,
  nextUpgradeVerdict,
} from '@/lib/hero-mosaic-upgrade';

/**
 * GET /api/books/[id]/hero-mosaic
 *
 * Builds (once) and caches a single tiled background image for the book-page
 * hero — a 10-column grid of page-scan thumbnails composited server-side into
 * one compressed JPEG on R2. On a cache hit it 302-redirects to the stored R2
 * URL; the first hit for a book composes and stores it. When a book can't make
 * a good mosaic (too few *distinct* pages — e.g. every "thumb" fell back to the
 * same cover), we cache a negative result and 404 so the hero shows a plain
 * dark panel instead of a wall of identical tiles.
 *
 * ?upgrade=1 — background self-repair, fired by the hero once the stored image
 * has painted (so nobody waits on it). The grid shape is fixed by how many
 * tiles survived fetching AT GENERATION TIME, so a run where some page fetches
 * flaked leaves a permanent 10x2 on a book with hundreds of usable pages, and
 * the version short-circuit means nothing ever retries. This mode rebuilds such
 * a book once and overwrites its mosaic, so the NEXT visitor gets the fuller
 * grid. It refuses to run when the stored grid is already full, when the book
 * can't do better, or within the cooldown — see lib/hero-mosaic-upgrade.ts.
 * Never a version bump: that would rebuild the ~70% that are already correct.
 */

const MOSAIC_VERSION = HERO_MOSAIC_VERSION; // shared with the book page (cache-buster)
const MAX_ROWS = 4; // the hero crop (desktop rows 2-4, mobile rows 1-3) never shows a 5th row
const MAX_TILES = 10 * MAX_ROWS; // 10 cols × 4 rows = 40 — the most that can ever be seen
const MIN_TILES = 4; // below this we can't make a grid that fills without stretching
const FETCH_CONCURRENCY = 10; // outbound image fetches in flight at once (socket safety)
const TARGET_ASPECT = 1.6; // mosaic width:height — a 10×4 of portrait pages; the
                           // hero shows it via background-cover (never repeated)

/**
 * Grid shape for `n` tiles of median height `mh`. Columns/rows are chosen so the
 * composited mosaic lands near TARGET_ASPECT — this is what keeps SHORT tiles
 * (palm-leaf strips, wide scans) from producing a 1-row, wildly-wide block. A
 * book of tall portrait pages with ≥40 tiles lands 10×4 (= MAX_TILES); short
 * strips get fewer columns. Rows are HARD-capped at 4 — a 5th row is always
 * cropped out of the hero (proven), so it would only be wasted tiles. Only whole
 * rows are used, so the bottom is never ragged.
 */
function chooseGrid(n: number, mh: number): { cols: number; rows: number; used: number } {
  // Portrait-ish pages (taller than the fixed 168px column) always use a full
  // 10 columns — that's what fills the wide desktop hero (object-cover fills
  // width, so every column shows). Short/WIDE strips (palm-leaf, landscape
  // scans) keep the aspect-based fewer-columns fallback so they don't become a
  // 1-row ribbon.
  let cols = mh >= TILE_W
    ? Math.min(10, n)
    : Math.round(Math.sqrt(n * ((TARGET_ASPECT * mh) / TILE_W)));
  cols = Math.max(3, Math.min(10, cols, n));
  let rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(n / cols)));
  // Prefer ≥2 rows when we have the tiles — a single row cover-crops badly.
  if (rows < 2 && n >= 6) { cols = Math.max(2, Math.floor(n / 2)); rows = Math.min(MAX_ROWS, Math.floor(n / cols)); }
  return { cols, rows, used: cols * rows };
}

const TILE_W = 168; // fixed column width; height follows the page's true aspect
const MAX_TILE_H = 340; // clamp very tall strips so one tile can't dominate a column
const GAP = 6; // thin gap between tiles (shows the dark bg through)
const AVIF_QUALITY = 38; // AVIF quality — the bg sits under a heavy dark scrim, so it compresses hard with no visible loss
const MAX_MOSAIC_W = 1920; // cap the output width — the hero never needs more
const CANDIDATE_LIMIT = 64; // fetch extra so dedup + outlier-height filtering reliably leaves ≥40 to fill 10×4
const PAGE_DOC_LIMIT = 800; // page docs to scan before sampling candidates across the book

/** Pick `n` items evenly spread across `arr` (keeps order). Sampling ACROSS the
 *  book — not just the front — means a broken/duplicate contiguous cluster of
 *  pages can't starve the grid, and the hero represents the whole book. */
function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}
const BG = { r: 20, g: 16, b: 12 }; // matches the hero's #14100c

// Page types we never tile: blanks, digitizer inserts, and the scanner
// calibration / colour-card / cover / spine shots. Excluding them keeps the
// grid to real content pages of a consistent shape (and out of the height
// discrepancy that odd cover/foldout scans introduce).
const JUNK_PAGE_TYPES = ['blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata', 'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target', 'cover', 'spine', 'frontcover', 'backcover'];

const PAGE_IMAGE_PROJECTION = {
  _id: 0,
  page_number: 1,
  page_type: 1,
  photo: 1,
  photo_original: 1,
  archived_photo: 1,
  enhanced_photo: 1,
  cropped_photo: 1,
  display_photo: 1,
  image_thumb: 1,
  thumbnail_blob: 1,
  thumbnail: 1,
  split_from_spread: 1,
  crop: 1,
} as const;

// An ABSOLUTE image URL the serverless function can fetch directly. Must be
// absolute — a relative `/api/image?...` proxy URL (what getPageImageUrl returns
// for pages lacking a pre-sized thumb) can't be fetch()'d server-side and would
// silently fail, starving the grid. We resize whatever we fetch ourselves.
const RENDERABLE = /^https:\/\/([^/]*\.)?(sourcelibrary\.org|public\.blob\.vercel-storage\.com|r2\.dev|wikimedia\.org)\//i;
const IIIF_ABS = /^https:\/\/[^?]*\/(full|iiif)\//i; // per-page IIIF images (distinct, resizable)
const UNSAFE_IMG = /\.(jp2|jpx|jpf|j2k|tiff?)(\?|$)/i;

/** Best absolute, server-fetchable, per-page image URL (pre-sized thumb first,
 *  then the archived/display source — the route resizes it). Skips relative
 *  proxy URLs and non-decodable formats. */
function absPageUrl(p: PageImageFields): string | null {
  // Thumbnail-first: cheapest to fetch and always present, and after
  // downscaling to TILE_W the mosaic reads fine at hero scale. (Preferring a
  // larger source for few-page books was tried and reverted — it broke books
  // whose large source is slow/unfetchable and added storage/bandwidth cost.)
  const cands = [p.image_thumb, p.display_photo, p.archived_photo, p.cropped_photo, p.enhanced_photo, p.photo_original, p.photo];
  for (const u of cands) {
    if (typeof u !== 'string' || UNSAFE_IMG.test(u)) continue;
    if (RENDERABLE.test(u) || IIIF_ABS.test(u)) return u;
  }
  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();

    const upgrade = request.nextUrl.searchParams.get('upgrade') === '1';

    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      {
        projection: {
          _id: 0, id: 1, hero_mosaic_url: 1, hero_mosaic_version: 1,
          hero_mosaic_tiles: 1, hero_mosaic_maxed: 1, hero_mosaic_upgrade_at: 1,
          hero_mosaic_upgrade_attempts: 1, hero_mosaic_source: 1,
        },
      },
    );
    if (!book?.id) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

    const priorTiles = typeof book.hero_mosaic_tiles === 'number' ? book.hero_mosaic_tiles : null;
    const attempts = typeof book.hero_mosaic_upgrade_attempts === 'number' ? book.hero_mosaic_upgrade_attempts : 0;

    if (upgrade) {
      // Refuse fast and cheaply — this endpoint is fired by every visitor to an
      // eligible book, so the no-op path must cost one indexed read.
      if (book.hero_mosaic_maxed) return upgradeSkipped('maxed');
      const storedSource = book.hero_mosaic_source as string | undefined;
      // A plate-tiled mosaic is never "already full": the book should be
      // showing its pages, and those are usually fetchable by now.
      if (storedSource !== 'plates' && priorTiles !== null && priorTiles >= MOSAIC_FULL_TILES) {
        return upgradeSkipped('already-full');
      }
      if (!mosaicUpgradeCooledDown(book.hero_mosaic_upgrade_at as Date | null, Date.now())) {
        return upgradeSkipped('cooldown');
      }
      // Claim the slot BEFORE the expensive work, so concurrent visitors to the
      // same book fall into the cooldown branch above instead of all rebuilding.
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { hero_mosaic_upgrade_at: new Date() } },
      ).catch(() => {});

      // Unknown grid (every mosaic built before the generator recorded it):
      // MEASURE the stored image rather than rebuilding it. One fetch + decode
      // settles whether this book needs anything at all, and ~70% of them do
      // not — that is what keeps this from becoming a full-corpus regen.
      if (priorTiles === null && book.hero_mosaic_url) {
        const measured = await measureStoredGrid(book.hero_mosaic_url as string);
        if (measured !== null) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { hero_mosaic_tiles: measured } },
          ).catch(() => {});
          // Only a page-tiled mosaic can be settled by its size alone. A stored
          // mosaic with no recorded source predates the field; measuring can't
          // tell pages from plates, so a full grid is accepted as done and the
          // plate case is caught on the next build, which does record it.
          if (measured >= MOSAIC_FULL_TILES && storedSource !== 'plates') {
            return upgradeSkipped('measured-full', measured);
          }
        }
      }
      // Fall through: rebuild below, then judge the result.
    } else if (book.hero_mosaic_version === MOSAIC_VERSION) {
      // Up-to-date cache: redirect to the stored image, or 404 the negative result.
      return book.hero_mosaic_url ? redirectToMosaic(book.hero_mosaic_url) : noMosaic();
    }

    const cacheNegative = async () => {
      await db.collection('books').updateOne({ id: book.id }, { $set: { hero_mosaic_url: null, hero_mosaic_version: MOSAIC_VERSION, hero_mosaic_at: new Date() } }).catch(() => {});
      return noMosaic();
    };

    type Tile = { data: Buffer; height: number };

    // Fetch a batch of URLs → resize each to the fixed column width (true aspect)
    // → keep only byte-DISTINCT tiles (so a cover-fallback book, whose every page
    // thumbnail resolves to the same image, collapses to 1 and triggers the plate
    // fallback below instead of tiling one page).
    //
    // Fetches run through a small concurrency POOL, not all at once: firing 80+
    // outbound requests from one serverless function exhausts its sockets and
    // most fail, which used to starve the grid (and then wrongly negative-cache).
    type Entry = { url: string; fallback?: string };
    const fetchUrl = async (url: string): Promise<Tile | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await images.fetchBuffer(url, { timeout: 15000 });
          const { data, info } = await sharp(buf).resize({ width: TILE_W, withoutEnlargement: false }).toBuffer({ resolveWithObject: true });
          if (info.height <= MAX_TILE_H) return { data, height: info.height };
          const cropped = await sharp(data).extract({ left: 0, top: 0, width: info.width, height: MAX_TILE_H }).toBuffer();
          return { data: cropped, height: MAX_TILE_H };
        } catch { if (attempt === 1) break; }
      }
      return null;
    };
    // Try the preferred (possibly large) source; if it can't be fetched, fall
    // back to the page's thumbnail — so preferring a big source for few-page
    // books can never starve the grid when that source is missing/unfetchable.
    const fetchOne = async (e: Entry): Promise<Tile | null> => {
      const t = await fetchUrl(e.url);
      if (t) return t;
      if (e.fallback && e.fallback !== e.url) return fetchUrl(e.fallback);
      return null;
    };
    const fetchTiles = async (entries: Entry[]): Promise<{ tiles: Tile[]; fetched: number }> => {
      const list = entries.slice(0, CANDIDATE_LIMIT);
      const raw: (Tile | null)[] = new Array(list.length).fill(null);
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= list.length) return;
          raw[i] = await fetchOne(list[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, list.length) }, worker));
      const seen = new Set<string>();
      const out: Tile[] = [];
      let fetched = 0;
      for (const t of raw) {
        if (!t) continue;
        fetched++;
        const h = createHash('md5').update(t.data).digest('hex');
        if (seen.has(h)) continue;
        seen.add(h);
        out.push(t);
      }
      return { tiles: out, fetched };
    };

    // Primary source: PAGE SCANS in reading order (skip blanks + scanner junk).
    // A book reads as its pages; pages that happen to hold a plate are a bonus.
    const pageDocs = await db.collection('pages')
      .find({ book_id: book.id, page_type: { $nin: JUNK_PAGE_TYPES } }, { projection: PAGE_IMAGE_PROJECTION, maxTimeMS: 8000 })
      .sort({ page_number: 1 })
      .limit(PAGE_DOC_LIMIT)
      .toArray();
    // Distinct absolute URLs across the WHOLE book, then sample evenly to the
    // fetch budget — so a broken contiguous cluster (e.g. a run of pages sharing
    // one thumbnail) can't dominate, and the hero samples the whole book.
    // Few-page books tile to a handful of large cells → use bigger page images
    // so they don't look upscaled. Many-page books use the fast thumbnails.
    const byUrl = new Map<string, Entry>();
    for (const p of pageDocs) {
      const url = absPageUrl(p as PageImageFields);
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, { url });
    }
    const pageEntries = sampleEvenly([...byUrl.values()], CANDIDATE_LIMIT);

    let distinct = (await fetchTiles(pageEntries)).tiles;
    let usingPlates = false;
    let plateUrlCount = 0;

    // Plates are a fallback ONLY for pages that genuinely can't make a grid:
    //  - too few distinct page URLs (structurally image-poor pages), or
    //  - cover-fallback (we fetched plenty of pages but they collapsed to ~1
    //    distinct image — every "page" is really the same cover).
    // A merely-flaky page fetch (many URLs, transient failures) must NOT drop us
    // to plates — that's how a rich text book (e.g. the Compendium) wrongly
    // cached a plate grid. It instead builds from whatever pages it got, or 404s
    // to retry (below).
    const pageStructural = pageEntries.length < MIN_TILES * 3;      // < ~12 distinct page URLs
    const pageCoverFallback = pageEntries.length >= 12 && distinct.length <= 3; // collapsed to one image
    if (distinct.length < MIN_TILES * 3 && (pageStructural || pageCoverFallback)) {
      const plates = await db.collection('gallery_images')
        .find(
          { book_id: book.id, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
          { projection: { _id: 0, thumbnail_url: 1, extracted_url: 1, image_url: 1 }, maxTimeMS: 6000 },
        )
        .sort({ gallery_quality: -1 })
        .limit(MAX_TILES)
        .toArray();
      const plateUrls = Array.from(new Set(
        plates.map(p => (p.thumbnail_url || p.extracted_url || p.image_url) as string | undefined).filter((u): u is string => !!u && !UNSAFE_IMG.test(u) && (RENDERABLE.test(u) || IIIF_ABS.test(u))),
      ));
      plateUrlCount = plateUrls.length;
      if (plateUrls.length) {
        const plateTiles = (await fetchTiles(plateUrls.map(u => ({ url: u })))).tiles;
        if (plateTiles.length > distinct.length) { distinct = plateTiles; usingPlates = true; }
      }
    }

    if (distinct.length < MIN_TILES) {
      // Nothing usable yet. If we HAD plenty of candidate URLs (rich book) but the
      // fetches flaked, 404 WITHOUT caching so the next request regenerates — never
      // lock a rich book to a dark hero. Only a structurally image-poor book (few
      // page URLs AND few plate URLs) caches a dark negative.
      const structural = pageEntries.length < 12 && plateUrlCount < 12;
      return structural ? cacheNegative() : noMosaic();
    }

    // Height-outlier filter: keep tiles whose height sits near the MEDIAN so rows
    // are uniform (no foldout/spread stretching a row) — the hero then reads like
    // the Pages section. Only meaningful with enough tiles; skip when few, and
    // revert if the band would drop too much.
    let kept = distinct;
    if (distinct.length >= 12) {
      const sortedH = distinct.map(t => t.height).sort((a, b) => a - b);
      const median = sortedH[Math.floor(sortedH.length / 2)] || MAX_TILE_H;
      const band = distinct.filter(t => t.height >= median * 0.82 && t.height <= median * 1.2);
      if (band.length >= Math.max(12, Math.floor(distinct.length * 0.6))) kept = band;
    }
    kept = kept.slice(0, MAX_TILES);

    // Shape the grid to the hero's aspect (never repeated, always background-cover
    // filled). Short tiles get more rows / fewer columns so the block is never a
    // 1-row wide strip. Rows are laid out top-aligned at true dimensions.
    // Which pool we tiled from is recorded below: a plates fallback is a
    // symptom of page images being briefly unfetchable, and it must be
    // revisitable once they land. It used to be discarded here.
    const medH = kept.map(t => t.height).sort((a, b) => a - b)[Math.floor(kept.length / 2)] || MAX_TILE_H;
    const { cols: rowCols, rows: numRows } = chooseGrid(kept.length, medH);
    const used = kept.slice(0, rowCols * numRows);
    const width = rowCols * TILE_W + (rowCols + 1) * GAP;

    const placements: { input: Buffer; left: number; top: number }[] = [];
    let y = GAP;
    for (let r = 0; r < numRows; r++) {
      const row = used.slice(r * rowCols, r * rowCols + rowCols);
      const rowHeight = Math.max(...row.map(t => t.height));
      row.forEach((t, c) => {
        placements.push({ input: t.data, left: GAP + c * (TILE_W + GAP), top: y }); // top-aligned
      });
      y += rowHeight + GAP;
    }
    const height = y; // sum of row heights + gaps → a clean rectangle

    // Every book with renderable page scans gets a grid (no dark-hero opt-out) —
    // even dark manuscripts and palm-leaf strips. The hero tint + text shadow
    // keep the overlaid text legible regardless of how dark the grid is.
    // Composite the grid, cap the width (the hero bg never needs more than
    // ~1920px), and encode as AVIF — a fraction of the JPEG bytes for the same
    // look, so the hero background loads fast.
    const composed = await sharp({ create: { width, height, channels: 3, background: BG } })
      .composite(placements)
      .resize({ width: Math.min(width, MAX_MOSAIC_W), withoutEnlargement: true })
      .avif({ quality: AVIF_QUALITY, effort: 5 })
      .toBuffer();

    // The tile count is part of the key. Overwriting one immutable-ish object
    // would leave the CDN serving the OLD image after an upgrade — the whole
    // point is that the next visitor sees the fuller grid. A rebuild that lands
    // on the same shape reuses the same key, which is correct: nothing changed.
    const builtTiles = rowCols * numRows;
    const key = `hero-mosaic/${book.id}-v${MOSAIC_VERSION}-${builtTiles}.avif`;
    const uploaded = await storagePut(key, composed, { contentType: 'image/avif', allowOverwrite: true });

    // Record the grid we actually built. Without this the shape is only
    // recoverable by decoding the stored image, which is why 12,660 cached
    // mosaics had to be measured one at a time to find the short ones.
    const fields: Record<string, unknown> = {
      hero_mosaic_url: uploaded.url,
      hero_mosaic_version: MOSAIC_VERSION,
      hero_mosaic_at: new Date(),
      hero_mosaic_tiles: builtTiles,
      hero_mosaic_cols: rowCols,
      hero_mosaic_rows: numRows,
      hero_mosaic_source: usingPlates ? 'plates' : 'pages',
    };
    if (upgrade) {
      const verdict = nextUpgradeVerdict(priorTiles, builtTiles, attempts, {
        before: book.hero_mosaic_source as string | undefined,
        after: usingPlates ? 'plates' : 'pages',
      });
      fields.hero_mosaic_maxed = verdict.maxed;
      fields.hero_mosaic_upgrade_attempts = verdict.attempts;
    }
    await db.collection('books').updateOne({ id: book.id }, { $set: fields }).catch(() => {});

    if (upgrade) {
      // Most books reach their mosaic through THIS route, whose 302 is edge
      // cached for a week. Without dropping it, the next visitor follows the
      // stale redirect to the old key and the rebuild is invisible.
      if (builtTiles !== priorTiles) {
        await purgeCloudflareUrls([`/api/books/${book.id}/hero-mosaic`]).catch(() => {});
      }
      return NextResponse.json(
        { upgraded: true, before: priorTiles, after: builtTiles, cols: rowCols, rows: numRows },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return redirectToMosaic(uploaded.url);
  } catch (error) {
    console.error('[hero-mosaic] generation error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

function upgradeSkipped(reason: string, tiles?: number) {
  const res = NextResponse.json({ upgraded: false, reason, tiles });
  res.headers.set(
    'Cache-Control',
    reason === 'cooldown' ? 'no-store' : 'public, max-age=3600, s-maxage=604800',
  );
  return res;
}

function redirectToMosaic(url: string) {
  const res = NextResponse.redirect(url, 302);
  // Cache the redirect at the edge; the R2 target itself is effectively immutable.
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
  return res;
}

function noMosaic() {
  const res = NextResponse.json({ error: 'No mosaic' }, { status: 404 });
  res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=604800');
  return res;
}
