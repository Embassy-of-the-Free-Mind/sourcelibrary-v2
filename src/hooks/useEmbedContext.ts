/**
 * Hook to detect if the current page is embedded in an iframe
 * and should use embed-specific styling/layout.
 */

'use client';

import { usePathname } from 'next/navigation';

export function useEmbedContext() {
  const pathname = usePathname();

  const onEmbedRoute = pathname?.startsWith('/embed/') ?? false;
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;
  const isEmbedded = onEmbedRoute || inIframe;

  return { isEmbedded, isLoading: false };
}

export function useIsEmbedded() {
  const { isEmbedded } = useEmbedContext();
  return isEmbedded;
}
