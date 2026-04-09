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
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // X-Frame-Options is handled dynamically in proxy.ts so that
          // /book/* and /collections/* can be embedded by allowlisted partners.
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Short TTL for embed scripts so partner sites pick up fixes within minutes.
        // stale-while-revalidate means no latency hit during revalidation.
        source: '/embed/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=3600' },
        ],
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
      // Embassy → Reading Room rename
      {
        source: '/embassy',
        destination: '/reading-room',
        permanent: true,
      },
      {
        source: '/embassy/thread/:id',
        destination: '/reading-room/thread/:id',
        permanent: true,
      },
      {
        source: '/embassy/room/:slug',
        destination: '/reading-room/room/:slug',
        permanent: true,
      },
    ];
  },
};

export default withBotId(nextConfig);
