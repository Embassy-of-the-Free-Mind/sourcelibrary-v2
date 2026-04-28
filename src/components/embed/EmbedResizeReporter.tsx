'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function getDocumentHeight(): number {
    const main = document.getElementById('main-content');
    if (main) {
        const rect = main.getBoundingClientRect();
        const fromRect = Math.ceil(rect.height);
        const fromScroll = Math.ceil(main.scrollHeight);
        return Math.max(fromRect, fromScroll);
    }

    const scrollEl = document.scrollingElement as HTMLElement | null;
    if (scrollEl) return scrollEl.scrollHeight;

    const doc = document.documentElement;
    const body = document.body;
    return Math.max(doc?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
}

export default function EmbedResizeReporter() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const routeKey = pathname + '?' + (searchParams?.toString() || '');

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return;

        let rafId: number | null = null;
        let timeoutId: number | null = null;
        let intervalId: number | null = null;
        const burstTimeouts: number[] = [];
        let lastPostedHeight = -1;

        const postResize = (force = false) => {
            const height = Math.max(window.innerHeight, getDocumentHeight());

            // Avoid flooding parent with duplicate measurements.
            if (!force && Math.abs(height - lastPostedHeight) < 2) return;

            lastPostedHeight = height;
            window.parent.postMessage({ type: 'sl-resize', height }, '*');
        };

        const scheduleResize = () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                postResize();
            });
        };

        const resizeObserver = new ResizeObserver(() => {
            scheduleResize();
        });

        if (document.documentElement) resizeObserver.observe(document.documentElement);
        if (document.body) resizeObserver.observe(document.body);

        const mutationObserver = new MutationObserver(() => {
            scheduleResize();
        });

        if (document.body) {
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });
        }

        window.addEventListener('resize', scheduleResize);
        window.addEventListener('orientationchange', scheduleResize);

        // Initial posts after layout settles.
        postResize(true);
        timeoutId = window.setTimeout(() => postResize(true), 250);

        // Route changes and suspense boundaries can settle over multiple frames.
        // Emit a short burst to ensure parent gets the final shrunk height.
        [50, 180, 420, 900].forEach((delay) => {
            const id = window.setTimeout(() => postResize(true), delay);
            burstTimeouts.push(id);
        });

        // Fonts can materially change line wrapping/page height.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => postResize(true)).catch(() => {
                // no-op
            });
        }

        // Safety net: content can change without mutations/resize (fonts, async media, virtualized UI).
        intervalId = window.setInterval(() => {
            postResize();
        }, 400);

        return () => {
            window.removeEventListener('resize', scheduleResize);
            window.removeEventListener('orientationchange', scheduleResize);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            if (rafId !== null) window.cancelAnimationFrame(rafId);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (intervalId !== null) window.clearInterval(intervalId);
            burstTimeouts.forEach((id) => window.clearTimeout(id));
        };
    }, [routeKey]);

    return null;
}
