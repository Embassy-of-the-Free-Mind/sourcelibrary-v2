import type { NextConfig } from "next";
import { withBotId } from 'botid/next/config';
import { withPostHogConfig } from '@posthog/nextjs-config';
import collectionRedirects from './src/lib/collection-redirects.json';
import { CSP_IMG_SRC } from './src/lib/csp-img-hosts';

const nextConfig: NextConfig = {
  reactCompiler: true,
  staticPageGenerationTimeout: 180, // Allow 3min for build-time pages (Atlas can be slow under load)
  trailingSlash: false, // Normalize URLs to prevent duplicate content (no trailing slash)
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB // TODO: Remove if frontend logic changes to smaller uploads at a time.
  },
  // pdfkit must stay an unbundled runtime require: bundling it rewrites
  // __dirname to a literal /ROOT/... path, so its constructor's
  // readFileSync(__dirname + '/data/Helvetica.afm') throws ENOENT in
  // production and every pdf-* download 500s ("Download failed", feedback
  // 2026-07-21). Externalizing keeps the real node_modules/pdfkit on disk,
  // .afm metrics and all. Local dev never catches this — node_modules is
  // present there — so verify PDF downloads on a deploy after touching this.
  serverExternalPackages: ['pdfkit'],
  // Belt-and-suspenders for the pdf-translation/pdf-facsimile download formats
  // (issue #3283): src/lib/pdf-fonts.ts reads the bundled Noto Serif TTFs via
  // a static `path.join(process.cwd(), 'src/assets/fonts/…')`, which Vercel's
  // build-time file tracer should already pick up automatically — this pins
  // it explicitly in case static analysis ever misses it. The pdfkit data pin
  // is the same insurance for the externalized package's font metrics.
  outputFileTracingIncludes: {
    '/api/books/[id]/download': ['./src/assets/fonts/**', './node_modules/pdfkit/js/data/**'],
    '/api/[tenant]/books/[id]/download': ['./src/assets/fonts/**', './node_modules/pdfkit/js/data/**'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [75, 80, 85, 90],
    minimumCacheTTL: 31536000, // 1 year — R2 images are immutable, maximize CDN cache hits
    deviceSizes: [640, 828, 1200, 1920], // Matches grid breakpoints: mobile, tablet, desktop, wide
    imageSizes: [150, 400, 800], // Matches thumbnail tiers: thumb, card, display
    remotePatterns: [
      // Cloudflare R2 (primary image storage)
      { protocol: 'https', hostname: 'images.sourcelibrary.org' },
      { protocol: 'https', hostname: 'pub-466c3b04936d401bb77b8978960b60c5.r2.dev' },
      // Vercel Blob CDN (legacy — kept during migration)
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      // AWS S3 (legacy book data)
      { protocol: 'https', hostname: '**.amazonaws.com' },
      // Internet Archive (IIIF images & downloads)
      { protocol: 'https', hostname: 'iiif.archive.org' },
      { protocol: 'https', hostname: 'archive.org' },
      // National Diet Library, Japan (IIIF) — hotlink-walled, so images
      // must be archived to R2; keep in sync with ARCHIVABLE_SOURCES.
      { protocol: 'https', hostname: 'dl.ndl.go.jp' },
      // Gallica (BnF)
      { protocol: 'https', hostname: 'gallica.bnf.fr' },
      // MDZ (Bavarian State Library)
      { protocol: 'https', hostname: 'api.digitale-sammlungen.de' },
      // e-rara (Swiss rare books)
      { protocol: 'https', hostname: 'www.e-rara.ch' },
      // Vatican Library
      { protocol: 'https', hostname: 'digi.vatlib.it' },
      // Bodleian (Oxford)
      { protocol: 'https', hostname: 'iiif.bodleian.ox.ac.uk' },
      { protocol: 'https', hostname: 'digital.bodleian.ox.ac.uk' },
      // Cambridge Digital Library
      { protocol: 'https', hostname: 'cudl.lib.cam.ac.uk' },
      // HAB Wolfenbüttel
      { protocol: 'https', hostname: 'diglib.hab.de' },
      // Wellcome Collection
      { protocol: 'https', hostname: 'iiif.wellcomecollection.org' },
      // Patrimonio Nacional (Spain)
      { protocol: 'https', hostname: 'imagenes.patrimonionacional.es' },
      // Library of Congress
      { protocol: 'https', hostname: '**.loc.gov' },
      // HathiTrust
      { protocol: 'https', hostname: 'babel.hathitrust.org' },
      // British Library (IIIF via Digirati)
      { protocol: 'https', hostname: 'bl.digirati.io' },
      // British Library Endangered Archives Programme
      { protocol: 'https', hostname: 'images.eap.bl.uk' },
      // Wikimedia Commons (Wikipedia images for collection thumbnails)
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      // Cambridge University Library
      { protocol: 'https', hostname: 'images.lib.cam.ac.uk' },
      // e-codices (Swiss manuscripts)
      { protocol: 'https', hostname: 'www.e-codices.unifr.ch' },
      // Laurentian Library / Florence (OCLC ContentDM)
      { protocol: 'https', hostname: 'cdm21059.contentdm.oclc.org' },
      // Leiden University
      { protocol: 'https', hostname: 'iiif.universiteitleiden.nl' },
      // Manchester University
      { protocol: 'https', hostname: 'image.digitalcollections.manchester.ac.uk' },
      // Heidelberg University
      { protocol: 'https', hostname: 'digi.ub.uni-heidelberg.de' },
      // Qatar Digital Library
      { protocol: 'https', hostname: 'iiif.qdl.qa' },
      // Portugal National Library
      { protocol: 'https', hostname: 'permalinkbnd.bnportugal.gov.pt' },
      // CDLI (Cuneiform Digital Library)
      { protocol: 'https', hostname: 'cdli.earth' },
      // University of Amsterdam (UBA)
      { protocol: 'https', hostname: 'images.uba.uva.nl' },
    ],
  },
  async headers() {
    return [
      // Security headers (all routes)
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // X-Frame-Options is handled dynamically in proxy.ts so that
          // /book/* and /collections/* can be embedded by allowlisted partners.
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              // Next.js requires 'unsafe-inline' for styles and 'unsafe-eval' for dev; in prod we need 'unsafe-inline' for React inline styles
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://translate.google.com https://translate.googleapis.com https://www.googletagmanager.com https://analytics.ahrefs.com https://eu-assets.i.posthog.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://translate.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + all configured remote image sources + data URIs for base64 thumbnails.
              // Host list lives in src/lib/csp-img-hosts.ts (shared with getBookThumbnailUrl's
              // renderability screen — edit it there, never inline here).
              CSP_IMG_SRC,
              // images.sourcelibrary.org is in img-src for rendering, but a
              // DOWNLOAD reads the bytes with fetch() — that is connect-src, and
              // its absence here silently killed both gallery download buttons
              // (with the R2 bucket's missing CORS header, #4630).
              "connect-src 'self' https://images.sourcelibrary.org https://*.supabase.co https://generativelanguage.googleapis.com https://translate.googleapis.com wss://*.supabase.co https://api.elevenlabs.io wss://*.elevenlabs.io https://www.google-analytics.com https://region1.google-analytics.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://analytics.ahrefs.com",
              "media-src 'self' blob: https://api.elevenlabs.io https://images.sourcelibrary.org",
              "frame-src 'self' https://translate.google.com",
              "worker-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Prevent Cloudflare from serving RSC flight data as HTML.
          // Next.js uses these headers for client-side navigation — without Vary,
          // CF caches the RSC payload and serves it to fresh page loads as raw text.
          { key: 'Vary', value: 'RSC, Next-Router-State-Tree, Next-Router-Prefetch' },
          // Text-and-data-mining reservation (TDMRep / EU DSM Art. 4 opt-out).
          // Expressly reserves AI-training / TDM rights site-wide in a
          // machine-readable way; the policy URL explains the separate license
          // required for training use. Mirrors /.well-known/tdmrep.json and the
          // robots.ts training-crawler reservation. See /licensing.
          { key: 'TDM-Reservation', value: '1' },
          { key: 'TDM-Policy', value: 'https://sourcelibrary.org/licensing' },
        ],
      },
      // CORS for the PUBLIC READ API (#4491). /developers advertises "direct
      // HTTP access, no authentication", but without these headers a browser
      // app on another domain cannot call any of it — only server-side callers
      // could. Scoped to the public read surface, NOT blanket /api: auth,
      // admin, and write routes keep the browser same-origin default.
      // `Access-Control-Allow-Origin: *` never enables credentialed requests
      // (browsers refuse to send cookies to a `*` origin), so cookie-gated
      // routes gain nothing even if a path were added here by mistake.
      // POST is for /api/mcp (JSON-RPC); the Mcp-* headers are its session
      // protocol, exposed so browser MCP clients can read the session id.
      {
        source: '/api/:root(search|books|gallery|collections|catalog|verify|mcp|image|locus|ngrams|openapi|dataset|works|libraries|vectors)/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version' },
          { key: 'Access-Control-Expose-Headers', value: 'Mcp-Session-Id' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
      // Prevent Cloudflare from caching RSC (React Server Component) responses.
      // CF Free ignores Vary: RSC, so an RSC payload can poison the cache and
      // get served to browsers as raw flight data instead of HTML.
      // This rule sets CDN-Cache-Control: no-store for any request with the RSC header.
      {
        source: '/:path*',
        has: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'no-store' }],
      },
      {
        // Short TTL for embed scripts so partner sites pick up fixes within minutes.
        // stale-while-revalidate means no latency hit during revalidation.
        source: '/embed/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=3600' },
        ],
      },
      // CDN-Cache-Control for Cloudflare edge caching.
      // Cloudflare strips this header before sending to browsers —
      // it only controls Cloudflare's edge cache behavior.
      // Admin/auth/API routes are excluded by Cloudflare Cache Rules (bypass).
      // The `missing` condition ensures these only apply to non-RSC requests
      // (RSC requests are handled by the no-store rule above).
      {
        source: '/book/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      // Editor-only hidden-book preview routes are force-dynamic + auth-gated and
      // MUST NOT be edge-cached — a cached editor 200 would leak to anon users.
      // Placed AFTER the broad /book rule so these specific paths override it.
      {
        source: '/book/:id/preview',
        headers: [{ key: 'CDN-Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/book/:id/page/:pageId/preview',
        headers: [{ key: 'CDN-Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/collections/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/author/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/browse/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/encyclopedia/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/gallery/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/explore/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/libraries/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/languages/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/artwork/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      // Static marketing/info pages. Without an edge TTL these render on every
      // request — a June 2026 scraper flood sent ~1.3M req/day at exactly these
      // pages and all of it reached Vercel.
      {
        source: '/(privacy|terms|dmca|support|sponsors|developers|contribute|beta)',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/about/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      {
        source: '/blog/:path*',
        missing: [{ type: 'header', key: 'rsc' }],
        headers: [{ key: 'CDN-Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=3600' }],
      },
      // Prevent Cloudflare from caching admin/auth routes
      {
        source: '/admin/:path*',
        headers: [{ key: 'CDN-Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/auth/:path*',
        headers: [{ key: 'CDN-Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/account',
        headers: [{ key: 'CDN-Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
  async rewrites() {
    return [
      // robots.txt points to /sitemap.xml. Next.js 16's generateSitemaps()
      // serves chunks at /sitemap/{id}.xml but doesn't auto-create the index
      // at /sitemap.xml. We can't put a route at app/sitemap.xml/route.ts
      // because that directory name collides with Next's internal
      // /sitemap/[__metadata_id__] route and breaks the build, so the
      // index lives at /sitemap-index and we rewrite from /sitemap.xml.
      { source: '/sitemap.xml', destination: '/sitemap-index' },
      // The Source Library beta launch talk (embedded video + audio-aligned
      // transcript) lives in a standalone static deployment. Proxy it on-domain
      // at /launch so the email and site link to sourcelibrary.org, not a
      // *.vercel.app URL. The page sets
      // <base href="https://sourcelib-launch-talk.vercel.app/">, so its relative
      // assets (transcript.json, lecture.mp3, clips/) load from that deployment
      // directly — only the HTML document needs proxying here.
      { source: '/launch', destination: 'https://sourcelib-launch-talk.vercel.app/' },
    ];
  },
  async redirects() {
    return [
      // Merged/retired collection slugs → successors (issue #3002). True HTTP
      // 308s at the routing layer — the page-level permanentRedirect in
      // /collections/[id] only yields a streamed meta-refresh because the
      // shell has already started streaming. Path-relative destinations keep
      // the request host (tenant-subdomain safe).
      ...Object.entries(collectionRedirects as Record<string, string>).map(([from, to]) => ({
        source: `/collections/${from}`,
        destination: `/collections/${to}`,
        permanent: true,
      })),
      {
        source: '/translation/:bookId/:pageId',
        destination: '/book/:bookId',
        permanent: true,
      },
      {
        source: '/library',
        destination: '/search',
        permanent: true,
      },
      {
        source: '/prototype',
        destination: '/',
        permanent: true,
      },
      {
        source: '/libraries/embassy-of-the-free-mind',
        destination: '/libraries/bibliotheca-philosophica-hermetica',
        permanent: true,
      },
      // Ficino Society not yet launched — redirect to support page
      {
        source: '/ficino-society',
        destination: '/support',
        permanent: false,
      },
      {
        source: '/ficino-society/:path*',
        destination: '/support',
        permanent: false,
      },
      // Fundraising outreach links to sourcelibrary.org/call so the emails carry
      // an on-domain URL rather than a raw calendar.app.google one. Points at the
      // 15-minute Google Calendar appointment schedule (the 30-minute page is
      // linked directly from the few drafts that ask for longer). Temporary: the
      // schedule can be rebuilt, which mints a new booking URL.
      {
        source: '/call',
        destination: 'https://calendar.app.google/rh2H63a7JxPkcgR87',
        permanent: false,
      },
      // SHWEP reading room taken down (collection hidden). Keep inbound podcast
      // links off a 404 — temporary so it can be restored.
      {
        source: '/shwep',
        destination: '/collections',
        permanent: false,
      },
      {
        source: '/shwep/:path*',
        destination: '/collections',
        permanent: false,
      },
      // The themed press pages were archived (src/app/_archived/press) when the
      // press room moved to /press-releases, but nothing was left in their place
      // — /press and all six /press/<theme> URLs 404 for inbound links.
      {
        source: '/press',
        destination: '/press-releases',
        permanent: true,
      },
      {
        source: '/press/:path*',
        destination: '/press-releases',
        permanent: true,
      },
      // Embassy → Reading Room → Librarian rename chain
      {
        source: '/embassy',
        destination: '/librarian',
        permanent: true,
      },
      {
        source: '/embassy/thread/:id',
        destination: '/librarian/thread/:id',
        permanent: true,
      },
      {
        source: '/embassy/room/:slug',
        destination: '/librarian/room/:slug',
        permanent: true,
      },
      // Reading Room → Librarian rename
      {
        source: '/reading-room',
        destination: '/librarian',
        permanent: true,
      },
      {
        source: '/reading-room/thread/:id',
        destination: '/librarian/thread/:id',
        permanent: true,
      },
      {
        source: '/reading-room/room/:slug',
        destination: '/librarian/room/:slug',
        permanent: true,
      },
      {
        source: '/reading-room/voice',
        destination: '/librarian/voice',
        permanent: true,
      },
      // Bare list-roots that users hit without a slug — send them somewhere useful
      // instead of 404. Tracked from `not_found_reports`: each gets 10+ distinct
      // IPs per week. `/book` was previously kept as a deliberate 404 (legacy
      // listing route), but `/search` is the closest match to user intent.
      {
        source: '/book',
        destination: '/search',
        permanent: false,
      },
      {
        source: '/author',
        destination: '/search',
        permanent: false,
      },
      {
        source: '/q',
        destination: '/',
        permanent: false,
      },
      // Library-scoped gallery URLs don't exist as routes — gallery is global
      // per the "Source Library is the destination" URL doctrine. Strip the
      // library prefix so external links resolve.
      {
        source: '/libraries/:slug/gallery/:path*',
        destination: '/gallery/:path*',
        permanent: true,
      },
      // Short share links for explore pages
      {
        source: '/map',
        destination: '/explore/map',
        permanent: false,
      },
      {
        source: '/timeline',
        destination: '/explore/timeline',
        permanent: false,
      },
      {
        source: '/constellation',
        destination: '/explore/constellation',
        permanent: false,
      },
    ];
  },
};

// PostHog's config wrapper hard-requires projectId once sourcemaps are
// enabled, and those env vars only exist on Vercel — with the wrapper applied
// unconditionally, `next dev` throws "projectId is required when sourcemaps
// are enabled" on every local checkout. Sourcemap upload is a build/deploy
// concern, so only wrap when the PostHog credentials are actually present.
const withAnalytics = (config: typeof nextConfig) =>
  process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID
    ? withPostHogConfig(config, {
        personalApiKey: process.env.POSTHOG_API_KEY,
        projectId: process.env.POSTHOG_PROJECT_ID,
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        sourcemaps: {
          enabled: true,
          deleteAfterUpload: true,
        },
      })
    : config;

export default withBotId(withAnalytics(nextConfig));
