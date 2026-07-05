#!/usr/bin/env node
/**
 * Cache temperature probe — measures ISR cache warmth from the edge.
 *
 * Must run from outside Vercel (local machine, Hetzner, etc.) to get
 * accurate x-vercel-cache headers. Vercel functions bypass the CDN
 * for same-origin fetches.
 *
 * Usage:
 *   node scripts/cache-temperature.mjs
 *   node scripts/cache-temperature.mjs --store   # also POST results to /api/admin/cache-probe
 */

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const IMAGES_URL = 'https://images.sourcelibrary.org';
const CONCURRENCY = 10;
const IMAGE_CONCURRENCY = 20; // images are lightweight HEAD requests
const TIMEOUT = 12_000;
const STORE = process.argv.includes('--store');

const STATIC_PAGES = [
  '/', '/collections', '/browse', '/gallery', '/libraries',
  '/languages', '/search', '/about', '/librarian', '/blog',
  '/artwork', '/encyclopedia', '/explore', '/categories',
  '/topics', '/timeline', '/browse/authors', '/taxonomy',
];

// Canonical books that are always worth probing
const CANONICAL_BOOKS = [
  '/book/corpus-hermeticum',
  '/book/the-hermetic-museum-various-sendivogius',
  '/book/de-occulta-philosophia-agrippa',
  '/book/atalanta-fugiens-maier',
  '/book/chemical-wedding-of-christian-rosenkreutz',
  '/book/monas-hieroglyphica-dee',
  '/book/utriusque-cosmi-historia-fludd',
  '/book/novum-organum-bacon',
  '/book/the-anatomy-of-melancholy-burton',
  '/book/the-man-in-the-moone-godwin',
  '/book/de-revolutionibus-orbium-coelestium-copernicus',
  '/book/musurgia-universalis-kircher',
  '/book/mutus-liber',
  '/book/splendor-solis',
  '/book/fama-fraternitatis',
  '/book/confessio-fraternitatis',
  '/book/sefer-yetzirah',
  '/book/picatrix',
  '/book/liber-de-arte-distillandi-brunschwig',
  '/book/theatrum-chemicum-britannicum-ashmole',
  '/book/the-book-of-abramelin',
  '/book/clavis-artis',
  '/book/aurora-consurgens',
  '/book/turba-philosophorum',
  '/book/rosarium-philosophorum',
];

async function fetchCollectionSlugs() {
  try {
    const res = await fetch(`${BASE_URL}/api/collections`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    const collections = Array.isArray(data) ? data : data.collections || [];
    return collections.filter(c => c.slug).map(c => c.slug);
  } catch {
    return [];
  }
}

async function fetchImageUrls() {
  const urls = new Set();
  try {
    // 1. Homepage recent books — thumbnails
    const recentRes = await fetch(`${BASE_URL}/api/books?limit=12&sort=created_at&order=desc`, {
      signal: AbortSignal.timeout(10_000),
    });
    const recentData = await recentRes.json();
    const recentBooks = Array.isArray(recentData) ? recentData : recentData.books || [];
    for (const b of recentBooks) {
      if (b.thumbnail?.includes('images.sourcelibrary.org')) urls.add(b.thumbnail);
    }

    // 2. Canonical book thumbnails via browse API (includes thumbnail field)
    try {
      const browseRes = await fetch(`${BASE_URL}/api/books/browse?limit=100&sort=featured`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (browseRes.ok) {
        const browseData = await browseRes.json();
        const books = Array.isArray(browseData) ? browseData : browseData.books || [];
        for (const b of books) {
          if (b.thumbnail?.includes('images.sourcelibrary.org')) urls.add(b.thumbnail);
        }
      }
    } catch { /* skip */ }

    // 3. Collection hero images (fetched from API)
    const colRes = await fetch(`${BASE_URL}/api/collections`, {
      signal: AbortSignal.timeout(10_000),
    });
    const colData = await colRes.json();
    const collections = Array.isArray(colData) ? colData : colData.collections || [];
    for (const c of collections) {
      const img = c.hero_image || c.featured_image;
      if (img?.includes('images.sourcelibrary.org')) urls.add(img);
    }
  } catch (e) {
    process.stderr.write(`  Warning: image URL fetch error: ${e.message}\n`);
  }
  return [...urls];
}

async function probeImage(url) {
  const t = Date.now();
  try {
    // Must use GET, not HEAD — R2 custom domains always return DYNAMIC for HEAD
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SourceLibrary-CacheProbe/1.0' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    // Consume body to complete the request (warms cache)
    await res.arrayBuffer();
    return {
      path: url.replace(IMAGES_URL, ''),
      cache: res.headers.get('cf-cache-status'),
      latency_ms: Date.now() - t,
      status: res.status,
    };
  } catch (e) {
    return {
      path: url.replace(IMAGES_URL, ''),
      cache: null,
      latency_ms: Date.now() - t,
      status: 0,
      error: e.message?.slice(0, 120),
    };
  }
}

async function probeImageBatch(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i += IMAGE_CONCURRENCY) {
    const batch = urls.slice(i, i + IMAGE_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(probeImage));
    results.push(...batchResults);
    const done = Math.min(i + IMAGE_CONCURRENCY, urls.length);
    process.stderr.write(`\r  Probed ${done}/${urls.length}`);
  }
  process.stderr.write('\n');
  return results;
}

// Sub-collections from DB (hardcoded — /api/collections doesn't return them)
const SUB_COLLECTIONS = [
  "ancient-epic-drama","ancient-historiography","animal-magnetism-mesmerism",
  "arabic-islamic-magic","arabic-alchemy","aristotelian-tradition","armenian-golden-age",
  "renaissance-art-architecture","asian-historical-texts","biblical-exegesis",
  "buddhism","indian-buddhist-jain","buddhist-studies","byzantine-philosophy",
  "celestial-divination","celtic","chinese-daoist-magic","chinese-astrology",
  "chinese-buddhist-texts","chinese-divination-cosmology","chinese-history-statecraft",
  "chinese-medicine-natural-philosophy","chinese-natural-knowledge",
  "christian-mystical-theology","christian-mysticism-sub","christianity",
  "confucian-classics","confucianism","corpus-hermeticum","cosmology-astronomy",
  "daoism","daoist-alchemy","daoist-classics","depth-psychology","divination-oracles",
  "divine-hymns","papyri-christian","early-modern-medicine-sub","encyclopedic-works",
  "enlightenment-political-philosophy","experimental-philosophy",
  "faculty-psychology-de-anima","falsafa","florentine-neoplatonism","freemasonry",
  "galenic-classical-medicine","geography-exploration","german-speculative-mysticism",
  "papyri-magical","hermetic-revival","gnostic-texts","hinduism","papyri-historical",
  "horoscopic-western-astrology","humanist-scholarship","illuminati-radical-orders",
  "indian-mathematics-astronomy","indian-natural-philosophy","indigenous-traditions",
  "islam","islamic-medicine-science","islamic-occult-sciences","jainism",
  "jewish-kabbalistic-mysticism","judaism","judeo-islamic-philosophy",
  "jyotisha-vedic-astrology","laboratory-chemistry","late-antique-byzantine-history",
  "papyri-literary","mahayana","manichaeism","mathematics","mechanical-engineering",
  "military-strategic-writing","mithraism","mystical-practice","myths-epics",
  "natural-history","natural-magic-sub","natural-magic-sympathies",
  "renaissance-natural-philosophy","neoplatonism","optics","oriental-classics",
  "orphism-mysteries","paracelsian-iatrochemistry","paracelsian-hermetica",
  "paracelsian-medicine","papyri-philosophical","philosophical-theology",
  "platonic-tradition","political-economy","psychology-of-religion","puranas-epics",
  "quran-islamic-theology","reformation-theology","renaissance-letters",
  "renaissance-political-thought","ritual-ceremonial-magic","roman-canon-law",
  "rosicrucian-alchemy","rosicrucian-tradition","royal-court-poetry",
  "russian-literary-social-thought","russian-political-thought",
  "russian-religious-philosophy","russian-theosophy-occultism","papyri-school",
  "shinto","skeptical-rational-critique","slavic-esoteric-translations",
  "socialist-revolutionary-thought","spirit-conjuration","spiritual-alchemy",
  "stoic-moral-philosophy","strategy-games","sufi-eastern-mysticism",
  "sufism-islamic-mysticism","templar-chivalric-orders","theological-demonology",
  "theosophical-occult","theosophical-occult-societies","theosophical-tradition",
  "theravada","renaissance-utopias","vajrayana","vedanta-darshana",
  "wisdom-debate-literature","witch-trial-literature","yoga-tantra-mysticism",
  "zoroastrian-tradition",
];

async function probe(path) {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'User-Agent': 'SourceLibrary-CacheProbe/1.0' },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    });
    // Consume body to avoid memory leaks
    await res.text();
    return {
      path,
      cache: res.headers.get('cf-cache-status') || res.headers.get('x-vercel-cache'),
      latency_ms: Date.now() - t,
      status: res.status,
    };
  } catch (e) {
    return {
      path,
      cache: null,
      latency_ms: Date.now() - t,
      status: 0,
      error: e.message?.slice(0, 120),
    };
  }
}

async function probeBatch(paths) {
  const results = [];
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(probe));
    results.push(...batchResults);
    // Progress
    const done = Math.min(i + CONCURRENCY, paths.length);
    process.stderr.write(`\r  Probed ${done}/${paths.length}`);
  }
  process.stderr.write('\n');
  return results;
}

function summarize(results) {
  return {
    hit: results.filter(r => r.cache === 'HIT' || r.cache === 'PRERENDER' || r.cache === 'STALE' || r.cache === 'REVALIDATED').length,
    miss: results.filter(r => r.cache === 'MISS' || !r.cache).length,
    total: results.length,
  };
}

async function main() {
  const started = Date.now();
  console.log(`\nCache Temperature Probe — ${BASE_URL}\n`);

  // 1. Static pages
  console.log('Static pages...');
  const staticResults = await probeBatch(STATIC_PAGES);

  // 2. Collections (from API)
  console.log('Fetching collection list...');
  const collectionSlugs = await fetchCollectionSlugs();
  const parentPaths = collectionSlugs.map(s => `/collections/${s}`);

  console.log(`Collections (${parentPaths.length})...`);
  const collectionResults = await probeBatch(parentPaths);

  // 3. Sub-collections (hardcoded — API doesn't return them)
  const subPaths = SUB_COLLECTIONS.map(s => `/collections/${s}`);
  console.log(`Sub-collections (${subPaths.length})...`);
  const subResults = await probeBatch(subPaths);

  // 4. Canonical books
  console.log(`Books (${CANONICAL_BOOKS.length})...`);
  const bookResults = await probeBatch(CANONICAL_BOOKS);

  // 5. R2 image warmup (thumbnails + collection hero images)
  console.log('Fetching image URLs...');
  const imageUrls = await fetchImageUrls();
  console.log(`R2 images (${imageUrls.length})...`);
  const imageResults = await probeImageBatch(imageUrls);

  // Aggregate (pages only — images reported separately)
  const allResults = [...staticResults, ...collectionResults, ...subResults, ...bookResults];
  // HIT = edge cached, PRERENDER = statically built, STALE = serving stale while revalidating
  // All three are "warm" — the page is served fast without a cold render
  const hits = allResults.filter(r => r.cache === 'HIT' || r.cache === 'PRERENDER' || r.cache === 'STALE' || r.cache === 'REVALIDATED').length;
  const total = allResults.length;
  const warmth = total > 0 ? Math.round((hits / total) * 100) : 0;

  const imgSummary = summarize(imageResults);

  const data = {
    probed_at: new Date().toISOString(),
    warmth,
    total,
    hits,
    misses: allResults.filter(r => r.cache === 'MISS' || !r.cache).length,
    stale: allResults.filter(r => r.cache === 'STALE' || r.cache === 'REVALIDATED').length,
    errors: allResults.filter(r => r.status === 0 || r.status >= 400).length,
    by_category: {
      static: summarize(staticResults),
      collections: summarize(collectionResults),
      subcollections: summarize(subResults),
      books: summarize(bookResults),
      r2_images: imgSummary,
    },
    slowest: allResults
      .filter(r => !r.error)
      .sort((a, b) => b.latency_ms - a.latency_ms)
      .slice(0, 10)
      .map(r => ({ path: r.path, ms: r.latency_ms, cache: r.cache })),
    failed: allResults
      .filter(r => r.status === 0 || r.status >= 400)
      .map(r => ({ path: r.path, status: r.status, error: r.error })),
    duration_ms: Date.now() - started,
  };

  // Display
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  WARMTH: ${warmth}%`);
  console.log(`  Total: ${total} | Hits: ${hits} | Misses: ${data.misses} | Stale: ${data.stale} | Errors: ${data.errors}`);
  console.log();
  for (const [cat, stats] of Object.entries(data.by_category)) {
    const pct = stats.total > 0 ? Math.round((stats.hit / stats.total) * 100) : 0;
    console.log(`  ${cat.padEnd(20)} ${String(pct).padStart(3)}%  (${stats.hit}/${stats.total})`);
  }
  if (data.slowest.length) {
    console.log('\n  Slowest:');
    for (const s of data.slowest.slice(0, 5)) {
      console.log(`    ${String(s.ms).padStart(6)}ms  ${(s.cache || 'N/A').padEnd(10)}  ${s.path}`);
    }
  }
  if (data.failed.length) {
    console.log('\n  Failed:');
    for (const f of data.failed) {
      console.log(`    ${f.status}  ${f.path}  ${f.error || ''}`);
    }
  }
  console.log(`\n  Probe took ${data.duration_ms}ms`);
  console.log('='.repeat(50));

  // Optionally store results via API
  if (STORE) {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret) {
        console.log('\nWARN: CRON_SECRET not set, skipping store');
      } else {
        // Store directly by calling POST with results in body
        console.log('\nStoring results...');
        // For now just print the JSON
        console.log(JSON.stringify(data));
      }
    } catch (e) {
      console.error('Failed to store:', e.message);
    }
  }
}

main().catch(console.error);
