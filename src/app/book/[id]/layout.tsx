'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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

  return children;
}
