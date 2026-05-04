'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface HostNavigateData {
    type: 'sl-host-navigate';
    tenant?: string | null;
    book?: string | null;
    page?: string | null;
}

/**
 * Listens for host-driven navigation commands from embed v1.js and
 * performs client-side route transitions inside the iframe for faster UX.
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
                target = '/embed/' + tenant;
            }

            const current = window.location.pathname + window.location.search;
            if (current === target) return;

            // Host owns browser history; keep iframe navigation internal and snappy.
            router.replace(target);
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [router]);

    return null;
}
