import SearchPage from '@/app/search/page';

/**
 * Spanish search — the SAME page as `/search`, rendered with `lang='es'`
 * (#4180). One page, two URLs: the shape the book page set in #4082 phase 2.
 *
 * The data half shipped in #4095: `/api/search?lang=es` searches the Spanish
 * text store, returns Spanish snippets, and narrows every lane to books that
 * HAVE a Spanish edition — so every card here links to a page the reader can
 * actually open, and the `/es/book/…` promise is kept.
 *
 * What this route deliberately does NOT offer, because the lane behind it takes
 * no `lang` and would answer in English under Spanish chrome (i18n.md rule 4 —
 * label or omit, never machine-translate at render time):
 *
 *   - the "All" tab (`/api/search/unified`)
 *   - the "Index" tab (`/api/search/index`, whose entries are English)
 *   - the AI-expand narration (`/api/search/ai-expand`)
 *   - the known-entity capture card (English editorial copy)
 *
 * The gallery tab is KEPT and labelled instead, because the images are the
 * content and only their descriptions are an English index.
 *
 * Known gap, tracked in #4146: the 67 books WRITTEN in Spanish have no
 * `page_texts` rows, so they are visible on /es and still absent from these
 * results. That is a store-side fix, not a page-side one.
 *
 * Metadata and the `<Suspense>` boundary that `useSearchParams` needs live in
 * `layout.tsx`, mirroring `/search`.
 */
export default function EsSearchPage() {
  return <SearchPage lang="es" />;
}
