/**
 * Prevents users from leaving the iframe when embedded.
 * Blocks: right-click menu, Ctrl+Click, Cmd+Click, middle-click, window.open()
 * 
 * This keeps users on the tenant's site rather than navigating to sourcelibrary.org directly.
 */

'use client';

import { useEffect } from 'react';
import { useIsEmbedded } from '@/hooks/useEmbedContext';

export default function EmbedLinkInterceptor() {
    const isEmbedded = useIsEmbedded();

    useEffect(() => {
        if (!isEmbedded) return;

        // Block right-click context menu (prevents "Open in new tab" option)
        function handleContextMenu(e: MouseEvent) {
            e.preventDefault();
        }

        // Intercept Ctrl+Click / Cmd+Click on links — navigate in iframe instead of new tab
        function handleClick(e: MouseEvent) {
            if (!e.ctrlKey && !e.metaKey) return;

            const target = (e.target as HTMLElement).closest('a');
            if (!target) return;

            const href = target.getAttribute('href');
            if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;

            e.preventDefault();
            e.stopPropagation();

            // Navigate within iframe
            if (href.startsWith('/') || href.startsWith(window.location.origin)) {
                window.location.href = href;
            }
        }

        // Block middle-click (auxclick with button 1)
        function handleAuxClick(e: MouseEvent) {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
            }
        }

        // Override window.open() to navigate in iframe instead
        const originalOpen = window.open;
        window.open = function (url?: string | URL) {
            if (url) {
                const urlStr = url.toString();
                if (urlStr.startsWith('/') || urlStr.startsWith(window.location.origin)) {
                    window.location.href = urlStr;
                }
            }
            return null;
        };

        document.addEventListener('contextmenu', handleContextMenu, true);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('auxclick', handleAuxClick, true);

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu, true);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('auxclick', handleAuxClick, true);
            window.open = originalOpen;
        };
    }, [isEmbedded]);

    return null;
}
