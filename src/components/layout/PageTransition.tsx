'use client';

import { usePathname } from 'next/navigation';

/**
 * Subtle page-load fade. Keyed by pathname so the content gently fades in on
 * every navigation (not on search-param changes, which keeps filters/sorts from
 * flashing the whole page). Opacity-only on purpose: a transform here would
 * break `position: sticky` headers inside the page.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in">
      {children}
    </div>
  );
}
