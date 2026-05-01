'use client';

import { useIsEmbedded } from '@/hooks/useEmbedContext';

/**
 * Wrapper that hides content when page is embedded.
 * Uses EmbedContext (client-side detection) so ISR stays clean.
 */
export function HideWhenEmbedded({ children }: { children: React.ReactNode }) {
    const isEmbedded = useIsEmbedded();
    if (isEmbedded) return null;
    return <>{children}</>;
}
