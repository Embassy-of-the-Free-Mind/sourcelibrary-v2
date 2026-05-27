'use client';

// Tenant subdomains route /search here (see src/proxy.ts).
// usePathname() on the client returns the original URL (the proxy rewrite is
// invisible), so useEmbed() can't auto-detect embed mode. Pass forceEmbedded
// explicitly so the page hides global chrome (SiteHeader) and cross-tenant
// filters (Library partner selector).
import SearchPage from '@/app/search/page';

export default function EmbedTenantSearchPage() {
  return <SearchPage forceEmbedded />;
}
