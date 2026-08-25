/**
 * When a book leaves `books`, it must leave every serving surface (#4216 —
 * two deleted books kept surfacing in semantic search via stale
 * `book_embeddings` rows and 404'd on click; same class as the
 * takedown-is-nine-surfaces lesson).
 *
 * Prunes the Supabase rows that SERVE search for a book id:
 *   - the four pure-embedding tables (recoverable by re-running the embed
 *     workers — a restore therefore needs re-embedding, which is billed)
 *   - the `books_catalog` listing row (rebuilt by the catalog sync)
 *
 * Deliberately NOT pruned: `page_translations` and `page_texts` — those hold
 * translation/OCR TEXT, not just derived vectors; deleting them destroys
 * content (see scripts/maintenance/delete-stale-embeddings.mjs). Their read
 * paths must gate on book existence instead (the semantic route does since
 * #4217).
 *
 * Best-effort by design: a Supabase failure must never block the Mongo
 * delete the admin asked for. Failures are returned and logged by callers;
 * scripts/maintenance/delete-stale-embeddings.mjs remains the backstop sweep.
 */

import { supabaseAdmin } from '@/lib/supabase';

const EMBEDDING_TABLES = [
  'book_embeddings',
  'artwork_embeddings',
  'gallery_text_embeddings',
  'clip_embeddings',
] as const;

export interface PruneResult {
  table: string;
  error: string | null;
}

export async function pruneSearchRowsForDeletedBook(bookId: string): Promise<PruneResult[]> {
  if (!bookId) return [];
  const results: PruneResult[] = [];

  for (const table of EMBEDDING_TABLES) {
    try {
      const { error } = await supabaseAdmin.from(table).delete().eq('book_id', bookId);
      results.push({ table, error: error?.message ?? null });
    } catch (e) {
      results.push({ table, error: e instanceof Error ? e.message : String(e) });
    }
  }

  try {
    const { error } = await supabaseAdmin.from('books_catalog').delete().eq('id', bookId);
    results.push({ table: 'books_catalog', error: error?.message ?? null });
  } catch (e) {
    results.push({ table: 'books_catalog', error: e instanceof Error ? e.message : String(e) });
  }

  const failed = results.filter(r => r.error);
  if (failed.length > 0) {
    console.error(
      `[prune-deleted-book] ${bookId}: ${failed.map(f => `${f.table}: ${f.error}`).join('; ')} — ` +
      'run scripts/maintenance/delete-stale-embeddings.mjs to catch up',
    );
  }
  return results;
}
