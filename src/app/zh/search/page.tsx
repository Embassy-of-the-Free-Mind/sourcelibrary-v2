import SearchPage from '@/app/search/page';

/**
 * Chinese search — the SAME page as `/search`, rendered with `lang='zh'`
 * (#7175). See `src/app/la/search/page.tsx`: the same original-text shape,
 * with `language=Chinese`. Classical Chinese stays out, as on `/zh/book/…`
 * (`NATIVE_EDITION_LANGUAGE.zh`).
 */
export default function ZhSearchPage() {
  return <SearchPage lang="zh" />;
}
