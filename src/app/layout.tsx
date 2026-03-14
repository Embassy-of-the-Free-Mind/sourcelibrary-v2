import type { Metadata } from "next";
import "./globals.css";
import GlobalFooter from "@/components/layout/GlobalFooter";
import Providers from "@/components/providers/Providers";
import { GoogleAnalytics } from "@next/third-parties/google";
import Script from "next/script";
import PageTracker from "@/components/reader/PageTracker";
import SiteModeIndicator from "@/components/providers/SiteModeIndicator";
import ClientToaster from "@/components/providers/ClientToaster";


export const metadata: Metadata = {
  title: "Source Library",
  description: "Digitizing and translating ancient texts for scholars, seekers and AI systems.",
  metadataBase: new URL('https://sourcelibrary.org'),
  alternates: {
    canonical: '/',
    types: {
      'application/atom+xml': [
        { url: '/api/feed/books', title: 'Source Library - New Books' },
        { url: '/api/feed/gallery', title: 'Source Library Gallery' },
      ],
    },
  },
  keywords: [
    'Hermetic texts',
    'alchemy',
    'Renaissance philosophy',
    'esotericism',
    'digital humanities',
    'historical translations',
    'Latin manuscripts',
    'occult philosophy',
    'early modern science',
    'primary sources',
  ],
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  },
  other: {
    'msapplication-TileColor': '#1c1917',
    'pinterest-rich-pin': 'true',
  },
  openGraph: {
    title: "Source Library",
    description: "Digitizing and translating ancient texts for scholars, seekers and AI systems.",
    siteName: "Source Library",
    locale: "en_US",
    type: "website",
    images: [{
      url: '/og-image.jpg',
      width: 1200,
      height: 630,
      alt: 'Source Library — Digitizing and translating ancient texts',
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Source Library",
    description: "Digitizing and translating ancient texts for scholars, seekers and AI systems.",
    images: [{
      url: '/og-image.jpg',
      width: 1200,
      height: 630,
      alt: 'Source Library — Digitizing and translating ancient texts',
    }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Site mode detection moved to client-side (SiteModeProvider) to avoid
  // calling headers() which opts the entire app out of ISR caching.
  // SiteModeProvider defaults to library mode and self-corrects on the client.

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="Source Library"
          href="/opensearch.xml"
        />
        <Script src="https://analytics.ahrefs.com/analytics.js" data-key="rzuKlnvyAKd8TdooDnPSYg" strategy="lazyOnload" />
      </head>
      <body className="antialiased min-h-screen flex flex-col" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>
          <div id="main-content" className="flex-1">
            {children}
          </div>
          <GlobalFooter />
          <SiteModeIndicator />
        </Providers>
        <ClientToaster />

        <GoogleAnalytics gaId="G-C1QJNTSZT2" />
        <PageTracker />
      </body>
    </html>
  );
}
