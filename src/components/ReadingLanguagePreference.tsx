'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearLegacyReadingLanguage, legacyLangRedirect } from '@/lib/reading-language';
import { hasLocalizedTwin } from '@/lib/locale-path';

/**
 * Renders nothing. Cleans up after the retired reading-language preference
 * store (#4112), in two ways:
 *
 * 1. A legacy `?lang=es` link — minted before `/es/…` existed — is migrated to
 *    the `/es` twin of the same page, so old shared links still open in Spanish
 *    and the address bar tells the truth about it. `replace`, not `push`, so
 *    Back doesn't bounce between the two.
 * 2. The stale `sl:reading-language` localStorage key is removed. It is read by
 *    nothing now; clearing it means a reader stuck in Spanish by the old
 *    behaviour is fixed by their next page load rather than by finding a toggle.
 *
 * Mounted on the ISR book page, which cannot read `searchParams` server-side.
 * Both jobs are idempotent, so this is safe anywhere.
 */
export default function ReadingLanguagePreference() {
  const router = useRouter();
  useEffect(() => {
    clearLegacyReadingLanguage();
    const target = legacyLangRedirect(
      window.location.pathname,
      window.location.search,
      hasLocalizedTwin,
    );
    if (target) router.replace(target);
  }, [router]);
  return null;
}
