/**
 * Hook to detect if the current page is embedded in an iframe, served
 * from a tenant subdomain, or rendered under an /embed/ route — any of
 * which should suppress global Source Library chrome (header, footer,
 * cross-site links).
 */

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Matches tenant subdomain hosts like `bph.sourcelibrary.org`. Excludes
 * `www.` and the bare apex — those are the canonical global site.
 */
function isTenantSubdomain(host: string): boolean {
  const h = host.toLowerCase();
  if (h.startsWith('www.')) return false;
  if (!/\.sourcelibrary\.(org|com|net)$/.test(h)) return false;
  return h.split('.').length >= 3;
}

export function useEmbedContext() {
  const pathname = usePathname();
  const onEmbedRoute = pathname?.startsWith('/embed/') ?? false;

  // Browser-only signals. SSR and the first client render both compute
  // these as false (deterministic match → no hydration warning); a
  // post-mount effect upgrades the state, which is what fixes the
  // tenant-subdomain leak that was rendering the global SL header on
  // pages like bph.sourcelibrary.org/collections/foo.
  const [browserSignals, setBrowserSignals] = useState({
    inIframe: false,
    onTenantSubdomain: false,
  });

  useEffect(() => {
    setBrowserSignals({
      inIframe: window.self !== window.top,
      onTenantSubdomain: isTenantSubdomain(window.location.host),
    });
  }, []);

  const isEmbedded =
    onEmbedRoute || browserSignals.inIframe || browserSignals.onTenantSubdomain;

  return { isEmbedded, isLoading: false };
}

export function useIsEmbedded() {
  const { isEmbedded } = useEmbedContext();
  return isEmbedded;
}
