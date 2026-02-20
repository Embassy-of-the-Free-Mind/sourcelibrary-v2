import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  trailingSlash: false, // Normalize URLs to prevent duplicate content (no trailing slash)
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB // TODO: Remove if frontend logic changes to smaller uploads at a time.
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Vercel Blob CDN (thumbnails, archived images, extracted illustrations)
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
      // Library of Congress
      { protocol: 'https', hostname: '**.loc.gov' },
      // HathiTrust
      { protocol: 'https', hostname: 'babel.hathitrust.org' },
    ],
  },
  async redirects() {
    return [
      {
        source: '/translation/:bookId/:pageId',
        destination: '/book/:bookId',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
