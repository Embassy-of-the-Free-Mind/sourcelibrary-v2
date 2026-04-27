/**
 * Hook to detect if the current page is embedded in an iframe
 * and should use embed-specific styling/layout
 */

'use client';

import { useEffect, useState } from 'react';

export function useEmbedContext() {
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Detect if inside iframe
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    setIsEmbedded(inIframe);
    setIsLoading(false);
  }, []);

  return { isEmbedded, isLoading };
}

export function useIsEmbedded() {
  const { isEmbedded } = useEmbedContext();
  return isEmbedded;
}
