'use client';

import { createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';

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
    // Only prefix when the URL bar already shows /embed/ (iframe / direct
    // /embed/ route). On tenant subdomains (bhutan.sourcelibrary.org/...)
    // the proxy hides /embed/<tenant> from the URL bar and handles the
    // rewrite server-side, so prefixing here produces /embed/book/<slug>
    // — which the proxy skips and no route serves, returning 404.
    const pathname = usePathname();
    const onEmbedRoute = pathname?.startsWith('/embed/') ?? false;

    return (href: string) => {
        if (!onEmbedRoute) return href;
        return withEmbedNamespace(href);
    };
}
