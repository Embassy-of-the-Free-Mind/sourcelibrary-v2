import type { Metadata } from "next";
import "./globals.css";
import ConditionalFooter from "@/components/layout/ConditionalFooter";
import Providers from "@/components/providers/Providers";
import PageTracker from "@/components/reader/PageTracker";
import BrokenImageReporter from "@/components/BrokenImageReporter";
import SiteModeIndicator from "@/components/providers/SiteModeIndicator";
import ClientToaster from "@/components/providers/ClientToaster";
import CookieConsent from "@/components/providers/CookieConsent";
import AnalyticsScripts from "@/components/providers/AnalyticsScripts";
import EmbedLinkInterceptor from "@/components/embed/EmbedLinkInterceptor";
import EmbedHostNavigationListener from "@/components/embed/EmbedHostNavigationListener";
import EmbedHistoryPatch from "@/components/embed/EmbedHistoryPatch";
import ScrollReveal from "@/components/layout/ScrollReveal";



// Synchronous, host-aware view-mode init. Runs during HTML parsing before
// any content paints, so gated sections never flash. Kept inline + minified
// so it ships in the initial HTML and needs no separate request.
//
// AI summaries / introductions default to HIDDEN on the BPH reading room
// (host bph.* or path /embed/bph/*) — BPH scholars distrust AI-written prose
// over primary sources, so the partner surface leads without it. A visitor
// can still opt in via the gear menu (sl_hide_ai=0). The cookie is tri-state:
// '1'=hide, '0'=show, absent=default (BPH hides; main site + other tenants
// show). We distinguish the two ways AI prose ends up hidden by writing
// data-sl-hide-ai="1" for an EXPLICIT opt-out vs "default" for the BPH
// implicit default. Most AI surfaces (book intros, reading guides) hide on
// either. The catalogue summary is the exception: its works have been
// editorially reviewed, so it shows under the BPH default and hides only on
// an explicit opt-out — globals.css keys that off the "1" value alone.
// Reading-guide toggle is unchanged (default show, hide only on explicit
// sl_hide_guide=1). The CSS rules in globals.css consume the data attributes
// set here. Must live in the ROOT layout (not embed/layout): the real BPH
// subdomain serves the global /book/[id] route directly (proxy adds
// x-tenant-* headers, no /embed rewrite), so the embed layout never wraps it.
// Detection is client-side by hostname to stay ISR-safe — the HTML is
// host-agnostic and cached; this script self-determines at runtime.
// Must mirror the detection in EmbedUserMenu.tsx.
const VIEW_MODE_INIT_SCRIPT = `(function(){var d=document,c=d.cookie,h=location.hostname,p=location.pathname;var bph=/^bph\\./.test(h)||/^\\/embed\\/bph(\\/|$)/.test(p);var m=c.match(/(?:^|; )sl_hide_ai=([01])/);var v=m?m[1]:(bph?'d':null);if(v==='1')d.documentElement.dataset.slHideAi='1';else if(v==='d')d.documentElement.dataset.slHideAi='default';if(/(?:^|; )sl_hide_guide=1/.test(c))d.documentElement.dataset.slHideGuide='1';try{var emb=(window.self!==window.top)||/^\\/embed\\//.test(p)||(/\\.sourcelibrary\\.(org|com|net)$/.test(h)&&h.split('.').length>=3&&h.indexOf('www.')!==0);if(emb)d.documentElement.dataset.embedded='1';}catch(e){d.documentElement.dataset.embedded='1';}})();`;

export const metadata: Metadata = {
  title: "Source Library — Ancient Texts Translated to English",
  description: "Digitizing and translating ancient texts for scholars, seekers and AI systems.",
  metadataBase: new URL('https://sourcelibrary.org'),
  alternates: {
    canonical: '/',
    types: {
      'application/atom+xml': [
        { url: '/api/feed/books', title: 'Source Library - New Books' },
        { url: '/api/feed/gallery', title: 'Source Library Gallery' },
        { url: '/api/feed/blog', title: 'Source Library - Research Notes' },
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
    'msapplication-TileColor': '#1a1612',
    'pinterest-rich-pin': 'true',
    // TDMRep in-document form (embedded so the reservation survives archiving
    // and dataset snapshots, which strip the equivalent HTTP headers set in
    // next.config.ts). See https://sourcelibrary.org/licensing
    'tdm-reservation': '1',
    'tdm-policy': 'https://sourcelibrary.org/licensing',
  },
  openGraph: {
    siteName: "Source Library",
    locale: "en_US",
    type: "website",
    url: "https://sourcelibrary.org/",
    images: [{
      url: '/og-image.jpg',
      width: 1200,
      height: 630,
      alt: 'Source Library — Digitizing and translating ancient texts',
    }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@SourceLibrary_",
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
        <script dangerouslySetInnerHTML={{ __html: VIEW_MODE_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="Source Library"
          href="/opensearch.xml"
        />
        {/* Analytics scripts loaded conditionally via AnalyticsScripts (consent-gated) */}
      </head>
      <body className="antialiased min-h-screen flex flex-col" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>
          <EmbedLinkInterceptor />
          <EmbedHostNavigationListener />
          <EmbedHistoryPatch />
          <div id="main-content" className="flex-1">
            {children}
          </div>
          <ScrollReveal />
          <ConditionalFooter />
          <SiteModeIndicator />
        </Providers>
        <ClientToaster />
        <CookieConsent />
        <AnalyticsScripts />
        <PageTracker />
        <BrokenImageReporter />
      </body>
    </html>
  );
}
