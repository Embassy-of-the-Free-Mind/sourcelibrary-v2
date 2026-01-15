'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { utils } from '@/lib/api-client';

export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Don't track admin/internal pages
    if (pathname?.includes('/api/') || pathname?.includes('/admin/')) {
      return;
    }

    const trackPageview = async () => {
      try {
        await utils.track('pageview', {
          path: pathname,
          referrer: document.referrer,
          userAgent: navigator.userAgent,
        });
      } catch (error) {
        console.error('Tracking failed:', error);
      }
    };

    trackPageview();
  }, [pathname]);

  return null;
}
