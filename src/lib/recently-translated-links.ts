// PRIOR ART: src/lib/home-data.ts getRecentlyTranslated() — that one builds the 15-card cover slider through browseBooks()
// (Mongo card-variant join, covers required). This is the lean crawl-surface twin: plain links, no covers, ~48 rows,
// projection-only straight off the Supabase `books_catalog` mirror (#3755).
import { supabase } from '@/lib/supabase';
import { READABLE_IN_ENGLISH_OR } from '@/lib/books-catalog';

export interface RecentLink {
  id: string;
  slug: string | null;
  title: string;
  display_title: string | null;
  author: string | null;
}

/**
 * Books most recently made readable in English, newest first, as bare link data.
 *
 * Same live filter as every public list (`visible` and `pages_count > 0`) plus the
 * `readable_in_english` view (translation-state.md), ordered by `last_translation_at`
 * — the column the homepage slider already sorts on. Artworks are excluded.
 * `collection` narrows to one collection's members; `excludeIds` drops books the
 * page already shows (over-fetched to compensate). Never throws: a failed query
 * is an empty list, so it cannot take down an ISR render.
 */
export async function getRecentlyTranslatedLinks(opts: {
  limit?: number;
  collection?: string;
  excludeIds?: Iterable<string>;
} = {}): Promise<RecentLink[]> {
  const limit = opts.limit ?? 48;
  const exclude = new Set(opts.excludeIds ?? []);
  try {
    let q = supabase
      .from('books_catalog')
      .select('id,slug,title,display_title,author')
      .eq('visible', true)
      .gt('pages_count', 0)
      .is('resource_type', null)
      .or(READABLE_IN_ENGLISH_OR);
    if (opts.collection) q = q.contains('collections', [opts.collection]);
    const { data, error } = await q
      .order('last_translation_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(limit + exclude.size);
    if (error || !data) return [];
    return (data as RecentLink[]).filter((b) => !exclude.has(b.id)).slice(0, limit);
  } catch {
    return [];
  }
}
