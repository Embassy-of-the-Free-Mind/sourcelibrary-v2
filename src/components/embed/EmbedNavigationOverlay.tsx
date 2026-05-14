'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Shows a loading overlay inside the iframe during host-driven back/forward
 * navigation. Appears on embed:nav-start, disappears when the new page's
 * EmbedNavigationReporter fires (embed:nav-end event).
 *
 * Only activates when running inside an iframe — no-op when loaded directly.
 */
export default function EmbedNavigationOverlay() {
    const [visible, setVisible] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.self === window.top) return;

        const show = () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setVisible(true);
            // Tell the host to scroll back to the top of the iframe so the
            // loader (anchored at the top of the iframe document) is in view
            // even when the user had scrolled down inside a tall page.
            try {
                window.parent.postMessage({ type: 'sl-nav-start' }, '*');
            } catch {
                // ignore — postMessage failures are non-fatal
            }
            // Safety: auto-hide after 10s in case embed:nav-end never fires
            timeoutRef.current = setTimeout(() => setVisible(false), 10000);
        };

        const hide = () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setVisible(false);
        };

        window.addEventListener('embed:nav-start', show);
        window.addEventListener('embed:nav-end', hide);
        return () => {
            window.removeEventListener('embed:nav-start', show);
            window.removeEventListener('embed:nav-end', hide);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: '#faf8f4',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: 96,
                animation: 'sl-fade-in 120ms ease-out',
            }}
            aria-hidden="true"
        >
            <style>{`
                @keyframes sl-fade-in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes sl-spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: '2.5px solid rgba(0,0,0,0.12)',
                    borderTopColor: 'rgba(0,0,0,0.55)',
                    animation: 'sl-spin 700ms linear infinite',
                }}
            />
        </div>
    );
}
