/**
 * Shared trailing-dupe detection for IA-style books.
 *
 * IA's PDF-to-page extraction often emits a fixed-length run of identical
 * trailing pages — back-cover scans, IA wrapper templates, blank fillers —
 * that are BYTE-IDENTICAL on R2 (same R2 ETag / MD5 proves it without
 * downloading the image). These pages pollute the reader, waste
 * OCR/translation budget, and inflate dashboard gaps.
 *
 * This module is consumed by two callers that must behave identically:
 *   - scripts/maintenance/dedup-ia-trailing-pages.mjs  (CLI, reads argv)
 *   - scripts/workers/pipeline-orchestrator.mjs        (Phase 1.97, no argv)
 *
 * The tuning constants live in DEFAULT_OPTS; the CLI overrides them from argv,
 * the orchestrator uses the defaults. Detection logic is identical in both.
 *
 * Why R2 ETag and not content-length or dhash:
 *   `content-length` is NOT reliable — Cloudflare's edge serves different
 *   values across HEAD probes for the same file. ETag is constant across edge
 *   nodes and equals the file's MD5. Same ETag → byte-identical content with
 *   practical certainty. dhash is the right tool for near-duplicate
 *   gallery_images (PR #2095) but overkill for byte-exact page wrappers.
 *
 * Reversible: pages are hidden via negative page_number, never deleted.
 * To restore: set page_number back to its absolute value.
 */

export const DEFAULT_OPTS = {
  // Initial probe size — start small so books WITHOUT dupes return fast (the
  // common case). The auto-expand loop doubles the lookback each time the run
  // covers the whole probed batch, so a 200+ dupe block is still fully caught
  // — just iteratively. At WINDOW=30 with MAX_EXPANSIONS=8, max coverage =
  // 30 × 2^8 = 7680 pages, plenty for any plausible book.
  window: 30,
  minRunLen: 5,
  minBookPages: 50,
  maxExpansions: 8,
  headConcurrency: 20,
};

// Returns the R2 ETag (MD5 of file content) — the only stable identity signal.
// Retries once on null result — single flaky HEAD mid-run shouldn't truncate
// the dupe block detection.
export async function headOnce(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    if (r.status !== 200) return null;
    const etag = r.headers.get('etag');
    return etag ? etag.replace(/"/g, '') : null;
  } catch { return null; }
}

export async function head(url) {
  const a = await headOnce(url);
  if (a) return a;
  await new Promise(r => setTimeout(r, 150 + Math.random() * 250));
  return headOnce(url);
}

export async function runWithConcurrency(items, worker, concurrency) {
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

/**
 * Detect a byte-identical trailing run on a book's archived pages.
 * @param {import('mongodb').Db} db
 * @param {{ id: string, pages_count: number }} book
 * @param {Partial<typeof DEFAULT_OPTS>} [opts]
 * @returns {Promise<null | { book, dupe_etag, run_len, canonical_page, dupes_to_hide, hit_book_start }>}
 */
export async function findTrailingDupes(db, book, opts = {}) {
  const { window: WINDOW, minRunLen: MIN_RUN_LEN, maxExpansions: MAX_EXPANSIONS, headConcurrency: HEAD_CONCURRENCY } = { ...DEFAULT_OPTS, ...opts };

  // Auto-expand: start with WINDOW, double the lookback each time the run
  // covers the whole probed range, up to MAX_EXPANSIONS times. This handles
  // books like Secret Doctrine where 200+ pages are identical.
  let lookback = WINDOW;
  let lastEtag = null;
  let totalRunLen = 0;
  let allRunPages = [];

  for (let exp = 0; exp <= MAX_EXPANSIONS; exp++) {
    const end = book.pages_count - totalRunLen;
    const start = Math.max(1, end - lookback + 1);
    if (start >= end) break;
    const pages = await db.collection('pages')
      .find({ book_id: book.id, page_number: { $gte: start, $lte: end } })
      .sort({ page_number: 1 })
      .project({ _id: 1, page_number: 1, archived_photo: 1 })
      .toArray();
    if (pages.length === 0) break;

    const probes = pages.map(p => p.archived_photo?.startsWith('https://') ? p.archived_photo : null);
    const sizes = await runWithConcurrency(probes, u => u ? head(u) : null, HEAD_CONCURRENCY);

    if (lastEtag === null) {
      lastEtag = sizes[sizes.length - 1];
      if (!lastEtag) return null;
    }

    // Walk backward through this batch, counting pages that match lastEtag.
    // Tolerate up to 2 consecutive nulls (probe flakes) so a single failed
    // HEAD mid-run doesn't artificially truncate the dupe block.
    let batchRun = 0;
    let consecutiveNulls = 0;
    for (let i = sizes.length - 1; i >= 0; i--) {
      const s = sizes[i];
      if (s === lastEtag) { batchRun++; consecutiveNulls = 0; }
      else if (s === null && consecutiveNulls < 2) { batchRun++; consecutiveNulls++; }
      else break;
    }
    if (batchRun === 0) break;

    // Prepend the matching pages from this batch to allRunPages
    allRunPages = pages.slice(pages.length - batchRun).concat(allRunPages);
    totalRunLen += batchRun;

    // If we didn't consume the whole batch, the upstream boundary is found
    if (batchRun < pages.length) break;
    // If first page in this batch is page 1, we've hit the start of the book
    if (start === 1) break;
    // Otherwise, expand window and continue probing further back
    lookback = Math.min(lookback * 2, 10000);
  }

  if (totalRunLen < MIN_RUN_LEN) return null;

  const keepPageNumber = book.pages_count - totalRunLen;
  const canonical_page = keepPageNumber > 0
    ? await db.collection('pages').findOne({ book_id: book.id, page_number: keepPageNumber }, { projection: { _id: 1, page_number: 1, archived_photo: 1 } })
    : null;

  return {
    book,
    dupe_etag: lastEtag,
    run_len: totalRunLen,
    canonical_page,
    dupes_to_hide: allRunPages,
    hit_book_start: allRunPages[0]?.page_number === 1,
  };
}

/**
 * Hide a list of pages by negating their page_number. Reversible.
 * @returns {Promise<{ matched: number, modified: number }>}
 */
export async function applyHide(db, dupes_to_hide) {
  if (dupes_to_hide.length === 0) return { matched: 0, modified: 0 };
  // bulkWrite so each page is set to its own -|n| (updateMany can't set per-doc values).
  const ops = dupes_to_hide.map(p => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { page_number: -Math.abs(p.page_number), updated_at: new Date(), hidden_reason: 'ia_trailing_dupe' } },
    },
  }));
  const r = await db.collection('pages').bulkWrite(ops, { ordered: false });
  return { matched: r.matchedCount, modified: r.modifiedCount };
}
