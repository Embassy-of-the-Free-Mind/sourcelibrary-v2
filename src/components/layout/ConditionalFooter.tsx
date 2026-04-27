/**
 * Conditional footer that hides when embedded in an iframe
 * Wraps GlobalFooter to prevent displaying Source Library footer in embedded mode
 */

'use client';

import { useIsEmbedded } from '@/hooks/useEmbedContext';
import GlobalFooter from './GlobalFooter';

export default function ConditionalFooter() {
    const isEmbedded = useIsEmbedded();

    // Don't render footer when embedded
    if (isEmbedded) {
        return null;
    }

    return <GlobalFooter />;
}
