/**
 * Hook to detect if the current page is embedded in an iframe, served
 * from a tenant subdomain, or rendered under an /embed/ route — any of
 * which should suppress global Source Library chrome (header, footer,
 * cross-site links).
 */

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getRoomPrefixFromPathname } from '@/lib/reading-rooms-paths';

/**
 * Matches tenant subdomain hosts like `bph.sourcelibrary.org`. Excludes
 * `www.` and the bare apex — those are the canonical global site.
 */
export function isTenantSubdomain(host: string): boolean {
  const h = host.toLowerCase();
  if (h.startsWith('www.')) return false;
  if (!/\.sourcelibrary\.(org|com|net)$/.test(h)) return false;
  return h.split('.').length >= 3;
}

export function useEmbedContext() {
  const pathname = usePathname();
  // /embed/<tenant>/… (partner rooms) and /rooms/<slug>/… (self-serve
  // reading rooms, #5266) are both embedded surfaces; the management pages
  // under /rooms are not (reading-rooms-paths.ts decides).
  const onEmbedRoute = (pathname?.startsWith('/embed/') ?? false) || getRoomPrefixFromPathname(pathname) !== null;

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

/**
 * True only on a partner subdomain (bph.sourcelibrary.org), never on the apex,
 * inside an iframe, or under /embed or /rooms. For hiding a link to a path the
 * proxy refuses on tenant hosts (`src/lib/tenant-global-paths.ts`) without
 * changing anything the main site renders. False on the server and during
 * hydration (the server snapshot), so the markup matches; the host never
 * changes, so there is nothing to subscribe to.
 */
const noSubscription = () => () => {};
export function useIsTenantHost() {
  return useSyncExternalStore(
    noSubscription,
    () => isTenantSubdomain(window.location.host),
    () => false
  );
}
