/**
 * PRIOR ART: scripts/maintenance/delete-stale-embeddings.mjs — checks clip_embeddings.book_id
 * against `books` only (row-level orphans by BOOK), never against the gallery row the id names,
 * so a row that points at the WRONG existing book passes it. scripts/backfill-clip-embeddings.mjs
 * and scripts/clip-find-duplicates.mjs read the index and never compare book_id to anything.
 *
 * clip-index-scan — one paginated pass over the CLIP gallery index, joined to its truth (#5195).
 *
 * `clip_embeddings` is a CACHE of `gallery_images` (and, for covers/artworks, of `books`). Every
 * gallery row in the index is keyed `gallery-<page_id>-<detection_index>` and carries a
 * denormalised `book_id`. When a book is re-minted, merged, or re-split after the embedding was
 * written, the index keeps the old `book_id` and nothing errors: /identify sent a confirmed match
 * to a 404 that way (#3193, #5195). The read side now hydrates `book_id` from the gallery row
 * (PR #5196), but the index itself still has to be kept true for every other reader.
 *
 * This module does the JOIN once, shared by the standing audit (scripts/audit/clip-index-integrity.mjs)
 * and the repair (scripts/maintenance/clip-index-repair.mjs), so the two can never disagree on
 * what "drift" means. READ-ONLY.
 *
 * Findings, per gallery CLIP row:
 *   drift    — a gallery row exists and its book_id differs from the index row's
 *   orphan   — no gallery row with that id; classified by what is left of it:
 *                book-deleted    the book is in deleted_books
 *                book-gone       no books row (by id OR _id) and no deleted_books row
 *                page-gone       the book exists but the page id no longer resolves (re-split / re-import)
 *                page-reindexed  the page exists and has OTHER gallery rows (detection re-run, new indexes)
 *                page-no-gallery the page exists and has NO gallery rows (detections demoted / cleared)
 *   missing  — the other direction: a gallery row with a crop (extracted_url) and no index row
 *
 * Cautions baked in (from the incidents in CLAUDE.md):
 *   - supabase-js caps every response at 1,000 rows silently: paginate with .range() AND .order(),
 *     since an unordered range walk can skip or repeat rows between pages.
 *   - Never select `embedding` in a full scan (350K+ rows × 512 floats).
 *   - Books are looked up by `id` OR `_id` — 16,343 books have a re-minted `_id`.
 *   - A probe must fire before its zero is believed: the scan throws if the join never matches.
 */

const PAGE = 1000;
const MONGO_CHUNK = 2000;

/** Load `id, book_id, source_type` for every clip_embeddings row (no embedding column). */
export async function loadClipRows(sb, { sourceType = null, log = () => {} } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from('clip_embeddings').select('id,book_id,source_type').order('id').range(from, from + PAGE - 1);
    if (sourceType) q = q.eq('source_type', sourceType);
    const { data, error } = await q;
    if (error) throw new Error(`clip_embeddings page ${from}: ${error.message}`);
    rows.push(...data);
    if (rows.length % 50000 < PAGE) log(`  loaded ${rows.length} index rows`);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Load every book's `id` and `_id` (both are valid keys) with title/author/visible for hydration. */
export async function loadBookMap(db) {
  const byKey = new Map();
  const cur = db.collection('books').find({}, { projection: { _id: 1, id: 1, title: 1, display_title: 1, author: 1, visible: 1 } });
  for await (const b of cur) {
    const rec = { id: b.id || String(b._id), title: b.display_title || b.title, author: b.author, visible: b.visible };
    if (b.id) byKey.set(String(b.id), rec);
    byKey.set(String(b._id), rec);
  }
  return byKey;
}

export function galleryIdOf(clipId) {
  return clipId.replace(/^gallery-/, '');
}

/** `<page_id>-<detection_index>` → page_id (the index is the trailing integer). */
export function pageIdOf(galleryId) {
  const m = galleryId.match(/^(.*)-(\d+)$/);
  return m ? m[1] : galleryId;
}

/**
 * Join the gallery index rows to gallery_images and classify. Returns
 * { checked, joined, drift: [...], orphans: [...], byClass, driftByClipBook }.
 * `clipRows` must be gallery_image rows from loadClipRows.
 */
export async function scanGalleryIndex(db, clipRows, { classify = true, log = () => {} } = {}) {
  const gallery = db.collection('gallery_images');
  const drift = [];
  const orphanIds = [];
  let joined = 0;
  for (let i = 0; i < clipRows.length; i += MONGO_CHUNK) {
    const chunk = clipRows.slice(i, i + MONGO_CHUNK);
    const ids = chunk.map(r => galleryIdOf(r.id));
    const docs = await gallery.find(
      { id: { $in: ids } },
      { projection: { _id: 0, id: 1, book_id: 1, page_id: 1, description: 1, book_title: 1, book_author: 1 } },
    ).toArray();
    const m = new Map(docs.map(d => [d.id, d]));
    for (const r of chunk) {
      const g = m.get(galleryIdOf(r.id));
      if (!g) { orphanIds.push(r.id); continue; }
      joined++;
      if (g.book_id !== r.book_id) {
        drift.push({ id: r.id, clip_book: r.book_id, gallery_book: g.book_id, page_id: g.page_id, description: g.description, book_title: g.book_title, book_author: g.book_author });
      }
    }
    if ((i / MONGO_CHUNK) % 25 === 0) log(`  joined ${Math.min(i + MONGO_CHUNK, clipRows.length)}/${clipRows.length}`);
  }
  // Positive control: the join must have fired at least once, or every "orphan" is a broken probe.
  if (clipRows.length > 0 && joined === 0) {
    throw new Error('clip-index-scan: the gallery join matched 0 of ' + clipRows.length + ' rows — probe did not fire (id shape or collection changed?)');
  }

  const driftByClipBook = new Map();
  for (const d of drift) driftByClipBook.set(d.clip_book, (driftByClipBook.get(d.clip_book) || 0) + 1);

  const orphans = classify ? await classifyOrphans(db, clipRows, orphanIds, log) : orphanIds.map(id => ({ id }));
  const byClass = {};
  for (const o of orphans) byClass[o.class || 'unclassified'] = (byClass[o.class || 'unclassified'] || 0) + 1;

  return { checked: clipRows.length, joined, drift, orphans, byClass, driftByClipBook };
}

async function classifyOrphans(db, clipRows, orphanIds, log) {
  if (orphanIds.length === 0) return [];
  const bookOf = new Map(clipRows.map(r => [r.id, r.book_id]));
  const pageIds = [...new Set(orphanIds.map(id => pageIdOf(galleryIdOf(id))))];
  const bookIds = [...new Set(orphanIds.map(id => bookOf.get(id)).filter(Boolean))];
  log(`  classifying ${orphanIds.length} orphans: ${pageIds.length} pages, ${bookIds.length} books`);

  const pageExists = new Set();
  const pageHasGallery = new Set();
  for (let i = 0; i < pageIds.length; i += MONGO_CHUNK) {
    const chunk = pageIds.slice(i, i + MONGO_CHUNK);
    for (const p of await db.collection('pages').find({ id: { $in: chunk } }, { projection: { _id: 0, id: 1 } }).toArray()) pageExists.add(p.id);
    for (const pid of await db.collection('gallery_images').distinct('page_id', { page_id: { $in: chunk } })) pageHasGallery.add(pid);
  }
  const books = await loadBookMap(db);
  const deleted = new Set();
  for (let i = 0; i < bookIds.length; i += MONGO_CHUNK) {
    const chunk = bookIds.slice(i, i + MONGO_CHUNK);
    for (const d of await db.collection('deleted_books').find({ id: { $in: chunk } }, { projection: { _id: 0, id: 1 } }).toArray()) deleted.add(d.id);
  }

  return orphanIds.map(id => {
    const gid = galleryIdOf(id);
    const pid = pageIdOf(gid);
    const bid = bookOf.get(id);
    let cls;
    if (bid && !books.has(bid)) cls = deleted.has(bid) ? 'book-deleted' : 'book-gone';
    else if (!pageExists.has(pid)) cls = 'page-gone';
    else if (pageHasGallery.has(pid)) cls = 'page-reindexed';
    else cls = 'page-no-gallery';
    return { id, book_id: bid, page_id: pid, class: cls };
  });
}

/** Gallery rows with a crop that have no index row at all (coverage gap, the other direction). */
export async function findMissingFromIndex(db, clipRows) {
  const have = new Set(clipRows.map(r => galleryIdOf(r.id)));
  const cur = db.collection('gallery_images').find(
    { extracted_url: { $exists: true, $ne: null } },
    { projection: { _id: 0, id: 1, book_id: 1, book_visible: 1 } },
  );
  let withCrop = 0;
  const missing = [];
  for await (const g of cur) {
    withCrop++;
    if (!have.has(g.id)) missing.push({ id: g.id, book_id: g.book_id, book_visible: g.book_visible });
  }
  return { withCrop, missing };
}
