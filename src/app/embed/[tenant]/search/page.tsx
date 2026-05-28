import SearchPage from '@/app/search/page';

// Iframe-target wrapper. Tenant subdomains like bph.sourcelibrary.org get
// their /search?q=… requests rewritten by src/proxy.ts to
// /embed/[tenant]/search?q=… — this route is the landing pad. Without it the
// rewrite produces a hard 404 (observed in not_found_reports: ?q=boehme,
// ?q=rosicrucian, ?q=Hartmann all firing this URL).
//
// The root SearchPage already reads tenant context from request headers
// (set by proxy.ts) and renders embed-mode UI accordingly, so a thin
// re-export gives partner subdomains a working search results page.

export default function EmbedSearchPage() {
  return <SearchPage forceEmbedded={true} />;
}
