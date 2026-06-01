/**
 * Embed-aware version of SiteHeader that conditionally renders
 * Hides the header when page is embedded in an iframe
 */

'use client';

import { useEmbedContext } from '@/hooks/useEmbedContext';
import SiteHeader from './SiteHeader';

interface Props {
    variant?: 'transparent' | 'light';
}

export default function ConditionalSiteHeader({ variant = 'light' }: Props) {
    const { isEmbedded, isLoading } = useEmbedContext();

    // During SSR and initial hydration, always render header to avoid mismatch.
    // After hydration completes (isLoading=false), hide if embedded.
    if (!isLoading && isEmbedded) {
        return null;
    }

    return <SiteHeader variant={variant} />;
}
