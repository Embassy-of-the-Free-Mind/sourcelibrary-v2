'use client';

import { EmbedContext } from '@/lib/EmbedContext';
import { useEmbedContext } from '@/hooks/useEmbedContext';

export function TenantLayoutWrapper({ children }: { children: React.ReactNode }) {
    // Reuse the central detection — pathname + iframe + tenant subdomain.
    // Previously this wrapper only checked pathname/iframe, so on tenant
    // subdomains (bph.sourcelibrary.org) the EmbedContext value was wrong
    // and the SL header leaked through anywhere consumers gated on it.
    const { isEmbedded } = useEmbedContext();

    return (
        <EmbedContext.Provider value={isEmbedded}>
            {children}
        </EmbedContext.Provider>
    );
}
