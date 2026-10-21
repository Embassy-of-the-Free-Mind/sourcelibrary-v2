import { sitemapIndexResponse } from '@/lib/sitemap-index';

// /sitemap-core.xml (rewritten here in next.config.ts): hubs and books only,
// submitted to Search Console on its own (#3755). See src/lib/sitemap-index.ts.

export const revalidate = 3600;

export async function GET() {
  return sitemapIndexResponse({ core: true });
}
