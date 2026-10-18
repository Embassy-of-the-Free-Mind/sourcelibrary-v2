/**
 * The book lane's metadata fallback, matched in memory (#2049).
 *
 * When the catalogue lane finds no book, /api/search tries each content word
 * (`stemmedQueryRegex`) against five fields of every live book: categories,
 * subject_keywords, language, title, display_title. As a MongoDB query that is
 * an unanchored regex over unindexed fields: it FETCHes every live book (42,372
 * on 2026-10-18) and took 0.9–2.2 s on 16 of 40 sampled reader queries, or hit
 * its 3 s maxTimeMS and failed the whole lane, finding a book in 2 of them. The lane was waiting on it for nothing most of the time.
 *
 * This keeps those five fields of every live book in memory per instance
 * (~11 MB over the wire, 1.6–3.0 s to load) and runs the same RegExp objects
 * over them in a few milliseconds. An instance's first fallback starts the load
 * in the background and runs the Mongo query as before, so no search waits for
 * it; after that the snapshot is refreshed in the background every
 * SNAPSHOT_TTL_MS while it is being used. A failed load is not retried for
 * RETRY_AFTER_FAILURE_MS. Rows are held in `browse_default_sort_covered` order,
 * one of the two indexes the Mongo planner picks for that query (it switches
 * between them from run to run), so the match SET is the same and the order is
 * as stable as it was.
 *
 * Staleness: a book made visible less than SNAPSHOT_TTL_MS ago can be missing
 * from the fallback; one hidden since is dropped by the caller's `find`, which
 * re-applies every filter.
 *
 * PRIOR ART: src/lib/books-catalog.ts (searchBookIds) — Supabase trigram
 * search; books_catalog has no index on subject_keywords or language and
 * PostgREST cannot regex an array, so the fallback cannot move there without a
 * schema change. The Atlas `books_search` index does not map subject_keywords
 * and analyses titles into terms, which a substring regex does not match.
 */
import type { Db } from 'mongodb';

const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
const FIELDS = ['categories', 'subject_keywords', 'language', 'title', 'display_title'] as const;
/** The key order of the books index the Mongo fallback read in (forward). */
const INDEX_ORDER = {
  visible: 1, pages_count: 1, 'image_source.provider': 1, pages_translated: 1, quality_score: 1,
  last_translation_at: 1, last_processed: 1, title: 1, id: 1, _id: 1,
} as const;

interface SnapshotRow { id: string; values: string[] }
interface Snapshot { rows: SnapshotRow[]; loadedAt: number }

let current: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
let failedAt = 0;

/** Every string a field holds: the string itself, or each string in an array (as a Mongo regex sees them). */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

async function load(db: Db): Promise<Snapshot> {
  const projection: Record<string, 1 | 0> = { _id: 0, id: 1 };
  for (const f of FIELDS) projection[f] = 1;
  const docs = await db.collection('books')
    .find({ visible: true, pages_count: { $gt: 0 } }, { projection })
    .sort(INDEX_ORDER)
    .batchSize(10000)
    .maxTimeMS(15000)
    .toArray();
  const rows: SnapshotRow[] = [];
  for (const d of docs) {
    if (typeof d.id !== 'string') continue;
    rows.push({ id: d.id, values: FIELDS.flatMap(f => strings(d[f])) });
  }
  return { rows, loadedAt: Date.now() };
}

/** Load (or reload) the snapshot; concurrent callers share one load. */
export function loadBookMetadataSnapshot(db: Db): Promise<Snapshot> {
  if (!loading) {
    loading = load(db)
      .then(s => { current = s; return s; })
      .finally(() => { loading = null; });
  }
  return loading;
}

function refreshInBackground(db: Db): void {
  if (loading || Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return;
  loadBookMetadataSnapshot(db).catch(err => {
    failedAt = Date.now();
    console.warn('[search] book metadata snapshot failed to load:', err instanceof Error ? err.message : String(err));
  });
}

/**
 * Ids of live books where every regex matches at least one of the five fields,
 * in index order, at most `cap` of them. The regexes must be stateless (no `g`
 * or `y` flag), as stemmedQueryRegex's are. Null while the snapshot is not loaded
 * (this call starts the load): the caller then runs the Mongo query as before.
 */
export function matchBookMetadata(db: Db, regexes: RegExp[], cap: number): { ids: string[]; complete: boolean } | null {
  const snap = current;
  if (!snap) {
    refreshInBackground(db);
    return null;
  }
  if (Date.now() - snap.loadedAt > SNAPSHOT_TTL_MS) refreshInBackground(db);
  const ids: string[] = [];
  for (const row of snap.rows) {
    if (regexes.every(rx => row.values.some(v => rx.test(v)))) {
      if (ids.length === cap) return { ids, complete: false };
      ids.push(row.id);
    }
  }
  return { ids, complete: true };
}

/** Test seam: drop the cached snapshot. */
export function resetBookMetadataSnapshot(): void {
  current = null;
  loading = null;
  failedAt = 0;
}
