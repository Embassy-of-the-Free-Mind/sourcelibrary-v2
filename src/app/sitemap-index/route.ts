import { sitemapIndexResponse } from '@/lib/sitemap-index';

// Next.js 16's generateSitemaps() (in src/app/sitemap.ts) produces chunks at
// /sitemap/{id}.xml but does NOT serve a sitemap-index at /sitemap.xml — so
// robots.txt (which points to /sitemap.xml) was returning 404 and the 17K
// book URLs in the chunks were undiscoverable.
//
// Lives at /sitemap-index (not /sitemap.xml/) because Next's metadata route
// for sitemap.ts uses /sitemap/[__metadata_id__], which collides with a
// sibling /sitemap.xml/ directory and breaks `Collecting page data` at build
// time. next.config.ts rewrites /sitemap.xml → /sitemap-index so external
// crawlers see the canonical path. The builder lives in src/lib/sitemap-index.ts,
// shared with /sitemap-core (served as /sitemap-core.xml).

export const revalidate = 3600;

export async function GET() {
  return sitemapIndexResponse({ core: false });
}
