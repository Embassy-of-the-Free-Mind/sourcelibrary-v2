/**
 * Footer that switches between standard GlobalFooter and EFM branding
 * when embedded in an iframe
 */

'use client';

import { useIsEmbedded } from '@/hooks/useEmbedContext';
import GlobalFooter from './GlobalFooter';
import EFMFooter from './EFMFooter';

export default function SmartFooter() {
  const isEmbedded = useIsEmbedded();

  if (isEmbedded) {
    return <EFMFooter />;
  }

  return <GlobalFooter />;
}
