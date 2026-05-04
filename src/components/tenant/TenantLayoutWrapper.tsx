'use client';

import { EmbedContext } from '@/lib/EmbedContext';
import { usePathname } from 'next/navigation';

export function TenantLayoutWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const onEmbedRoute = pathname?.startsWith('/embed/') ?? false;
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    const embed = onEmbedRoute || inIframe;

    return (
        <EmbedContext.Provider value={embed}>
            {children}
        </EmbedContext.Provider>
    );
}
