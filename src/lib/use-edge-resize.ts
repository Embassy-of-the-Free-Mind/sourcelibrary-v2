'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Feature flag: use Cloudflare edge image resizing instead of pre-generated variants.
 * Enabled by adding ?resize=1 to any page URL.
 *
 * When enabled, image URLs use ?preset=thumb|display instead of -thumb.jpg paths.
 * This serves WebP/AVIF automatically and eliminates the need for pre-generated variants.
 *
 * Test: sourcelibrary.org/browse?resize=1
 * Rollback: remove ?resize=1 (falls back to pre-generated images)
 */
export function useEdgeResize(): boolean {
  const params = useSearchParams();
  return params?.get('resize') === '1';
}
