import SearchPage from '@/app/search/page';

/**
 * Latin search — the SAME page as `/search`, rendered with `lang='la'` (#7175),
 * the shape `/es/search` set (#4180).
 *
 * Latin is an original-text locale (`readsOriginal`): nothing is translated
 * INTO Latin, so the page does not ask for a Latin edition (`lang=la` would
 * find none). It sends `language=Latin&text=original` instead: every result is
 * a book written in Latin, opens at `/la/book/…`, and quotes the page's own
 * Latin, matched with u/v, i/j and ae folded. The lanes that answer only in
 * English (All, Index, AI-expand) stay hidden, as on `/es`.
 *
 * Metadata and the `<Suspense>` boundary live in `layout.tsx`.
 */
export default function LaSearchPage() {
  return <SearchPage lang="la" />;
}
