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
    // Scroll to top when navigating to a new book page
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return children;
}
