'use client';

import { useEffect, useRef } from 'react';

/**
 * When embedded via embed.js (/embed route), intercept
 * history.pushState and convert it to replaceState. This prevents the
 * iframe's Next.js router from creating duplicate history entries —
 * the host embed script owns all history management.
 *
 * Also dispatches `embed:nav-start` on browser back/forward (popstate) so
 * EmbedNavigationOverlay can show its loader before the new page renders.
 * Link clicks are handled separately in EmbedLinkInterceptor — pushState
 * runs too late (after Next.js has already mounted the new page) to be a
 * useful nav-start signal.
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

        let lastPathname = window.location.pathname;
        const onPopState = () => {
            // popstate fires before Next.js processes the URL change, so
            // dispatching here gives the loader a chance to paint before
            // the new route mounts.
            const nextPathname = window.location.pathname;
            if (nextPathname === lastPathname) return;
            lastPathname = nextPathname;
            window.dispatchEvent(new Event('embed:nav-start'));
        };
        window.addEventListener('popstate', onPopState);

        // No cleanup - keep patch for entire session
    }, []);

    return null;
}
