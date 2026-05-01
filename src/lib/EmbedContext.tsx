'use client';

import { createContext, useContext } from 'react';

/**
 * EmbedContext indicates whether the page is being displayed in embedded mode.
 * When true, internal navigation should preserve ?embed=1 query parameter.
 */
export const EmbedContext = createContext<boolean>(false);

export function useEmbed(): boolean {
    return useContext(EmbedContext);
}

export function withQueryParam(href: string, key: string, value: string): string {
    const [beforeHash, hash = ''] = href.split('#', 2);
    const [pathname, query = ''] = beforeHash.split('?', 2);
    const params = new URLSearchParams(query);
    params.set(key, value);
    const queryString = params.toString();
    const withQuery = queryString ? `${pathname}?${queryString}` : pathname;

    return hash ? `${withQuery}#${hash}` : withQuery;
}

export function useEmbedHref(): (href: string) => string {
    const embed = useEmbed();

    return (href: string) => {
        if (!embed) return href;
        return withQueryParam(href, 'embed', '1');
    };
}
