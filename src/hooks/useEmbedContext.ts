/**
 * Hook to detect if the current page is embedded in an iframe
 * and should use embed-specific styling/layout.
 * 
 * Checks for explicit embed=1 query param (from embed script)
 * as the primary signal, falling back to iframe detection if needed.
 */

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export function useEmbedContext() {
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    // Prefer explicit embed=1 param from embed script
    const embedParam = searchParams.get('embed');
    if (embedParam === '1') {
      setIsEmbedded(true);
      setIsLoading(false);
      return;
    }

    // Fallback: detect if inside iframe
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    setIsEmbedded(inIframe);
    setIsLoading(false);
  }, [searchParams]);

  return { isEmbedded, isLoading };
}

export function useIsEmbedded() {
  const { isEmbedded } = useEmbedContext();
  return isEmbedded;
}
