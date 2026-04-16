'use client';

import { useEffect } from 'react';
import { useRef } from 'react';
import { useSession } from 'next-auth/react';

interface TenantSessionUpdaterProps {
    tenantSlug: string;
}

/**
 * Client component that updates the session with tenant context for role resolution.
 * Triggers JWT callback with _pendingTenantSlug to resolve tenant-scoped roles.
 * Must be rendered in the [tenant] layout after authentication is available.
 */
export function TenantSessionUpdater({ tenantSlug }: TenantSessionUpdaterProps) {
    const { data: session, update } = useSession();
    const requestedSlugRef = useRef<string | null>(null);

    useEffect(() => {
        const user = session?.user as any;
        if (!user) return;

        // Already resolved for this tenant, no update needed.
        if (user.tenantSlug === tenantSlug) {
            requestedSlugRef.current = null;
            return;
        }

        // Prevent repeated update loops for the same unresolved slug.
        if (requestedSlugRef.current === tenantSlug) return;

        requestedSlugRef.current = tenantSlug;
        void update({ _pendingTenantSlug: tenantSlug }).catch(() => {
            requestedSlugRef.current = null;
        });
    }, [session, tenantSlug, update]);

    return null; // This component only has side effects
}
