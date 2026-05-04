'use client';

import { createContext, useContext } from 'react';

/**
 * EmbedContext indicates whether the page is being displayed in embedded mode.
 * When true, internal navigation should preserve /embed namespace.
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

function withEmbedNamespace(href: string): string {
    if (!href || /^https?:\/\//i.test(href) || href.startsWith('/embed/')) return href;
    if (!href.startsWith('/')) return href;
    return `/embed${href}`;
}

export function useEmbedHref(): (href: string) => string {
    const embed = useEmbed();

    return (href: string) => {
        if (!embed) return href;
        return withEmbedNamespace(href);
    };
}
