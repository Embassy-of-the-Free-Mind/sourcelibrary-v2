'use client';

import { useEffect, useRef } from 'react';

/**
 * When embedded via embed.js (/embed route), intercept
 * history.pushState and convert it to replaceState. This prevents the
 * iframe's Next.js router from creating duplicate history entries —
 * the host embed script owns all history management.
 */
export default function EmbedHistoryPatch() {
    const patchedRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return; // not in iframe
        if (patchedRef.current) return; // already patched

        // Activate on canonical /embed routes.
        const onEmbedRoute = window.location.pathname.startsWith('/embed/');
        if (!onEmbedRoute) return;

        patchedRef.current = true;

        const originalReplaceState = history.replaceState.bind(history);

        // Intercept pushState and convert to replaceState when embedded
        history.pushState = function (state: unknown, unused: string, url?: string | URL | null) {
            return originalReplaceState(state, unused, url);
        };

        // No cleanup - keep patch for entire session
    }, []);

    return null;
}
