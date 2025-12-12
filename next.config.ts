import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
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
};

export default nextConfig;
