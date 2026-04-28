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
 * Also activates any pending memberships for the current user on this tenant.
 * Must be rendered in the [tenant] layout after authentication is available.
 */
export function TenantSessionUpdater({ tenantSlug }: TenantSessionUpdaterProps) {
    const { data: session, update } = useSession();
    const requestedSlugRef = useRef<string | null>(null);
    const membershipActivatedRef = useRef<string | null>(null);

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

    // Activate pending memberships when user is on a tenant page
    useEffect(() => {
        const user = session?.user as any;
        if (!user?.email) return;

        // Prevent repeated calls for the same tenant
        if (membershipActivatedRef.current === tenantSlug) return;
        membershipActivatedRef.current = tenantSlug;

        // Fire and forget - activate any pending membership
        fetch(`/api/platform/tenants/${tenantSlug}/activate-membership`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }).catch(() => {
            // Ignore errors - this is a best-effort operation
        });
    }, [session, tenantSlug]);

    return null; // This component only has side effects
}
