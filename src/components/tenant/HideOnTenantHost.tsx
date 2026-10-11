'use client';

import type { ReactNode } from 'react';
import { useIsTenantHost } from '@/hooks/useEmbedContext';

/**
 * Renders its children everywhere except on a partner subdomain. For an entry
 * point into a surface the proxy refuses on tenant hosts — the Librarian
 * (#4330) — on a page that is otherwise served there, so a partner's visitors
 * are not handed a link that 404s. Host-only (`useIsTenantHost`): the apex,
 * iframes and reading rooms render exactly as before.
 */
export default function HideOnTenantHost({ children }: { children: ReactNode }) {
  return useIsTenantHost() ? null : <>{children}</>;
}
