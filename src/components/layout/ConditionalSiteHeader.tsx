/**
 * Embed-aware version of SiteHeader that conditionally renders
 * Hides the header when page is embedded in an iframe
 */

'use client';

import { useIsEmbedded } from '@/hooks/useEmbedContext';
import SiteHeader from './SiteHeader';

interface Props {
    variant?: 'light' | 'dark';
}

export default function ConditionalSiteHeader({ variant = 'light' }: Props) {
    const isEmbedded = useIsEmbedded();

    // Don't render header when embedded
    if (isEmbedded) {
        return null;
    }

    return <SiteHeader variant={variant} />;
}
