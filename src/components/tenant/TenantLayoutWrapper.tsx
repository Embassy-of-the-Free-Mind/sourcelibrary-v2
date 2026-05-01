'use client';

import { EmbedContext } from '@/lib/EmbedContext';
import { useEffect, useState } from 'react';

export function TenantLayoutWrapper({ children }: { children: React.ReactNode }) {
    const [embed, setEmbed] = useState(false);

    useEffect(() => {
        const inIframe = typeof window !== 'undefined' && window.self !== window.top;
        const params = new URLSearchParams(window.location.search);
        const embedParam = params.get('embed') === '1';
        setEmbed(embedParam || inIframe);
    }, []);

    return (
        <EmbedContext.Provider value={embed}>
            {children}
        </EmbedContext.Provider>
    );
}
