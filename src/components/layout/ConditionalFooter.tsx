/**
 * Conditional footer that hides when embedded in an iframe
 * Wraps GlobalFooter to prevent displaying Source Library footer in embedded mode
 */

'use client';

import { useEmbedContext } from '@/hooks/useEmbedContext';
import GlobalFooter from './GlobalFooter';

export default function ConditionalFooter() {
    const { isEmbedded, isLoading } = useEmbedContext();

    // During SSR and initial hydration, always render footer to avoid mismatch.
    // After hydration completes (isLoading=false), hide if embedded.
    if (!isLoading && isEmbedded) {
        return null;
    }

    return <GlobalFooter />;
}
