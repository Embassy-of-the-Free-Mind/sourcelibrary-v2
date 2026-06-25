'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget (explicit render). Renders nothing unless
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the sign-in page is unchanged when
 * the feature is off. Calls `onVerify(token)` when the challenge passes and
 * `onVerify(null)` when the token expires or errors. See src/lib/turnstile.ts.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')));
      if (window.turnstile) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  });
}

export function TurnstileWidget({ onVerify }: { onVerify: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    const el = containerRef.current;

    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !el) return;
        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => onVerify(token),
          'expired-callback': () => onVerify(null),
          'error-callback': () => onVerify(null),
        });
      })
      .catch(() => onVerify(null));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget already gone */
        }
      }
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center my-4" />;
}

/** True when the widget is configured to render (client-side check). */
export const turnstileConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
