import type { Metadata } from 'next';

// Auth pages must never be cached (Cloudflare or Vercel ISR) to avoid
// hydration mismatches and stale CSRF tokens.
export const dynamic = 'force-dynamic';

// Sign-in, confirm, verify and error screens are not reading pages: keep them
// out of search results (#6398 — ~200 Google landings/30d on /auth/*). The
// noindex only works if Google can fetch the page, so /auth/ is NOT in the
// robots.txt disallow list (a blocked URL can still be indexed from links).
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
