'use client';

/**
 * Restores the Account / Sign-out control on tenant subdomains (#2150).
 *
 * After the tenant-as-filter migration, a partner subdomain serves the GLOBAL
 * routes directly — `bph.sourcelibrary.org/book/<slug>` renders
 * `src/app/book/[id]/page.tsx`, not an `/embed/*` route. Two things follow:
 *
 *   1. `src/app/embed/layout.tsx` never runs there, so `EmbedUserMenu` — which
 *      it is the only mount point for — is absent;
 *   2. `ConditionalSiteHeader` removes the whole SiteHeader on a tenant host
 *      post-hydration, so the header's account control is gone too.
 *
 * Net effect, verified live on 2026-07-27 against the hydrated DOM of
 * bph.sourcelibrary.org/book/…: zero auth affordances on the page. A signed-in
 * reader on a partner subdomain could not reach their account or sign out.
 *
 * Mounted from the ROOT layout and gated client-side on purpose. The root
 * layout must not read `headers()` — that would force dynamic rendering and
 * break ISR on the book page (`revalidate = 86400`), which is the same
 * constraint that made site-mode detection client-side in the first place.
 * `useEmbedContext` resolves its host signal in a post-mount effect, so the
 * server HTML is identical for every host and stays cacheable.
 */

import { usePathname } from 'next/navigation';
import { useEmbedContext } from '@/hooks/useEmbedContext';
import EmbedUserMenu from './EmbedUserMenu';

export default function TenantAccountMenu() {
  const { isEmbedded } = useEmbedContext();
  const pathname = usePathname();

  // `/embed/*` already mounts the full menu from its own layout — mounting a
  // second instance here would stack two floating controls in the same corner.
  if (pathname?.startsWith('/embed/')) return null;
  if (!isEmbedded) return null;

  // `account-only`: nothing renders for anonymous visitors, and the
  // view-options toggles stay off. Restoring those is a product decision
  // (2026-05-28 — BPH is deliberately "hidden, no toggle"), not part of this
  // fix; see EmbedUserMenuProps.
  return <EmbedUserMenu variant="account-only" />;
}
