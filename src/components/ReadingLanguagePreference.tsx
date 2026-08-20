'use client';

import { useEffect } from 'react';
import { type ReadingLanguage, resolveReadingLanguage, setStoredReadingLanguage } from '@/lib/reading-language';

/**
 * Renders nothing; records a reading-language preference on mount.
 *
 * - With `lang` (the `/es` homepage passes 'es'): visiting that front door
 *   means "I read Spanish", so books opened afterwards start in Spanish where a
 *   Spanish edition exists. The reader's own toggle can override it at any time
 *   and is remembered the same way.
 * - Without `lang` (the ISR book page): picks up a `?lang=es` link parameter
 *   and stores it, so the static page can pass the choice on to the reader.
 */
export default function ReadingLanguagePreference({ lang }: { lang?: ReadingLanguage }) {
  useEffect(() => {
    if (lang) setStoredReadingLanguage(lang);
    else resolveReadingLanguage();
  }, [lang]);
  return null;
}
