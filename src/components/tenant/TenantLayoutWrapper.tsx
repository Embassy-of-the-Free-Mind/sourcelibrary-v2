'use client';

import { EmbedContext } from '@/lib/EmbedContext';
import { useSearchParams } from 'next/navigation';

export function TenantLayoutWrapper({ children }: { children: React.ReactNode }) {
    const searchParams = useSearchParams();
    const embed = searchParams.get('embed') === '1';

    return (
        <EmbedContext.Provider value={embed}>
            {children}
        </EmbedContext.Provider>
    );
}
