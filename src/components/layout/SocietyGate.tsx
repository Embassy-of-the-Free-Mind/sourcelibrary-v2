'use client';

import { ReactNode } from 'react';
import { useSiteMode } from '@/components/providers/SiteModeProvider';
import SocietyLandingPage from './SocietyLandingPage';

/**
 * Client-side gate that shows SocietyLandingPage on society domains.
 * Avoids calling headers() in server components (which disables ISR).
 * SiteModeProvider detects mode from hostname via useEffect.
 */
export default function SocietyGate({ children }: { children: ReactNode }) {
  const { isSociety } = useSiteMode();

  if (isSociety) {
    return <SocietyLandingPage />;
  }

  return <>{children}</>;
}
