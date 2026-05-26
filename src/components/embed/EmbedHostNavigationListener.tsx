'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface HostNavigateData {
    type: 'sl-host-navigate';
    tenant?: string | null;
    book?: string | null;
    page?: string | null;
    filters?: Record<string, string>;
}

// Internal iframe-only params we never compare against host-driven targets
// (host_path is appended by embed/v1.js; _r is the reload cache-buster).
const INTERNAL_PARAMS = new Set(['host_path', '_r']);

/**
 * Listens for host-driven navigation commands from embed v1.js and
 * performs client-side route transitions inside the iframe for faster UX.
 *
 * Host can send a book/page deep-link OR a filter snapshot (when the
 * visitor hits back/forward on a URL whose filter state differs from the
 * iframe's current view).
 */
export default function EmbedHostNavigationListener() {
    const router = useRouter();

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return;

        const onMessage = (event: MessageEvent) => {
            const data = event.data as HostNavigateData | undefined;
            if (!data || data.type !== 'sl-host-navigate') return;
            if (!data.tenant) return;

            const tenant = encodeURIComponent(data.tenant);
            const book = data.book ? encodeURIComponent(data.book) : null;
            const page = data.page ? encodeURIComponent(data.page) : null;

            let target = '';
            if (book && page) {
                target = '/embed/' + tenant + '/book/' + book + '/page/' + page;
            } else if (book) {
                target = '/embed/' + tenant + '/book/' + book;
            } else {
                const qs = new URLSearchParams();
                const filters = data.filters || {};
                for (const [k, v] of Object.entries(filters)) {
                    if (v) qs.set(k, v);
                }
                const query = qs.toString();
                target = '/embed/' + tenant + (query ? '?' + query : '');
            }

            // Normalise the current URL (strip internal iframe-only params) so
            // the equality check actually fires when nothing has changed —
            // otherwise the leftover host_path param makes every popstate
            // trigger a wasted route.replace + nav-start flash.
            const currentSp = new URLSearchParams(window.location.search);
            INTERNAL_PARAMS.forEach((k) => currentSp.delete(k));
            const currentSearch = currentSp.toString();
            const current = window.location.pathname + (currentSearch ? '?' + currentSearch : '');
            if (current === target) return;

            // Show the loader before kicking off the route transition so it
            // paints before Next.js mounts the new page.
            window.dispatchEvent(new Event('embed:nav-start'));

            // Host owns browser history; keep iframe navigation internal and snappy.
            router.replace(target);
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [router]);

    return null;
}
