import type { NextConfig } from "next";
import { withBotId } from 'botid/next/config';

const nextConfig: NextConfig = {
  reactCompiler: true,
  staticPageGenerationTimeout: 180, // Allow 3min for build-time pages (Atlas can be slow under load)
  trailingSlash: false, // Normalize URLs to prevent duplicate content (no trailing slash)
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB // TODO: Remove if frontend logic changes to smaller uploads at a time.
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://translate.google.com https://translate.googleapis.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://translate.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + all configured remote image sources + data URIs for base64 thumbnails
              "img-src 'self' data: blob: https://images.sourcelibrary.org https://*.r2.dev https://*.public.blob.vercel-storage.com https://*.amazonaws.com https://iiif.archive.org https://archive.org https://gallica.bnf.fr https://api.digitale-sammlungen.de https://www.e-rara.ch https://digi.vatlib.it https://*.bodleian.ox.ac.uk https://cudl.lib.cam.ac.uk https://diglib.hab.de https://iiif.wellcomecollection.org https://upload.wikimedia.org https://*.loc.gov https://babel.hathitrust.org https://bl.digirati.io https://images.lib.cam.ac.uk https://www.e-codices.unifr.ch https://cdm21059.contentdm.oclc.org https://iiif.universiteitleiden.nl https://image.digitalcollections.manchester.ac.uk https://digi.ub.uni-heidelberg.de https://iiif.qdl.qa https://permalinkbnd.bnportugal.gov.pt https://cdli.earth https://images.uba.uva.nl https://imagenes.patrimonionacional.es https://images.eap.bl.uk https://*.basemaps.cartocdn.com",
              "connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com https://translate.googleapis.com wss://*.supabase.co https://api.elevenlabs.io wss://*.elevenlabs.io",
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
  async redirects() {
    return [
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
      {
        source: '/collections/shwep',
        destination: '/shwep',
        permanent: false,
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

export default withBotId(nextConfig);
