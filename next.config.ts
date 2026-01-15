import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  trailingSlash: false, // Normalize URLs to prevent duplicate content (no trailing slash)
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB // TODO: Remove if frontend logic changes to smaller uploads at a time.
  },
  images: {
    unoptimized: true, // Bypass Vercel image optimization (quota exceeded on free tier)
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'book-translation-data.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'book-translation-data.s3.ap-south-1.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
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
