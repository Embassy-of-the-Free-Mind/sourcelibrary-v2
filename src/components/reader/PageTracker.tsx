'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Don't track admin/internal pages
    if (pathname?.includes('/api/') || pathname?.includes('/admin/')) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const blob = new Blob([JSON.stringify({
          event: 'pageview',
          properties: {
            path: pathname,
            referrer: document.referrer,
            userAgent: navigator.userAgent,
          },
        })], { type: 'application/json' });
        navigator.sendBeacon('/api/track', blob);
      } catch {
        // Fire-and-forget — don't log tracking failures
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
