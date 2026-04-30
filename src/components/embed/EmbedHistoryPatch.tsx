'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * When embedded via embed.js (detected by embed=1 param), intercept
 * history.pushState and convert it to replaceState. This prevents the
 * iframe's Next.js router from creating duplicate history entries —
 * the host embed script owns all history management.
 */
export default function EmbedHistoryPatch() {
    const searchParams = useSearchParams();
    const patchedRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return; // not in iframe
        if (patchedRef.current) return; // already patched

        // Only activate when embed=1 param is present (from embed.js)
        const isEmbedded = searchParams.get('embed') === '1';
        if (!isEmbedded) return;

        patchedRef.current = true;

        const originalPushState = history.pushState.bind(history);
        const originalReplaceState = history.replaceState.bind(history);

        // Intercept pushState and convert to replaceState when embedded
        history.pushState = function (state: unknown, unused: string, url?: string | URL | null) {
            return originalReplaceState(state, unused, url);
        };

        // No cleanup - keep patch for entire session
    }, [searchParams]);

    return null;
}
