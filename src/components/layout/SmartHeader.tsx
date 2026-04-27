/**
 * Header that switches between standard SiteHeader and EFM branding
 * when embedded in an iframe
 */

'use client';

import { useIsEmbedded } from '@/hooks/useEmbedContext';
import SiteHeader from './SiteHeader';
import EFMHeader from './EFMHeader';

interface Props {
    variant?: 'light' | 'dark';
}

export default function SmartHeader({ variant = 'light' }: Props) {
    const isEmbedded = useIsEmbedded();

    if (isEmbedded) {
        return <EFMHeader />;
    }

    return <SiteHeader variant={variant} />;
}
