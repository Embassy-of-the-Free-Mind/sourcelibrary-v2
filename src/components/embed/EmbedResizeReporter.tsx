'use client';

import { useEffect } from 'react';

/**
 * Sends the current embedded document height to the parent page.
 * Parent embed.js uses this to resize the iframe and avoid double scrollbars.
 */
export default function EmbedResizeReporter() {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return;

        let raf = 0;
        let lastSent = 0;

        const postHeight = () => {
            const body = document.body;
            const doc = document.documentElement;
            if (!body || !doc) return;

            const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                doc.scrollHeight,
                doc.offsetHeight,
                doc.clientHeight,
            );

            if (height > 0 && height !== lastSent) {
                lastSent = height;
                window.parent.postMessage({ type: 'sl-resize', height }, '*');
            }
        };

        const schedulePost = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
                raf = 0;
                postHeight();
            });
        };

        const ro = new ResizeObserver(schedulePost);
        ro.observe(document.documentElement);
        ro.observe(document.body);

        const mo = new MutationObserver(schedulePost);
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

        const handleMessage = (event: MessageEvent) => {
            if (!event.data || event.data.type !== 'sl-request-resize') return;
            schedulePost();
        };

        window.addEventListener('load', schedulePost);
        window.addEventListener('resize', schedulePost);
        window.addEventListener('message', handleMessage);

        // Fallback heartbeat for late layout changes (font swap, async images, CMS injections).
        const intervalId = window.setInterval(schedulePost, 1000);
        schedulePost();

        return () => {
            if (raf) window.cancelAnimationFrame(raf);
            ro.disconnect();
            mo.disconnect();
            window.clearInterval(intervalId);
            window.removeEventListener('load', schedulePost);
            window.removeEventListener('resize', schedulePost);
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    return null;
}
