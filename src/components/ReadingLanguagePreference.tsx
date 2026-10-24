'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearLegacyReadingLanguage, legacyLangRedirect } from '@/lib/reading-language';
import type { PrefixedLocale } from '@/lib/locale-path';

/**
 * Renders nothing. Mounted on the ISR English book page, which cannot read
 * `searchParams` server-side. Two jobs:
 *
 * 1. A `?lang=xx` on this URL — a carried site language (#6938) or a legacy
 *    `?lang=es` link minted before `/es` existed — moves to the `/xx` edition
 *    of the book, but only when the book HAS one (`editions`, decided on the
 *    server). Without that check this would bounce forever: the `/xx` route
 *    307s a book without the edition back to `/book/<id>?lang=xx`. `replace`,
 *    not `push`, so Back doesn't bounce between the two.
 * 2. The stale `sl:reading-language` localStorage key (#4112) is removed. It is
 *    read by nothing now; clearing it means a reader stuck in Spanish by the old
 *    behaviour is fixed by their next page load rather than by finding a toggle.
 */
export default function ReadingLanguagePreference({ editions }: { editions: PrefixedLocale[] }) {
  const router = useRouter();
  const key = editions.join(',');
  useEffect(() => {
    clearLegacyReadingLanguage();
    const target = legacyLangRedirect(
      window.location.pathname,
      window.location.search,
      (lang) => key.split(',').includes(lang),
    );
    if (target) router.replace(target);
  }, [router, key]);
  return null;
}
