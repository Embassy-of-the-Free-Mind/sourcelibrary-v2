#!/usr/bin/env node
/**
 * R2 Coverage Snapshot Worker
 *
 * Aggregates per-book R2 archive state across the pages collection and writes
 * the result to system_config._id: 'r2_coverage_snapshot'. The /admin/r2-coverage
 * page reads this doc instead of running 5M-row regex aggregations on every load.
 *
 * Two measurements are produced:
 *   1. Record-level coverage — does pages.archived_photo point at R2? Cheap
 *      ($regexMatch in Mongo aggregation), but only checks what we wrote, not
 *      what's on R2.
 *   2. Variant-level coverage — sampled HEAD probes against the three R2
 *      variants per page (display .jpg, -thumb.jpg, -full.jpg). Catches the
 *      blind spot where archived_photo IS R2 but the file or one of its
 *      variants isn't actually there. Skipped with --no-variant-probe.
 *
 * Run on demand or via Hetzner cron (every 6h is plenty — coverage changes slowly).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/r2-coverage-snapshot.mjs
 *   node scripts/workers/r2-coverage-snapshot.mjs --no-variant-probe   # skip the HEAD phase
 *   node scripts/workers/r2-coverage-snapshot.mjs --variant-samples=5  # probe N pages per book (default 3)
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const R2_HOST_REGEX = /^https:\/\/images\.sourcelibrary\.org/;
const ARCHIVE_FAILED_REGEX = /^failed:/;

const RUN_VARIANT_PROBE = !process.argv.includes('--no-variant-probe');
const VARIANT_SAMPLES = parseInt(process.argv.find(a => a.startsWith('--variant-samples='))?.split('=')[1] || '3', 10);
// Node's undici default agent has ~10 connections per origin. Each book probes
// VARIANT_SAMPLES × 3 URLs in parallel, so book-level concurrency × that needs
// to stay within the connection pool budget plus retry-headroom — 20 books ×
// 9 probes = 180 concurrent requests, which fits comfortably.
const VARIANT_CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--variant-concurrency='))?.split('=')[1] || '20', 10);

// Providers that intentionally don't host images on R2 (plain text imports etc.)
const TEXT_ONLY_PROVIDERS = new Set(['etcsl', 'tu_darmstadt']);

const VARIANTS = ['display', 'thumb', 'full'];

function variantUrl(bookId, pageNumber, variant) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `https://images.sourcelibrary.org/pages/${bookId}/${num}`;
  if (variant === 'thumb') return `${base}-thumb.jpg`;
  if (variant === 'full') return `${base}-full.jpg`;
  return `${base}.jpg`;
}

function pickSampleNumbers(total, n) {
  if (total <= n) return Array.from({ length: total }, (_, i) => i + 1);
  if (n === 1) return [Math.ceil(total / 2)];
  if (n === 2) return [1, total];
  // n >= 3: first, last, and (n-2) evenly spaced
  const out = [1, total];
  for (let i = 1; i <= n - 2; i++) {
    out.push(Math.round((i * total) / (n - 1)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

async function headOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (r.ok) return true;
    // 404 is a definitive answer — don't retry.
    if (r.status === 404) return false;
    // 429/5xx — caller should retry.
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function headOk(url, timeoutMs = 15000) {
  // First attempt + one retry on timeout/5xx with backoff. 404 short-circuits.
  let res = await headOnce(url, timeoutMs);
  if (res === null) {
    await new Promise(r => setTimeout(r, 250 + Math.random() * 500));
    res = await headOnce(url, timeoutMs);
  }
  return res;
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function pump() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, pump));
  return results;
}

async function run() {
  const client = new MongoClient(MONGODB_URI, { socketTimeoutMS: 1800000 });
  await client.connect();
  const db = client.db('bookstore');
  const start = Date.now();

  console.log(`[r2-coverage-snapshot] Starting at ${new Date().toISOString()}`);

  // Single aggregation: per-book R2 state across the whole pages collection.
  // $regexMatch is acceptable here because it's run once per book per snapshot,
  // not on every admin page load.
  console.log('  aggregating pages by book_id (this can take 10-20 min on Atlas)...');
  const perBook = await db.collection('pages').aggregate([
    { $group: {
      _id: '$book_id',
      total: { $sum: 1 },
      r2: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: R2_HOST_REGEX } }, 1, 0] } },
      failed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: ARCHIVE_FAILED_REGEX } }, 1, 0] } },
    }},
  ], { allowDiskUse: true, maxTimeMS: 1800000 }).toArray();

  console.log(`  per-book aggregation done: ${perBook.length} books with pages, ${((Date.now() - start)/60000).toFixed(1)} min`);

  const statsByBook = new Map(perBook.map(s => [s._id, s]));

  // Pull book metadata in one pass — only what we need
  const books = await db.collection('books').find(
    { status: { $ne: 'deleted' }, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, language: 1, 'image_source.provider': 1, 'pipeline_auto.status': 1, 'pipeline_auto.error': 1 } }
  ).toArray();

  // Bucket books by R2 coverage
  const buckets = { full: 0, partial_high: 0, partial_med: 0, partial_low: 0, none: 0 };
  let totalPages = 0;
  let totalR2 = 0;
  let totalFailed = 0;
  const byProvider = {};
  const byProviderUnarchived = {};
  const partialBooks = []; // books with some-but-not-all R2 coverage
  const noR2Books = [];    // books with zero R2 coverage but >0 pages

  for (const b of books) {
    const s = statsByBook.get(b.id) || { total: 0, r2: 0, failed: 0 };
    if (s.total === 0) continue; // no pages doc — skip
    const provider = b.image_source?.provider || 'unknown';
    const unarchived = Math.max(0, s.total - s.r2 - s.failed);
    const ratio = s.r2 / s.total;

    totalPages += s.total;
    totalR2 += s.r2;
    totalFailed += s.failed;

    if (!byProvider[provider]) byProvider[provider] = { books: 0, pages: 0, r2: 0, failed: 0 };
    byProvider[provider].books += 1;
    byProvider[provider].pages += s.total;
    byProvider[provider].r2 += s.r2;
    byProvider[provider].failed += s.failed;
    byProviderUnarchived[provider] = (byProviderUnarchived[provider] || 0) + unarchived;

    if (ratio >= 0.99) buckets.full += 1;
    else if (ratio >= 0.5) buckets.partial_high += 1;
    else if (ratio >= 0.1) buckets.partial_med += 1;
    else if (ratio > 0) buckets.partial_low += 1;
    else buckets.none += 1;

    if (ratio > 0 && ratio < 0.99) {
      partialBooks.push({
        id: b.id,
        title: b.title,
        language: b.language,
        provider,
        status: b.pipeline_auto?.status || null,
        error: b.pipeline_auto?.error?.slice(0, 80) || null,
        pages: s.total,
        r2: s.r2,
        failed: s.failed,
        unarchived,
        pct: Math.round(ratio * 1000) / 10,
      });
    } else if (ratio === 0 && s.total > 0) {
      noR2Books.push({
        id: b.id,
        title: b.title,
        language: b.language,
        provider,
        status: b.pipeline_auto?.status || null,
        pages: s.total,
      });
    }
  }

  partialBooks.sort((a, b) => b.unarchived - a.unarchived);
  noR2Books.sort((a, b) => b.pages - a.pages);

  // --- Variant-level coverage (HEAD probes against R2) ---
  // Record-level coverage above only proves we *wrote* an R2 URL into
  // archived_photo. The file behind that URL may not exist, and the -thumb /
  // -full variants are computed independently — they can be missing even when
  // display .jpg is present. Sample N pages per book and HEAD-probe all three
  // variants to catch this.
  let variantCoverage = null;
  if (RUN_VARIANT_PROBE) {
    const probeStart = Date.now();
    const eligible = books.filter(b => {
      const s = statsByBook.get(b.id);
      if (!s || s.total === 0) return false;
      const provider = b.image_source?.provider || 'unknown';
      return !TEXT_ONLY_PROVIDERS.has(provider);
    });
    console.log(`  variant-probe phase: ${eligible.length} books × ${VARIANT_SAMPLES} samples × ${VARIANTS.length} variants = ~${eligible.length * VARIANT_SAMPLES * VARIANTS.length} HEAD requests, concurrency=${VARIANT_CONCURRENCY}`);

    // Track resolved probes per variant. A probe is "resolved" if headOk
    // returned a definite boolean. Network errors / timeouts (null) are
    // excluded from BOTH numerator and denominator so library-wide percentages
    // reflect the real R2 hit rate, not the network noise rate.
    const lib = {
      resolved: { display: 0, thumb: 0, full: 0 },
      hits: { display: 0, thumb: 0, full: 0 },
      unresolved: 0,
    };
    const byProvVariant = {};
    const variantGapBooks = [];
    let probed = 0;
    let lastLog = Date.now();
    let booksWithAnyUnresolved = 0;

    await runWithConcurrency(eligible, async (b) => {
      const s = statsByBook.get(b.id);
      const samples = pickSampleNumbers(s.total, VARIANT_SAMPLES);
      const provider = b.image_source?.provider || 'unknown';

      // Build the flat list of (sample, variant) tuples for this book
      const probes = [];
      for (const pageNum of samples) {
        for (const variant of VARIANTS) {
          probes.push({ pageNum, variant, url: variantUrl(b.id, pageNum, variant) });
        }
      }
      const results = await Promise.all(probes.map(p => headOk(p.url).then(ok => ({ ...p, ok }))));

      const perVariant = { display: { ok: 0, total: 0 }, thumb: { ok: 0, total: 0 }, full: { ok: 0, total: 0 } };
      let bookUnresolved = 0;
      for (const r of results) {
        if (r.ok === null) { bookUnresolved += 1; continue; }
        perVariant[r.variant].total += 1;
        if (r.ok) perVariant[r.variant].ok += 1;
      }
      if (bookUnresolved > 0) booksWithAnyUnresolved += 1;
      lib.unresolved += bookUnresolved;

      for (const v of VARIANTS) {
        lib.resolved[v] += perVariant[v].total;
        lib.hits[v] += perVariant[v].ok;
      }
      if (!byProvVariant[provider]) byProvVariant[provider] = { books: 0, resolved: { display: 0, thumb: 0, full: 0 }, hits: { display: 0, thumb: 0, full: 0 } };
      byProvVariant[provider].books += 1;
      for (const v of VARIANTS) {
        byProvVariant[provider].resolved[v] += perVariant[v].total;
        byProvVariant[provider].hits[v] += perVariant[v].ok;
      }

      const missingVariants = VARIANTS.filter(v => perVariant[v].total > 0 && perVariant[v].ok < perVariant[v].total);
      if (missingVariants.length > 0) {
        variantGapBooks.push({
          id: b.id,
          title: b.title,
          language: b.language,
          provider,
          pages: s.total,
          samples: samples.length,
          display_pct: perVariant.display.total ? Math.round((perVariant.display.ok / perVariant.display.total) * 100) : null,
          thumb_pct: perVariant.thumb.total ? Math.round((perVariant.thumb.ok / perVariant.thumb.total) * 100) : null,
          full_pct: perVariant.full.total ? Math.round((perVariant.full.ok / perVariant.full.total) * 100) : null,
          missing: missingVariants,
        });
      }

      probed += 1;
      if (Date.now() - lastLog > 30_000) {
        console.log(`    probed ${probed}/${eligible.length} books (${((probed / eligible.length) * 100).toFixed(0)}%)`);
        lastLog = Date.now();
      }
    }, VARIANT_CONCURRENCY);

    // Rank variant-gap books by user-visible loss. display and thumb gaps are
    // what readers see (broken icons, no reader image); the full-res variant
    // is consumed by OCR/zoom paths but doesn't surface in normal browsing. We
    // weight display and thumb heavily so books with visible gaps land at the
    // top, even when they're smaller than the "every book is missing full"
    // long tail.
    const lossScore = (b) => {
      const pages = b.pages || 0;
      const dGap = b.display_pct === null ? 0 : (100 - b.display_pct) / 100;
      const tGap = b.thumb_pct === null ? 0 : (100 - b.thumb_pct) / 100;
      const fGap = b.full_pct === null ? 0 : (100 - b.full_pct) / 100;
      return pages * (3 * dGap + 2 * tGap + 1 * fGap);
    };
    variantGapBooks.sort((a, b) => lossScore(b) - lossScore(a));

    const totalResolved = lib.resolved.display + lib.resolved.thumb + lib.resolved.full;
    const totalAttempted = totalResolved + lib.unresolved;
    variantCoverage = {
      probed_books: probed,
      samples_per_book: VARIANT_SAMPLES,
      probe_ms: Date.now() - probeStart,
      probes_attempted: totalAttempted,
      probes_resolved: totalResolved,
      probes_unresolved: lib.unresolved,
      books_with_any_unresolved: booksWithAnyUnresolved,
      library: {
        display_pct: lib.resolved.display ? Math.round((lib.hits.display / lib.resolved.display) * 1000) / 10 : null,
        thumb_pct: lib.resolved.thumb ? Math.round((lib.hits.thumb / lib.resolved.thumb) * 1000) / 10 : null,
        full_pct: lib.resolved.full ? Math.round((lib.hits.full / lib.resolved.full) * 1000) / 10 : null,
      },
      by_provider: Object.fromEntries(Object.entries(byProvVariant).map(([p, v]) => [p, {
        books: v.books,
        display_pct: v.resolved.display ? Math.round((v.hits.display / v.resolved.display) * 1000) / 10 : null,
        thumb_pct: v.resolved.thumb ? Math.round((v.hits.thumb / v.resolved.thumb) * 1000) / 10 : null,
        full_pct: v.resolved.full ? Math.round((v.hits.full / v.resolved.full) * 1000) / 10 : null,
      }])),
      gap_books_count: variantGapBooks.length,
      gap_books_top200: variantGapBooks.slice(0, 500), // field kept for back-compat; now stores up to 500
    };

    console.log(`  variant-probe done: ${probed} books, ${totalResolved}/${totalAttempted} probes resolved (${lib.unresolved} unresolved, ${booksWithAnyUnresolved} books partially affected) in ${((Date.now() - probeStart) / 1000).toFixed(1)}s`);
    console.log(`    display: ${variantCoverage.library.display_pct}%  thumb: ${variantCoverage.library.thumb_pct}%  full: ${variantCoverage.library.full_pct}%`);
    console.log(`    books with at least one variant gap: ${variantGapBooks.length}`);
  }

  const snapshot = {
    _id: 'r2_coverage_snapshot',
    computed_at: new Date(),
    computation_ms: Date.now() - start,
    library: {
      books_with_pages: buckets.full + buckets.partial_high + buckets.partial_med + buckets.partial_low + buckets.none,
      total_pages: totalPages,
      r2_pages: totalR2,
      failed_pages: totalFailed,
      unarchived_pages: totalPages - totalR2 - totalFailed,
      r2_pct: totalPages > 0 ? Math.round((totalR2 / totalPages) * 1000) / 10 : 0,
    },
    coverage_buckets: buckets,
    by_provider: byProvider,
    partial_books_top200: partialBooks.slice(0, 200),
    no_r2_books_top200: noR2Books.slice(0, 200),
    partial_books_count: partialBooks.length,
    no_r2_books_count: noR2Books.length,
    variant_coverage: variantCoverage,
  };

  await db.collection('system_config').replaceOne(
    { _id: 'r2_coverage_snapshot' },
    snapshot,
    { upsert: true },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[r2-coverage-snapshot] Done in ${elapsed}s`);
  console.log(`  Library: ${snapshot.library.r2_pct}% R2 (${totalR2.toLocaleString()}/${totalPages.toLocaleString()} pages)`);
  console.log(`  Buckets: full=${buckets.full}, partial_high=${buckets.partial_high}, partial_med=${buckets.partial_med}, partial_low=${buckets.partial_low}, none=${buckets.none}`);
  console.log(`  Partial books: ${partialBooks.length} | No-R2 books: ${noR2Books.length}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
