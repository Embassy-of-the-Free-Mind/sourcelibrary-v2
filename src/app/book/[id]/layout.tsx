'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { TRIPWIRE_PATH } from '@/lib/tripwire';

export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    // Scroll to top when navigating between different book routes (e.g. book detail → page view)
    // Page-to-page navigation within the reader handles its own scrolling
    // to position at the text section on mobile
    if (!pathname.includes('/page/')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [pathname]);

  return (
    <>
      {children}
      {/* Tripwire (#5995, src/lib/tripwire.ts): invisible, untabbable, and
          robots-disallowed, so only a scraper ignoring robots.txt follows it.
          A plain <a>, not next/link — Link would prefetch it for real readers. */}
      <a href={TRIPWIRE_PATH} hidden aria-hidden="true" tabIndex={-1} rel="nofollow">
        Complete catalogue
      </a>
    </>
  );
}
